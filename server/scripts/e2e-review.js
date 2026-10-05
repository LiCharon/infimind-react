#!/usr/bin/env node
/**
 * 端到端最小验证（A3）：拿一份真实合同走完整链路，看审查结果是否真的用上了知识库。
 *
 * 链路：合同原文 → Agent 1 结构分析 → 审查计划（类型/子类型） → 检索证据 → Agent 2 审查 → 输出批注
 * 关注三件事（评测测不到，只有端到端能看）：
 *   1. **证据引用率**：AI 的批注里有多少条真的引用了知识库证据（[E1] 之类）
 *   2. **风险等级分布**：批注的 level 是否合理（这正是 severity 修复想改善的）
 *   3. **证据对口程度**：引用到的证据是不是同一类合同/同一子类型
 *
 * 用法：node server/scripts/e2e-review.js [合同文件名关键字]
 *   （不传则取库里第一份坏例文档）
 */
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRequire = createRequire(join(__dirname, '..', '..', 'package.json'))
const Database = repoRequire('better-sqlite3')

const kb = await import('../services/knowledge-base.js')
const { buildReviewPlan } = await import('../services/review-plan.js')
const { analyzeContract } = await import('../agents/contract-analyzer.js')
const { reviewContract } = await import('../agents/contract-reviewer.js')
const { extractReviewPayload } = await import('../services/annotation-locator.js')
const { getFlashModel, getProModel } = await import('../services/llm-client.js')

const db = new Database(join(__dirname, '..', 'knowledge-base', 'templates.db'), { readonly: true })
const keyword = process.argv[2] || ''
const pick = keyword
  ? db.prepare("SELECT id, name, contract_type, sub_type, source_path FROM templates WHERE reference_role = 'annotated_case' AND source_file LIKE ? LIMIT 1").all(`%${keyword}%`)[0]
  : db.prepare("SELECT id, name, contract_type, sub_type, source_path FROM templates WHERE reference_role = 'annotated_case' LIMIT 1").get()
// 合同全文不在 DB 里（source_path 指向原始 docx，可能不在本机）。用**库内条款拼回正文**——
// 条款按 id 顺序就是原文顺序，抬头/签署页等被切分丢弃的少量内容不影响审查链路验证。
const clauseRows = db.prepare(
  'SELECT content FROM template_clauses WHERE template_id = ? ORDER BY id'
).all(pick.id)
const target = { ...pick, content: clauseRows.map((row) => row.content).join('\n\n') }
if (!target) {
  console.error('找不到目标合同')
  process.exit(1)
}

const model = getFlashModel()
console.log(`合同：${target.name}（类型 ${target.contract_type}${target.sub_type ? ' / ' + target.sub_type : ''}）`)
console.log(`模型：${model}　向量状态：${JSON.stringify(kb.getKnowledgeBaseStatus().vector)}`)

const startedAt = Date.now()
console.log('\n[1/4] Agent 1 结构分析…')
const analysisReport = await analyzeContract(target.content, () => {}, model)
console.log(`      完成，${analysisReport.length} 字`)

console.log('[2/4] 生成审查计划…')
const reviewPlan = buildReviewPlan({
  analysisReport,
  contractText: target.content,
  userInstruction: '请识别合同中需要修改的风险条款。'
})
console.log(`      类型=${reviewPlan.contractType} 子类型=${reviewPlan.subType || '(无)'} 主题=${reviewPlan.topics.length} 个`)
console.log(`      判定过程：${JSON.stringify(reviewPlan.typeResolution)}`)

console.log('[3/4] 检索证据…')
const evidence = await kb.searchEvidence(reviewPlan, { limit: 12 })
const severityOf = {}
const contractTypes = new Set()
for (const item of evidence) {
  if (item.severity) severityOf[item.severity] = (severityOf[item.severity] || 0) + 1
  if (item.contractType) contractTypes.add(item.contractType)
}
console.log(`      ${evidence.length} 条；严重度分布 ${JSON.stringify(severityOf)}`)
console.log(`      证据来源合同类型：${[...contractTypes].join('、') || '(空)'}`)

// 整份范本通道（与 workflow 同一选择逻辑；RAG_WHOLE_TEMPLATE=off 关闭）
const wholeOn = process.env.RAG_WHOLE_TEMPLATE !== 'off'
const exemplar = wholeOn ? evidence.find((item) => item.referenceRole === 'excellent_template' && item.kind === 'clause') : null
const wholeTemplate = exemplar ? kb.getWholeTemplateForReview(exemplar.templateId) : null
console.log(`      范本通道：${wholeTemplate ? `${wholeTemplate.name}（${wholeTemplate.clauses.length} 条 / ${wholeTemplate.chars} 字）` : '(关闭或无正向模板)'}`)

console.log('[4/4] Agent 2 审查…')
const output = await reviewContract({
  contractText: target.content,
  analysisReport,
  evidence,
  reviewPlan,
  userInstruction: '请识别合同中需要修改的风险条款。',
  round: 1,
  wholeTemplate
}, model)

const parsed = extractReviewPayload(output) || {}
const findings = parsed.findings || []
const levelOf = {}
let withEvidence = 0
const cited = new Set()
// 范本通道的预期收益观察点：缺失事项类批注（建议补充/未约定/缺少条款）
const supplementKeywords = /(建议补充|未约定|缺少|缺失|应增加|宜增加|未见.*条款|补充条款)/
let supplementCount = 0
for (const finding of findings) {
  levelOf[finding.level] = (levelOf[finding.level] || 0) + 1
  const refs = Array.isArray(finding.evidence) ? finding.evidence : []
  if (refs.length) withEvidence++
  for (const ref of refs) cited.add(String(ref).replace(/[^\d]/g, ''))
  const text = `${finding.title || ''}${finding.risk || ''}${finding.advice || ''}`
  if (supplementKeywords.test(text)) supplementCount++
}
console.log(`\n===== 结果 =====`)
console.log(`模式：${wholeTemplate ? '带范本通道' : '基线（无范本）'}｜批注 ${findings.length} 条｜等级分布 ${JSON.stringify(levelOf)}`)
console.log(`缺失事项类批注（建议补充/未约定等）：${supplementCount} 条`)
console.log(`引用了知识库证据的批注：${withEvidence}/${findings.length}（${findings.length ? Math.round(withEvidence / findings.length * 100) : 0}%）`)
console.log(`被引用的证据编号：${[...cited].sort().join('、') || '（无）'}，共 ${evidence.length} 条证据中的 ${cited.size} 条`)
console.log(`结论：${String(parsed.conclusion || '').slice(0, 120)}`)
console.log(`完整性清单（completeness）：${JSON.stringify(parsed.completeness || [])}`)
console.log(`\n耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s`)
console.log('\n--- 批注样例（前 5 条）---')
for (const [index, finding] of findings.slice(0, 5).entries()) {
  console.log(`${index + 1}. [${finding.level}] ${finding.title}`)
  console.log(`   引用：${(finding.evidence || []).join('、') || '（未引用证据）'}`)
}
// 全量批注落盘，便于 A/B 逐条对比
const outName = `e2e-${wholeTemplate ? 'with-whole' : 'baseline'}.json`
const { writeFileSync } = await import('fs')
writeFileSync(join(__dirname, '..', 'knowledge-base', outName), JSON.stringify({ mode: wholeTemplate ? 'with-whole' : 'baseline', contract: target.name, model, findings, completeness: parsed.completeness || [] }, null, 2))
console.log(`全量批注已写 server/knowledge-base/${outName}`)
db.close()
kb.close()
