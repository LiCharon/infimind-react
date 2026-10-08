import { readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'

const arg = (name) => { const index = process.argv.indexOf(name); return index < 0 ? '' : process.argv[index + 1] }
const input = arg('--input'), output = arg('--output')
if (!input || !output) throw new Error('用法：node server/scripts/export-arbitration-legal-review.js --input <隔离测试目录> --output <核对包.md>')
const roots = input.split(',').map((path) => resolve(path.trim()))
const lines = ['# 劳动仲裁答辩法务核对包', '', `生成日期：${new Date().toISOString().slice(0, 10)}。来源：${roots.join('；')}`, '',
  '本包用于公司法务逐请求核对，不是法律验收结论。样例来自团队获准意见或虚构案件；参考意见本身不是标准答案。', '',
  '每项请给出：可用／补充条件后可用／不合理／材料不足；注明问题、必要条件和建议表达。产品流程由用户与带教验收，法律适用与风险口径由公司法务验收。', '']
let cases = 0, requests = 0
for (const root of roots) {
for (const name of (await readdir(root)).filter((name) => /^(?:approved-opinion-\d+|staged-analysis(?:-repeat)?|http-(?:initial|followup|draft-v2)|revisions-(?:initial|draft|receipt|corrected|conflict|reply))\.json$/.test(name)).sort()) {
  const payload = JSON.parse(await readFile(join(root, name), 'utf8'))
  const result = payload.result
  if (!result?.caseRecord) continue
  cases++
  lines.push(`## ${name.replace('.json', '')}`, '', `批次目录：${root}；不同批次不合并作为稳定性结论。`, '', `案件版本：${result.caseVersion}；整体风险：${result.overallRisk}（待法务核对）；草稿状态：${result.draftStatus || '未要求生成'}。`, '')
  lines.push(`分析任务：${result.analysisTaskId || '无'}；材料签名：${result.materialSignature || '无'}；草稿依据：${result.draftBasis ? JSON.stringify(result.draftBasis) : '未生成'}。`, '')
  if (result.draftStatus === 'failed') lines.push('**本次草稿未通过检查，未向用户发布。以下分析保留供法务核对。**', '', result.draftError?.message || '', '')
  for (const request of result.caseRecord.requests) {
    requests++
    const claim = result.claims?.find((claim) => claim.requestId === request.id)
    lines.push(`### ${request.text}`, '', `请求编号：${request.id}`, '', '**请求原文与来源**', '')
    for (const source of request.sources || []) lines.push(`${source.sourceName}${source.line ? ` · 第${source.line}行` : ''}；${source.located ? '已匹配原文（不代表事实已证明）' : '未定位，待核实'}`, '', `> ${source.quote.replace(/\n/g, '\n> ')}`, '')
    lines.push('**模型分析（待验收）**', '', `企业答辩方向：${claim?.companyPosition || '本轮未重列，请看对应分析结果'}`, '',
      `风险：${claim?.riskLevel || '未列'}；理由：${claim?.riskReason || '见对应分析结果'}`, '', `具体分析：${claim?.reasoning || '见对应分析结果'}`, '',
      '**待证事实与来源属性**', '')
    for (const fact of result.caseRecord.facts.filter((fact) => !fact.requestIds?.length || fact.requestIds.includes(request.id))) {
      lines.push(`- ${fact.kind}：${fact.text}；来源：${fact.sources.map((source) => `${source.sourceName}${source.line ? `第${source.line}行` : ''}${source.located ? '' : '（未定位）'}`).join('；')}`)
    }
    lines.push('', '**法规及参考资料**', '')
    for (const law of claim?.legalBasis || []) lines.push(`- ${law.name} ${law.article || ''}：${law.note || '具体条文及适用性待核对'}`)
    for (const ref of result.retrievalSnapshot || []) if (ref.requestId === request.id) lines.push(`- ${ref.id}：${ref.title}（${ref.sourceType}，只作参考）`)
    lines.push('', '**法务意见：待填写**', '', '- 结论：', '- 立场／风险／条文与适用前提：', '- 缺少的证据或事实：', '- 建议表达：', '')
  }
  if (result.reviewNotes?.length) lines.push('### 模型复核提示（不是法务结论）', '', ...result.reviewNotes.map((note) => `- ${note}`), '')
  if (result.stageUsage?.length) lines.push('<details><summary>模型与提示词批次追踪</summary>', '', ...result.stageUsage.map((call) => `- ${call.stage}；模型${call.model}；提示词${call.promptHash}；输入${call.inputHash}`), '', '</details>', '')
  if (result.defenseDraft) lines.push('### 完整草稿（待法务复核）', '', result.defenseDraft, '')
}
}
if (!cases) throw new Error('指定目录未找到v2样例结果；未生成空核对包。')
await writeFile(resolve(output), lines.join('\n'), 'utf8')
console.log(`已生成法务核对包：${cases}份结果、${requests}项请求；${resolve(output)}`)
