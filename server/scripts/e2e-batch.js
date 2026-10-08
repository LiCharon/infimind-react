#!/usr/bin/env node
/**
 * 全量端到端 A/B（真实 LLM）：41 个评测用例 × 2 模式
 *   baseline：只给证据（现状）
 *   dual    ：证据 + 整份对口范本 + 证据目录
 * 每例 Agent 1 只跑一次，两模式共享同一份 analysisReport / reviewPlan / evidence —— 严格控制变量。
 * 串行执行防限流；单例失败跳过不阻塞。
 * 输出：server/knowledge-base/e2e-batch-result.json + console 汇总表
 */
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { writeFileSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const kb = await import('../services/knowledge-base.js')
const { buildReviewPlan } = await import('../services/review-plan.js')
const { analyzeContract } = await import('../agents/contract-analyzer.js')
const { reviewContract } = await import('../agents/contract-reviewer.js')
const { extractReviewPayload } = await import('../services/annotation-locator.js')
const { getFlashModel } = await import('../services/llm-client.js')

const round4 = (v) => Number(Number(v || 0).toFixed(4))
const mean = (a) => (a.length ? a.reduce((s, v) => s + Number(v || 0), 0) / a.length : 0)
const model = getFlashModel()
const supplementKeywords = /(建议补充|未约定|缺少|缺失|应增加|宜增加|未见.*条款|补充条款)/

const analyze = (f) => {
  const level = {}
  let withEv = 0, supplement = 0
  const cited = new Set()
  for (const item of (f.findings || [])) {
    level[item.level] = (level[item.level] || 0) + 1
    const refs = Array.isArray(item.evidence) ? item.evidence : []
    if (refs.length) withEv++
    for (const ref of refs) cited.add(String(ref))
    if (supplementKeywords.test(`${item.title || ''}${item.risk || ''}${item.advice || ''}`)) supplement++
  }
  const dRefs = (JSON.stringify(f).match(/\[D\d+\]/g) || [])
  return { count: (f.findings || []).length, level, withEv, supplement, citedE: cited.size, completeness: (f.completeness || []).length }
}

kb.initialize()
const cases = kb.listEvaluationCases({ limit: 100 })
console.log(`[e2e-batch] ${cases.length} 例 × 2 模式，模型 ${model}，开始…`)
const results = []
const startedAll = Date.now()

for (const [index, item] of cases.entries()) {
  const tag = `[${index + 1}/${cases.length}] ${item.contract_type}｜${(item.source_file || '').slice(0, 24)}`
  try {
    // Agent 1 共享：两模式同一份分析报告（控制变量）
    const analysisReport = await analyzeContract(item.input_excerpt, () => {}, model)
    const reviewPlan = buildReviewPlan({
      analysisReport,
      contractText: item.input_excerpt,
      userInstruction: '请识别合同中需要修改的风险条款。'
    })
    const evidence = await kb.searchEvidence(reviewPlan, {
      limit: 12, subType: reviewPlan.subType || ''
    })
    // 范本构造一次，两模式复用
    const exemplar = evidence.find((x) => x.referenceRole === 'excellent_template' && x.kind === 'clause')
    const wholeTemplate = exemplar ? kb.getWholeTemplateForReview(exemplar.templateId) : null

    const runMode = async (mode) => {
      const startedAt = Date.now()
      const output = await reviewContract({
        contractText: item.input_excerpt,
        analysisReport,
        evidence,
        reviewPlan,
        userInstruction: '请识别合同中需要修改的风险条款。',
        round: 1,
        wholeTemplate: mode === 'dual' ? wholeTemplate : null
      }, model)
      const parsed = extractReviewPayload(output) || {}
      return { stats: analyze(parsed), ms: Date.now() - startedAt, raw: parsed }
    }

    const baseline = await runMode('baseline')
    const dual = await runMode('dual')
    results.push({
      id: item.id, type: item.contract_type, source: item.source_file,
      expectedCategories: JSON.parse(item.expected_categories || '[]'),
      deliveredCategories: [...new Set(evidence.map((x) => x.category).filter(Boolean))],
      wholeTemplate: wholeTemplate ? { name: wholeTemplate.name, clauseCount: wholeTemplate.clauses.length, chars: wholeTemplate.chars } : null,
      baseline: { ...baseline.stats, ms: baseline.ms },
      dual: { ...dual.stats, ms: dual.ms },
      findingsBaseline: baseline.raw.findings || [],
      findingsDual: dual.raw.findings || [],
      completenessBaseline: baseline.raw.completeness || [],
      completenessDual: dual.raw.completeness || []
    })
    console.log(`${tag} ✅ 基线${baseline.stats.count}条(高${baseline.stats.level['高'] || 0}) 引用${baseline.stats.withEv}/${baseline.stats.count} ｜ dual${dual.stats.count}条(高${dual.stats.level['高'] || 0}) 引用${dual.stats.withEv}/${dual.stats.count} ｜ ${((Date.now() - startedAll) / 1000 / 60).toFixed(1)}min`)
  } catch (error) {
    console.log(`${tag} ❌ ${error.message}`)
    results.push({ id: item.id, type: item.contract_type, source: item.source_file, error: error.message })
  }
}

const ok = results.filter((r) => !r.error)
const agg = (mode) => {
  const rows = ok.map((r) => r[mode])
  const n = ok.length
  return {
    cases: n,
    meanCount: round4(mean(rows.map((r) => r.count))),
    meanHigh: round4(mean(rows.map((r) => r.level['高'] || 0))),
    highRate: round4(mean(rows.map((r) => (r.level['高'] || 0) / Math.max(1, r.count)))),
    meanCitedEvidence: round4(mean(rows.map((r) => r.citedE))),
    meanCitationRate: round4(mean(rows.map((r) => (r.count ? r.withEv / r.count : 0)))),
    meanSupplement: round4(mean(rows.map((r) => r.supplement))),
    meanCompleteness: round4(mean(rows.map((r) => r.completeness))),
    meanMs: Math.round(mean(rows.map((r) => r.ms)))
  }
}
const summary = {
  generatedAt: new Date().toISOString(),
  model,
  cases: ok.length,
  failed: results.length - ok.length,
  baseline: agg('baseline'),
  dual: agg('dual'),
  results
}
writeFileSync(join(__dirname, '..', 'knowledge-base', 'e2e-batch-result.json'), JSON.stringify(summary, null, 1))
console.log('\n===== 全量 A/B 汇总 =====')
console.log(`用例 ${ok.length}/${results.length}｜模型 ${model}｜总耗时 ${((Date.now() - startedAll) / 60000).toFixed(1)} min`)
for (const [name, s] of [['baseline(仅证据)', summary.baseline], ['dual(证据+范本)', summary.dual]]) {
  console.log(`${name.padEnd(16)} 批注${s.meanCount}｜高占比${s.highRate}｜引用率${s.meanCitationRate}｜引用证据数${s.meanCitedEvidence}/12｜缺失类${s.meanSupplement}｜completeness${s.meanCompleteness}｜${Math.round(s.meanMs / 1000)}s`)
}
console.log('明细已写 server/knowledge-base/e2e-batch-result.json')
kb.close()
