// Opt-in live benchmark. Only the fixed fictional fixtures below leave this
// machine. No task DB/queue writes, private contracts or retrieved KB snippets.
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createLaborContractAnalysisWorkflow } from '../workflows/labor-contract-analysis.js'
import { createLaborDispatchAnalysisWorkflow } from '../workflows/labor-dispatch-analysis.js'
import { auditLaborOccupationalResponsibilities, auditLaborMonthlyDates, auditLaborRevisionDefaults, auditLaborRevisionPositions, laborReadOnlyGroupIds } from '../services/labor-analysis-units.js'
import { streamChat } from '../services/llm-client.js'

if (!process.argv.includes('--live')) {
  console.log('需显式 --live 才调用已配置的 DeepSeek；仅发送固定虚构样例和公开法规目录。')
  process.exit(0)
}
const valueAfter = (name) => process.argv[process.argv.indexOf(name) + 1]
const modes = process.argv.includes('--mode') ? [valueAfter('--mode')] : ['fast', 'thinking']
if (modes.some((mode) => !['fast', 'thinking'].includes(mode))) throw new Error('mode 必须为 fast 或 thinking')
const repeat = process.argv.includes('--repeat') ? Number(valueAfter('--repeat')) : 1
if (!Number.isInteger(repeat) || repeat < 1 || repeat > 5) throw new Error('repeat 必须为 1 到 5')
const benchmarkRoot = join(tmpdir(), 'fafee-labor-batch-benchmark')
mkdirSync(benchmarkRoot, { recursive: true })
const outputDirectory = mkdtempSync(join(benchmarkRoot, `${Date.now()}-`))
console.log(`Benchmark artifacts: ${outputDirectory}`)
const ordinary = `【完全虚构，仅用于分析链路检查，不是合同范本或法律金标准】
劳动合同
甲方：合成样例科技公司；乙方：虚构劳动者甲。
第一条 固定期限为2026年10月1日至2027年9月30日，试用期6个月。
第二条 乙方从事客户支持工作，日常工作地点上海市浦东新区；甲方可以随时调至全国任何地点，乙方不得拒绝。
第三条 月工资8000元，每月15日支付；加班工资基数按当地最低工资确定，工资提出异议期限为三日，逾期视为放弃。
第四条 标准工时，每日8小时、每周40小时；所有加班工资已包含在上述月工资中。
第五条 双方按实际工资依法参加社会保险，但乙方提交参保材料迟延时甲方可立即解除合同且不支付补偿。
第六条 甲方可以仅凭主管认定乙方试用期不合格而立即解除，无需提供考核记录或告知理由。
第七条 保密范围限于未公开的商业秘密，信息依法公开后保密义务终止。
第八条 所有员工离职后五年内不得从事同业工作，不支付补偿，违反者支付违约金50万元。
第九条 双方盖章签字生效，签订日期2026年9月20日；未上传附件或制度材料。`
const fixture = (name) => readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8')
let activeTrace = []
const streamGenerate = async function* (request) {
  let content = ''
  let finishReason = null
  try {
    for await (const chunk of streamChat(request.systemPrompt, request.userMessage, {
      model: 'deepseek-flash', thinking: { type: request.mode === 'fast' ? 'disabled' : 'enabled' },
      ...(request.mode === 'fast' ? {} : { reasoningEffort: 'low' }), responseFormat: { type: 'json_object' },
      maxTokens: request.maxTokens, signal: request.signal, requestTimeoutMs: request.requestTimeoutMs, maxAttempts: 1
    })) { content += chunk.content || ''; finishReason = chunk.finishReason || finishReason; yield chunk }
  } finally { activeTrace.push({ phase: request.phase, mode: request.mode, finishReason, content }) }
}
const samples = [
  { name: 'ordinary', type: 'ordinary_labor_contract', run: createLaborContractAnalysisWorkflow({ retrieveEvidence: async () => [], streamGenerate }),
    documents: [{ fileId: 'synthetic-ordinary', fileName: '虚构劳动合同.txt', text: ordinary }] },
  { name: 'dispatch-paired', type: 'labor_dispatch_agreement', run: createLaborDispatchAnalysisWorkflow({ retrieveEvidence: async () => [], streamGenerate }),
    documents: [
      { fileId: 'synthetic-agreement', fileName: '虚构派遣协议.txt', role: 'dispatch_agreement', text: fixture('labor-dispatch-agreement.synthetic.txt') },
      { fileId: 'synthetic-employment', fileName: '虚构派遣劳动合同.txt', role: 'dispatch_employment_contract', text: fixture('labor-dispatch-employment-contract.synthetic.txt') }
    ] }
]
for (const name of ['quality-risk', 'quality-control']) samples.push({ name, type: 'ordinary_labor_contract',
  run: createLaborContractAnalysisWorkflow({ retrieveEvidence: async () => [], streamGenerate }),
  documents: [{ fileId: `synthetic-${name}`, fileName: `虚构派遣劳动合同-${name}.txt`, role: 'dispatch_employment_contract',
    text: fixture(`labor-${name}.synthetic.txt`) }] })
const sampleName = process.argv.includes('--sample') ? valueAfter('--sample') : null
if (sampleName && !samples.some(({ name }) => name === sampleName)) throw new Error('未知 sample')

// Screening signals are followed by manual reading; not a legal gold standard.
function qualityScreen(result, sample) {
  const findings = result.findings || []
  if (sample.name === 'dispatch-paired') {
    const readOnlyIds = laborReadOnlyGroupIds((result.revisions || []).map((revision) => ({ ...revision, id: revision.findingId })), sample.documents, ['dispatch_employment_contract'])
    const checks = {
      usingUnitDoesNotRewriteAgencyLaborContract: (result.revisions || []).filter((revision) => readOnlyIds.has(revision.findingId))
        .every((revision) => revision.rewrittenText === revision.originalText && revision.localizedEdits.every((edit) => edit.operation === 'notice')),
      // Using-unit review does not commission rewrites of the agency's labor
      // contract. A specific cross-document warning is a valid detection.
      shortDispatchEmploymentTermDetected: findings.some((finding) => /期限|二年|两年/.test(`${finding.title} ${finding.explanation || ''} ${finding.risk || ''}`)
        && /劳动合同|2027/.test(`${finding.quote} ${finding.title} ${finding.explanation || ''} ${finding.risk || ''}`))
        || (result.warnings || []).some((warning) => /劳动合同/.test(warning) && /2026.{0,25}2027/.test(warning)
          && /(?:未满|不足)(?:二|两|2)年|未满两个完整日历年/.test(warning)),
      noFalseTwoYearCalendarClaim: !(result.warnings || []).some((warning) => /2026.{0,25}2027/.test(warning)
        && /已满(?:二|两|2)年/.test(warning.replace(/(?:不能|不得|不应|不可|不宜|并非|不)(?:视为|当作|认定为|认为|写成|说成|称为)?已满(?:二|两|2)年/g, ''))),
      agreedMonthlyDatesPreserved: auditLaborMonthlyDates(result.revisions || []).length === 0,
      occupationalResponsibilityNotTransferred: auditLaborOccupationalResponsibilities(result.revisions || [], sample.documents).length === 0,
      noAgencyChangeAsUsingUnitReturnGround: !(result.revisions || []).some((revision) => /退回/.test(revision.rewrittenText || '')
        && /甲方.{0,14}劳动合同.{0,70}客观情况发生重大变化/.test(revision.rewrittenText || ''))
    }
    return { checks, screeningFailures: Object.entries(checks).filter(([, passed]) => !passed).map(([key]) => key),
      limitations: '固定成套虚构样例，仅检查已知日期与主体混淆；仍需逐条阅读。' }
  }
  const allAdvice = findings.map((finding) => `${finding.title} ${finding.risk || finding.explanation} ${finding.advice || finding.recommendation}`).join('\n')
  const allRewrites = (result.revisions || []).map((revision) => revision.rewrittenText || '').join('\n')
  const info = result.contractInfo || {}
  const source = sample.documents.map((document) => document.text).join('\n')
  const checks = {
    termExtracted: /2026/.test(info.term || '') && /2028/.test(info.term || ''),
    probationExtracted: (sample.name === 'quality-control' ? /二|2/ : /六|6/).test(info.probation || ''),
    employerIsDispatchUnit: /合成派遣公司甲/.test(info.employer || ''),
    noInventedCourtMajority: !/多数(?:裁判|法院)|普遍.{0,8}(?:三|五|3|5)天/.test(allAdvice),
    noInventedAbsenceThreshold: !/(?:连续)?(?:三|五|3|5)(?:天|日).{0,14}(?:旷工|严重违纪)|旷工.{0,15}(?:三|五|3|5)(?:天|日)/.test(allRewrites),
    noInventedBusinessDefaults: auditLaborRevisionDefaults(result.revisions || [], source).length === 0,
    agreedMonthlyDatesPreserved: auditLaborMonthlyDates(result.revisions || []).length === 0,
    noInventedPastNonperformance: !/签订时.{0,16}(?:尚未|未曾|没有).{0,8}(?:提供|告知|签署)/.test(allRewrites),
    noContradictoryMonthlyPayOmission: !findings.some((finding) => /按月/.test(finding.quote || '') && /未.{0,14}按月/.test(finding.title || '')),
    noFalseNationalSickPayFloor: !findings.some((finding) => /病假/.test(finding.quote || '')
      && /(?:低于|违反|违法|不足).{0,12}(?:法定|最低|下限)|(?:法定|最低|下限).{0,12}(?:不足|违法|低于)/.test(finding.title || ''))
  }
  if (sample.name === 'quality-risk') {
    const contains = (pattern) => findings.some((finding) => pattern.test(`${finding.quote} ${finding.title} ${finding.risk || finding.explanation}`))
    Object.assign(checks, { probationRiskFound: contains(/试用期.{0,14}(?:六|6|超过|过长|二个月|2个月)/),
      noPureStatutoryRestatementRisk: !findings.some((finding) => /未约定.{0,30}(?:退回|证明|转移)|退回条件未区分/.test(finding.title || '')),
      wageHandoverRiskFound: contains(/工资.{0,50}(?:交接|停付)/),
      trialTerminationRiskFound: contains(/试用期.{0,80}(?:第四十条|解除)/),
      absenceThresholdRiskFound: contains(/(?:旷工|不到岗|缺勤|未到岗).{0,100}(?:严重|证据|违纪|解除)/),
      workerConsentRiskFound: contains(/(?:调薪|下调|工资|变更).{0,100}(?:同意|协商|通知)/),
      wageRewriteSeparatesCompensation: (result.revisions || []).some((revision) => /工资/.test(revision.rewrittenText || '')
        && /经济补偿.{0,40}(?:交接|交接.{0,10}支付)/.test(revision.rewrittenText || '') && /工资.{0,40}(?:不以|不得以|不能因|不因|及时|一次性|一次付清)/.test(revision.rewrittenText || '')),
      trialRewriteLimitsArticle40: (result.revisions || []).some((revision) => /第四十条.{0,12}第一项.{0,8}第二项/.test(revision.rewrittenText || '')),
      consentRewriteRequiresWorkerAgreement: (result.revisions || []).some((revision) => /(?:乙方|劳动者).{0,20}协商一致|协商一致.{0,20}(?:乙方|劳动者)/.test(revision.rewrittenText || '') && /(?:变更|工资)/.test(revision.rewrittenText || '')) })
  }
  if (sample.name === 'quality-control') Object.assign(checks, {
    noCompliantProbationOverlimitRisk: !findings.some((finding) => /试用期/.test(finding.title || '') && /超(?:过|长|限)|过长|违法/.test(finding.title || '')),
    noCompliantWorkerConsentOmissionRisk: !findings.some((finding) => /协商一致/.test(finding.quote || '') && /(?:未|缺乏|缺少).{0,12}(?:劳动者|乙方).{0,12}(?:同意|协商)/.test(finding.title || ''))
  })
  return { checks, screeningFailures: Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name),
    limitations: '自动规则只筛查特定回归错误；需人工读原文、每条风险和修订，不能证明全部法理或漏检率。' }
}
const baseline = process.argv.includes('--baseline') ? JSON.parse(readFileSync(valueAfter('--baseline'), 'utf8')) : null
const report = { generatedAt: new Date().toISOString(), provider: 'configured DeepSeek', retrieval: 'disabled; public law catalog only',
  limitations: '固定虚构样例；自动指标不判定法律正确性或漏检。只有同样例同模式的旧记录才作耗时对比。', cases: [] }
for (let iteration = 1; iteration <= repeat; iteration += 1) for (const mode of modes) for (const sample of samples) {
  if (sampleName ? sample.name !== sampleName : sample.name.startsWith('quality-')) continue
  const saved = new Map()
  activeTrace = []
  const startedAt = Date.now()
  const artifactName = `${sample.name}-${mode}${repeat > 1 ? `-${iteration}` : ''}`
  const metrics = { sample: sample.name, mode, iteration, sampleHash: createHash('sha256').update(JSON.stringify(sample.documents)).digest('hex'), units: [], stages: [] }
  const emit = async (event, data) => {
    if (event === 'stage.start') { metrics.stages.push({ stage: data.stage, atMs: Date.now() - startedAt }); console.log(JSON.stringify({ sample: sample.name, mode, stage: data.stage, elapsedMs: Date.now() - startedAt })) }
    if (event === 'model.complete' || event === 'model.interrupted') {
      metrics.units.push({ event, ...data })
      if (event === 'model.interrupted') console.log(JSON.stringify({ sample: sample.name, mode, event, stage: data.stage, code: data.code, unit: data.unit }))
    }
    if (event === 'stage.progress' && data.stage === 'review' && data.validResults > 0 && metrics.firstSavedRiskMs === undefined) metrics.firstSavedRiskMs = Date.now() - startedAt
  }
  try {
    const result = await sample.run({ task: { id: `benchmark-${sample.name}-${mode}`, mode },
      input: { action: 'analyze', analysisType: sample.type, reviewPerspective: 'using_unit' }, sourceDocuments: sample.documents,
      emit, checkpoint: async (stage, data) => saved.set(stage, { result: data }), getCheckpoint: (stage) => saved.get(stage) })
    const original = sample.documents.map(({ fileName, text }) => `=== 文件：${fileName} ===\n${text}`).join('\n\n')
    Object.assign(metrics, { status: 'succeeded', durationMs: Date.now() - startedAt, findings: result.findings.length,
      duplicateFindings: result.findings.length - new Set(result.findings.map(({ title, quote }) => `${title}::${quote}`)).size,
      annotations: result.revisions.length, unresolved: result.annotationStats?.unresolved || 0,
      positionConflicts: auditLaborRevisionPositions(result.revisions, original),
      sourcePreserved: result.sourceDocuments.every((document, index) => document.text === sample.documents[index].text),
      reviewRounds: result.reviewRounds.map(({ round, newCount }) => ({ round, newCount })), score: result.score })
    if (sample.name.startsWith('quality-') || sample.name === 'dispatch-paired') metrics.quality = qualityScreen(result, sample)
    writeFileSync(join(outputDirectory, `${artifactName}.json`), JSON.stringify(result, null, 2))
  } catch (error) {
    Object.assign(metrics, { status: 'failed', durationMs: Date.now() - startedAt, code: error.code, message: error.message,
      retainedFindings: Math.max(saved.get('review')?.result?.combinedFindings?.length || 0, saved.get('review-pages')?.result?.payload?.findings?.length || 0),
      retainedAnnotations: saved.get('rewrite-batches')?.result?.revisions?.length || 0 })
  }
  const previous = baseline?.cases?.find((item) => item.sampleHash === metrics.sampleHash && item.mode === mode && item.status === 'succeeded')
  if (previous && metrics.status === 'succeeded') metrics.comparison = { previousDurationMs: previous.durationMs, currentDurationMs: metrics.durationMs,
    previousFindings: previous.findings, currentFindings: metrics.findings, previousAnnotations: previous.annotations, currentAnnotations: metrics.annotations }
  report.cases.push(metrics)
  writeFileSync(join(outputDirectory, `${artifactName}-trace.json`), JSON.stringify(activeTrace, null, 2))
  writeFileSync(join(outputDirectory, `${artifactName}-checkpoints.json`), JSON.stringify(Object.fromEntries(saved), null, 2))
  writeFileSync(join(outputDirectory, 'metrics.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ ...metrics, units: metrics.units.length, stages: metrics.stages.length }))
}
console.log(`Benchmark artifacts: ${outputDirectory}`)
if (report.cases.some(({ status, quality }) => status !== 'succeeded' || quality?.screeningFailures?.length)) process.exitCode = 1
