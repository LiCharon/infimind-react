/**
 * 对已批注坏例执行离线检索回归评测。
 * 不调用审查模型：将风险条款作为查询，排除它自己的源文件，衡量知识库是否
 * 仍能召回同类型的风险模式和正向条款。用法：npm run evaluate:knowledge-base
 */
import { writeFile } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { initialize, listEvaluationCases, searchEvidence, getKnowledgeBaseStatus, close } from '../services/knowledge-base.js'
import { buildReviewPlan } from '../services/review-plan.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outputPath = join(__dirname, '..', 'knowledge-base', 'evaluation-report.json')
const limit = Number(process.env.RAG_EVALUATION_LIMIT || 100)
const topK = Number(process.env.RAG_EVALUATION_TOP_K || 10)

async function main() {
  initialize()
  const cases = listEvaluationCases({ limit })
  if (!cases.length) throw new Error('没有评测样本，请先执行 npm run import:templates')

  const reports = []
  for (const item of cases) {
    const expectedCategories = JSON.parse(item.expected_categories || '[]')
    const plan = buildReviewPlan({
      analysisReport: `# 合同基础识别\n- 合同类型：${item.contract_type}`,
      contractText: item.input_excerpt,
      userInstruction: '请识别合同中需要修改的风险条款。'
    })
    const evidence = await searchEvidence(plan, { limit: topK, excludeTemplateId: item.template_id })
    const retrievedCategories = [...new Set(evidence.map((result) => result.category).filter(Boolean))]
    const matchedCategories = expectedCategories.filter((category) => retrievedCategories.includes(category))
    reports.push({
      caseId: item.id,
      source: item.source_file,
      contractType: item.contract_type,
      expectedCategories,
      retrievedCategories,
      matchedCategories,
      categoryRecall: expectedCategories.length ? Number((matchedCategories.length / expectedCategories.length).toFixed(4)) : 1,
      positiveEvidencePresent: evidence.some((result) => result.referenceRole === 'excellent_template'),
      negativeEvidencePresent: evidence.some((result) => result.referenceRole === 'annotated_case' && result.kind === 'risk_rule'),
      evidence: evidence.map((result) => ({ id: result.evidenceId, source: result.sourceName, role: result.referenceRole, kind: result.kind, category: result.category, title: result.title }))
    })
  }

  const average = (field) => Number((reports.reduce((sum, item) => sum + Number(item[field] || 0), 0) / reports.length).toFixed(4))
  const report = {
    generatedAt: new Date().toISOString(),
    config: { limit, topK },
    knowledgeBase: getKnowledgeBaseStatus(),
    summary: {
      cases: reports.length,
      meanCategoryRecall: average('categoryRecall'),
      positiveEvidenceCoverage: average('positiveEvidencePresent'),
      negativeEvidenceCoverage: average('negativeEvidencePresent')
    },
    cases: reports
  }
  await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8')
  console.log(JSON.stringify(report.summary, null, 2))
  console.log(`[evaluate-knowledge-base] Report written: ${outputPath}`)
  close()
}

main().catch((error) => {
  console.error('[evaluate-knowledge-base] Failed:', error.message || error)
  close()
  process.exit(1)
})
