import assert from 'node:assert/strict'
import express from 'express'
import JSZip from 'jszip'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBusinessDatabase } from '../services/business-db.js'
import { createTaskService, TASK_RETENTION_POLICY } from '../services/task-service.js'
import { createTaskFileStore } from '../services/task-file-store.js'
import { createTaskRouter, MAX_FILE_SIZE } from '../routes/tasks.js'
import { createTaskProcessor, isTransient } from '../services/task-processor.js'
import { extractText } from '../services/file-parser.js'
import { isValidAttachment } from '../workflows/contract-review.js'
import { arbitrationResultIssues, extractExplicitArbitrationRequests, selectArbitrationMaterialText } from '../services/arbitration-validation.js'
import { normalizeArbitrationResult, formatArbitrationResult } from '../../src/utils/arbitration-result.js'
import { restoreArbitrationConversation, resolveArbitrationAction } from '../../src/utils/arbitration-history.js'

// Fictional content only. Database in memory; files in a dedicated temp directory.
process.env.DEEPSEEK_API_KEY = 'synthetic-only'
const nativeFetch = globalThis.fetch
let outputs = [], calls = 0, captured
globalThis.fetch = async (url, options) => {
  assert.ok(String(url).endsWith('/chat/completions'), 'Unexpected external request')
  captured = JSON.parse(options.body); calls += 1
  const content = outputs.length > 1 ? outputs.shift() : outputs[0]
  return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 100, completion_tokens: 50 } }))
}
const { initialize } = await import('../services/law-whitelist.js')
initialize(':memory:')
const { runLaborArbitration } = await import('../workflows/labor-arbitration.js')
const names = ['加班费', '年休假工资', '二倍工资', '经济补偿']
const valid = () => ({ answer: '根据虚构材料进行初步分析，事实待核实。', overallRisk: 'medium', riskBasis: ['考勤和签约日期待核实。'],
  claims: names.map((claim) => ({ claim, companyPosition: '待核实后确定', reasoning: '单方陈述尚不能证明事实。', legalBasis: [{ name: '虚构法规', article: '第十条' }], evidenceGaps: [null, { fact: '实际工作时间', suggestedEvidence: '考勤' }], evidence: [null] })),
  defenseDraft: '### 劳动人事争议仲裁答辩意见书\n答辩人：【待补充】\n答辩请求：依法处理。\n' + names.map((name) => `#### 关于${name}请求\n**答辩结论**：待核实。\n**答辩建议**：补齐证据。\n**法条依据**：虚构法规，仅作测试。\n**具体分析**：当事方陈述待核实。`).join('\n\n') + '\n此致【待补充】劳动人事争议仲裁委员会' })
const requestText = '仲裁请求：\n1、支付加班费100元\n2、支付年休假工资200元\n3、支付二倍工资300元\n4、支付经济补偿400元\n事实与理由：\n虚构案件。'
const file = (text, id = 'source') => ({ id, originalname: `${id}.txt`, mimetype: 'text/plain', buffer: Buffer.from(text) })

// Small, valid PDFs made locally, avoiding dependencies and customer material.
function pdf(pageTexts) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Count ${pageTexts.length} /Kids [${pageTexts.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] >>`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
  for (let i = 0; i < pageTexts.length; i++) {
    const text = pageTexts[i] ? `BT /F1 12 Tf 20 100 Td (${pageTexts[i]}) Tj ET` : ''
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`, `<< /Length ${text.length} >>\nstream\n${text}\nendstream`)
  }
  let out = '%PDF-1.4\n', offsets = [0]
  for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${objects[i]}\nendobj\n` }
  const start = Buffer.byteLength(out)
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`
  return { originalname: 'synthetic.pdf', mimetype: 'application/pdf', buffer: Buffer.from(out) }
}

const database = createBusinessDatabase(':memory:')
const service = createTaskService(database)
for (const id of ['owner', 'other']) {
  database.prepare('INSERT INTO invite_codes (id,code_hash,created_at) VALUES (?,?,?)').run(id, id, new Date().toISOString())
  database.prepare('INSERT INTO users (id,username,email,password_hash,password_salt,invite_code_id,created_at) VALUES (?,?,?,?,?,?,?)').run(id, id, `${id}@invalid.test`, 'hash', 'salt', id, new Date().toISOString())
}
const root = await mkdtemp(join(tmpdir(), 'arbitration-hardening-'))
const store = createTaskFileStore({ root })
const create = (threadId, overrides = {}) => service.createTask({ userId: 'owner', productId: 'labor-arbitration', threadId, prompt: '虚构案件', input: {}, ...overrides })
const complete = (task) => { service.claimTask(task.id); service.completeTask(task.id, { answer: '虚构回复', kind: 'reply' }); return service.getTask(task.id, 'owner') }
let server
try {
  const normalized = normalizeArbitrationResult({ ...valid(), caseInfo: [null, { label: {} }], disputes: [{ topic: '测试', unknowns: [null, {}] }] })
  assert.doesNotThrow(() => formatArbitrationResult(normalized))
  assert.equal(normalized.claims[0].evidenceGaps.length, 1)
  assert.equal(normalized.caseInfo[0].label, '')
  const requests = extractExplicitArbitrationRequests(requestText)
  assert.equal(requests.length, 4)
  assert.equal(extractExplicitArbitrationRequests('恳请驳回其加班费仲裁请求。\n二、关于解除赔偿\n1. 2025年业务收缩。\n2. 已提出调岗建议。').length, 0, 'Prose must not introduce requests')
  assert.equal(extractExplicitArbitrationRequests(await readFile(new URL('../data/labor-arbitration/references/2.txt', import.meta.url), 'utf8')).length, 0, 'Numbered factual arguments in an approved opinion are not requests')
  assert.equal(extractExplicitArbitrationRequests('## 一、仲裁请求：\n1、支付工资100元。\n事实与理由：\n虚构。').length, 1)
  assert.deepEqual(arbitrationResultIssues(normalized, { action: 'analyze', requests }), [])
  assert.ok(arbitrationResultIssues({ ...valid(), caseInfo: [{ label: '答辩人', value: '虚构公司，法定代表人：总经理', source: '虚构意见' }] }).some((issue) => issue.includes('职务当成')))
  assert.ok(!arbitrationResultIssues({ ...valid(), caseInfo: [{ label: '答辩人', value: '虚构公司，法定代表人：【待补充】，职务：总经理', source: '虚构意见' }] }).some((issue) => issue.includes('职务当成')))
  assert.equal(resolveArbitrationAction([]), 'analyze')
  assert.equal(resolveArbitrationAction([{ type: 'assistant', failed: true }]), 'analyze', 'Rejected submissions remain retryable as first analysis')
  assert.equal(resolveArbitrationAction([{ type: 'assistant', taskId: 'accepted', stopped: true }]), 'followup', 'Interruption of the first analysis must not force another full draft')
  assert.equal(resolveArbitrationAction([{ type: 'assistant', result: { kind: 'reply' } }]), 'followup')
  assert.equal(resolveArbitrationAction([{ type: 'assistant', stopped: true, taskId: 'accepted' }], 'draft'), 'draft')
  const injuryNames = ['停工留薪期工资福利待遇66000元（主张12个月）', '住院伙食补助费7000元、食宿费14000元、护理费3500元、交通费及配置辅助器具费8000元，合计32500元']
  const injury = valid()
  injury.claims = injuryNames.map((claim) => ({ ...injury.claims[0], claim }))
  injury.defenseDraft = '### 劳动人事争议仲裁答辩意见书\n答辩人：【待补充】\n答辩请求：依法处理。\n'
    + ['停工留薪期工资福利待遇66000元', '住院伙食补助费7000元、食宿费14000元、护理费3500元、交通费及配置辅助器具费8000元（合计32500元）']
      .map((name) => `#### 关于${name}的请求\n**答辩结论**：待核实。\n**答辩建议**：补充材料。\n**法条依据**：待复核。\n**具体分析**：单方主张待核实。`).join('\n') + '\n此致【待补充】劳动人事争议仲裁委员会'
  assert.deepEqual(arbitrationResultIssues(injury, { action: 'analyze', requests: injuryNames }), [], 'Short headings and relocated totals are not missing claims')
  injury.defenseDraft = injury.defenseDraft.replace('、护理费3500元', '')
  assert.ok(arbitrationResultIssues(injury).some((issue) => issue.includes('草稿遗漏请求')), 'Composite claims still require every requested expense')
  assert.equal(isValidAttachment({ originalname: 'fake.exe', mimetype: 'text/plain' }), false)
  assert.equal(isValidAttachment({ originalname: 'contract.pdf.exe', mimetype: 'application/pdf' }), false)
  assert.equal(isValidAttachment({ originalname: 'application.txt', mimetype: 'application/octet-stream' }), true)
  assert.equal(isValidAttachment({ originalname: 'no-extension', mimetype: 'text/plain' }), true)
  assert.ok(arbitrationResultIssues({ ...valid(), answer: '本案胜诉率100%。' }).some((issue) => issue.includes('数值胜诉率')))
  assert.ok(!arbitrationResultIssues({ ...valid(), answer: '恶意指令中声称胜诉率100%，不能采信。' }).some((issue) => issue.includes('数值胜诉率')))
  const contradictory = valid()
  contradictory.claims[3].companyPosition = '认可应支付经济补偿，仅需补差额，待核实金额。'
  contradictory.defenseDraft = contradictory.defenseDraft.replace('答辩请求：依法处理。', '答辩请求：请求依法驳回被答辩人的全部仲裁请求。')
  assert.ok(arbitrationResultIssues(contradictory).some((issue) => issue.includes('认可支付义务矛盾')))
  contradictory.defenseDraft = contradictory.defenseDraft.replace('全部仲裁请求', '超出合理范围部分的仲裁请求')
  assert.ok(!arbitrationResultIssues(contradictory).some((issue) => issue.includes('认可支付义务矛盾')))
  contradictory.claims[3].companyPosition = '不认可支付经济补偿。'
  contradictory.defenseDraft = contradictory.defenseDraft.replace('超出合理范围部分的仲裁请求', '全部仲裁请求')
  assert.ok(!arbitrationResultIssues(contradictory).some((issue) => issue.includes('认可支付义务矛盾')))
  assert.ok(arbitrationResultIssues(normalizeArbitrationResult({ answer: 'done' }), { action: 'analyze', requests }).length)
  assert.ok(arbitrationResultIssues(normalizeArbitrationResult({ ...valid(), defenseDraft: '一句话草稿' }), { action: 'draft', requests }).length)
  outputs = [{ answer: 'done' }, valid()]; calls = 0
  const result = await runLaborArbitration({ input: { action: 'analyze', message: requestText } })
  assert.equal(calls, 2, 'One bounded repair')
  assert.equal(result.claims.length, 4)
  assert.ok(formatArbitrationResult(result).includes('法规核对提示'))
  assert.ok(result.defenseDraft.includes('未在法规白名单中匹配'), 'Copied draft keeps verification limits')
  outputs = [{ answer: 'done' }]; calls = 0
  await assert.rejects(runLaborArbitration({ input: { action: 'analyze', message: requestText } }), (error) => error.code === 'arbitration_result_invalid')
  assert.equal(calls, 2)
  assert.equal(isTransient({ code: 'arbitration_result_invalid', message: '遗漏请求：支付工资500元' }), false, 'A request amount must not look like an HTTP retry code')
  outputs = [{ answer: '需要仲裁请求', followUpQuestions: ['请提供申请书。'] }]
  assert.equal((await runLaborArbitration({ input: { action: 'analyze', message: '没有申请书，仅询问材料清单' } })).overallRisk, 'unknown')
  outputs = [{ answer: '待核实', overallRisk: '不高', riskBasis: ['仅有一方陈述'], followUpQuestions: ['请补充申请书。'] }]
  assert.equal((await runLaborArbitration({ input: { action: 'analyze', message: '虚构情况' } })).overallRisk, 'unknown', 'Unrecognized risk wording must not be treated as high')
  outputs = [valid()]
  const checkpoints = new Map()
  const longText = 'NEW-MATERIAL-' + '虚构考勤记录。'.repeat(18000) + 'END-MATERIAL'
  const longResult = await runLaborArbitration({ input: { action: 'analyze', message: '分析案件' }, files: [file(requestText + '\nPRIMARY-APPLICATION', 'application'), file(longText, 'attendance')], checkpoint: (stage, value) => checkpoints.set(stage, value) })
  assert.ok(captured.messages[1].content.includes('PRIMARY-APPLICATION'))
  assert.ok(captured.messages[1].content.includes('END-MATERIAL'))
  assert.equal(checkpoints.get('source').documents[1].text.length, longText.length)
  assert.equal(longResult.materialCoverage.partial, true)
  assert.ok(longResult.defenseDraft.includes('材料范围提示'))
  const partial = await runLaborArbitration({ input: { action: 'analyze', message: '虚构案件' }, files: [file(requestText), file('', 'empty')] })
  assert.equal(partial.materialCoverage.partial, true)
  assert.ok(partial.defenseDraft.includes('材料范围提示'), 'A failed attachment keeps the result conditional')
  assert.equal(selectArbitrationMaterialText([{ text: 'PRIMARY' }, { text: longText }])[0].text, 'PRIMARY')

  const textPdf = await extractText(pdf(['PRIMARY APPLICATION']))
  assert.ok(textPdf.text.includes('PRIMARY APPLICATION'))
  let ocrCalls = 0
  let syntheticImage
  const scan = await extractText(pdf(['TEXT PAGE', '']), { recognizeImage: async (image) => { assert.ok(image.buffer.length > 0); syntheticImage = image.buffer; ocrCalls++; return { text: 'SCANNED PAGE', metadata: { confidence: 60 } } } })
  assert.equal(ocrCalls, 1); assert.ok(scan.text.includes('TEXT PAGE') && scan.text.includes('SCANNED PAGE')); assert.equal(scan.metadata.warnings.length, 1)
  const confidentScan = await extractText(pdf(['']), { recognizeImage: async () => ({ text: 'HIGH CONFIDENCE OCR', metadata: { confidence: 95 } }) })
  assert.ok(confidentScan.metadata.warnings.some((warning) => warning.includes('逐字准确')), 'High confidence OCR still requires source verification')
  const unreadable = await extractText(pdf(['TEXT PAGE', '']), { recognizeImage: async () => { throw new Error('OCR unavailable') } })
  assert.ok(unreadable.text.includes('TEXT PAGE')); assert.equal(unreadable.metadata.warnings.length, 1)
  assert.equal((await extractText(pdf(['']), { recognizeImage: async () => ({ text: '' }) })).text, '')
  await assert.rejects(extractText({ ...pdf(['']), buffer: Buffer.from('broken pdf') }), /PDF 解析失败/)
  const abort = new AbortController()
  await assert.rejects(extractText(pdf(['']), { signal: abort.signal, recognizeImage: async () => { abort.abort(); abort.signal.throwIfAborted() } }))
  await assert.rejects(extractText(file('text'), { signal: abort.signal }))
  const image = { originalname: 'synthetic.png', mimetype: 'image/png', buffer: syntheticImage }
  let terminated = 0
  const ocrWorker = { setParameters: async () => {}, recognize: async () => ({ data: { text: 'SYNTHETIC IMAGE TEXT', confidence: 90 } }), terminate: async () => { terminated++ } }
  const imageResult = await extractText(image, { createOcrWorker: () => ocrWorker })
  assert.equal(imageResult.text, 'SYNTHETIC IMAGE TEXT'); assert.equal(imageResult.metadata.preprocessed, true); assert.equal(terminated, 1)
  assert.ok(imageResult.metadata.warnings.some((warning) => warning.includes('逐字准确')))
  const cancelInitialization = new AbortController()
  let finishInitialization
  const imagePending = extractText(image, { signal: cancelInitialization.signal, createOcrWorker: () => {
    cancelInitialization.abort()
    return new Promise((resolve) => { finishInitialization = resolve })
  } })
  await assert.rejects(imagePending)
  finishInitialization(ocrWorker)
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(terminated, 2, 'Late OCR worker is released after initialization cancellation')
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>SYNTHETIC WORD</w:t></w:r></w:p></w:body></w:document>')
  assert.ok((await extractText({ originalname: 'synthetic.docx', buffer: await zip.generateAsync({ type: 'nodebuffer' }) })).text.includes('SYNTHETIC WORD'))

  const savedFiles = await store.saveIncomingFiles('synthetic-task-files', [file('old'), file('new')])
  await store.cleanupExpiredFiles([savedFiles[0]])
  assert.equal((await readFile(savedFiles[1].storagePath)).toString(), 'new', 'Bounded cleanup preserves siblings')
  await assert.rejects(store.removeTaskFiles('..'), /越界/)
  await assert.rejects(store.removeTaskFiles('.'), /越界/)

  const first = create('materials', { input: { fileRefs: [{ id: 'material-one', originalName: '申请书.txt' }] } })
  service.saveCheckpoint(first.id, 'source', { documents: [{ fileId: 'material-one', text: requestText }] }); complete(first)
  assert.equal(service.getThreadMaterials('other', 'labor-arbitration', 'materials').length, 0)
  assert.equal(service.setThreadMaterialEnabled('other', 'labor-arbitration', 'materials', 'material-one', false), false)
  assert.equal(service.setThreadMaterialEnabled('owner', 'labor-arbitration', 'materials', 'material-one', false), true)
  assert.equal(service.getThreadMaterials('owner', 'labor-arbitration', 'materials')[0].enabled, false)
  const expiry = service.getTask(first.id, 'owner').resultExpiresAt
  service.getTask(first.id, 'owner'); service.listTasks('owner'); service.getThreadMaterials('owner', 'labor-arbitration', 'materials')
  assert.equal(service.getTask(first.id, 'owner').resultExpiresAt, expiry, 'Reading does not extend retention')
  service.setThreadMaterialEnabled('owner', 'labor-arbitration', 'materials', 'material-one', true)
  database.prepare('UPDATE tasks SET created_at=?, result_expires_at=? WHERE id=?').run(new Date(Date.now() - 86400000).toISOString(), '2020-01-02T00:00:00.000Z', first.id)
  const second = create('materials'); complete(second)
  assert.ok(new Date(service.getTask(first.id, 'owner').resultExpiresAt) > new Date(), 'New submission extends every turn')
  assert.equal(service.getTask(first.id, 'owner').resultExpiresAt, service.getTask(second.id, 'owner').resultExpiresAt)
  const failed = create('materials'); service.failTask(failed.id, new Error('queue'), { code: 'queue_unavailable' })
  assert.equal(service.getTask(first.id, 'owner').resultExpiresAt, service.getTask(second.id, 'owner').resultExpiresAt, 'Queue failure does not extend case')
  assert.equal(TASK_RETENTION_POLICY.sourceRetentionDays, 90); assert.equal(TASK_RETENTION_POLICY.sessionRetentionDays, 365)
  const past = create('expired'); complete(past)
  database.prepare('UPDATE tasks SET created_at=? WHERE id=?').run('2020-01-01T00:00:00.000Z', past.id)
  assert.equal(service.getTask(past.id, 'owner').result, null)
  assert.throws(() => create('expired'), (error) => error.code === 'task_thread_expired')
  assert.ok(service.listExpiredLaborThreads().some((thread) => thread.threadId === 'expired'))
  assert.equal(service.deleteExpiredLaborThreadTasks('owner', 'labor-arbitration', 'expired').deleted, true)
  for (let index = 0; index < 205; index++) complete(create('long-history', { prompt: `turn ${index}` }))
  const recent = service.listThreadTasks('owner', 'labor-arbitration', 'long-history', 200)
  assert.equal(recent[0].prompt, 'turn 5'); assert.equal(recent.at(-1).prompt, 'turn 204')
  assert.equal(service.listThreadTasks('owner', 'labor-arbitration', 'long-history', 200, { offset: 200 }).length, 5)
  assert.equal(service.listTasks('owner', 1.5, { offset: 0.5 }).length, 1)
  assert.equal(service.listTasks('owner', 100, { offset: Infinity }).length, 0)
  assert.equal(service.listAllThreadTasks('owner', 'labor-arbitration', 'long-history')[0].prompt, 'turn 0')
  const merged = restoreArbitrationConversation({ id: 'case', messages: [{ id: 'old', type: 'assistant', taskId: recent[0].id }] }, recent)
  assert.equal(merged.messages.length, 400); assert.equal(merged.messages[1].id, 'old')
  const allHistory = service.listAllThreadTasks('owner', 'labor-arbitration', 'long-history')
  database.prepare('UPDATE tasks SET input_json=? WHERE id=?').run(JSON.stringify({ fileRefs: [{ id: 'original-application' }] }), allHistory[0].id)
  service.saveCheckpoint(allHistory[0].id, 'source', { documents: [{ fileId: 'original-application', text: 'FIRST APPLICATION BEYOND 200 TURNS' }] })
  const followup = create('long-history', { input: { action: 'followup', message: '核对原申请书' } })
  const longWorker = createTaskProcessor({ taskService: service, fileStore: store, laborArbitrationWorkflow: async ({ sourceDocuments, input }) => {
    assert.equal(sourceDocuments[0].text, 'FIRST APPLICATION BEYOND 200 TURNS')
    assert.ok(input.history.some((turn) => turn.content === 'turn 0'))
    return { kind: 'reply', answer: '虚构回复' }
  } })
  assert.equal((await longWorker.processTask(followup.id)).status, 'succeeded')

  // First run cancelled before parsing: follow-up rereads the file and saves it on the source task.
  const rawId = 'cancelled-source'
  const rawFiles = (await store.saveIncomingFiles(rawId, [file(requestText)])).map((item) => ({ ...item, id: 'raw-file' }))
  const raw = create('reread', { id: rawId, input: { fileRefs: [{ id: 'raw-file', originalName: '申请书.txt' }] }, files: rawFiles })
  service.requestCancel(raw.id, 'owner')
  const reread = create('reread', { input: { action: 'followup', message: '继续核对' } })
  const realWorkflowWorker = createTaskProcessor({ taskService: service, fileStore: store })
  assert.equal((await realWorkflowWorker.processTask(reread.id)).status, 'succeeded')
  assert.equal(service.getLaborSourceDocuments(raw.id)[0].text, requestText)
  database.prepare('UPDATE task_files SET cleanup_at=? WHERE task_id=?').run('2020-01-01T00:00:00.000Z', raw.id)
  service.purgeExpiredLaborSourceCheckpoints()
  assert.equal(service.getLaborSourceDocuments(raw.id)[0].text, requestText)
  const bodyOnly = create('reread', { input: { action: 'followup', message: '原件清理后继续' } })
  assert.equal((await realWorkflowWorker.processTask(bodyOnly.id)).status, 'succeeded')
  service.setThreadMaterialEnabled('owner', 'labor-arbitration', 'reread', 'raw-file', false)
  const disabled = create('reread', { input: { action: 'followup', message: '停用后询问准备流程' } })
  const disabledWorker = createTaskProcessor({ taskService: service, fileStore: store, laborArbitrationWorkflow: async ({ sourceDocuments, input }) => {
    assert.equal(sourceDocuments.length, 0); assert.ok(input.materialWarnings.some((warning) => warning.includes('已停止使用')))
    return { answer: '只提供流程建议', kind: 'reply' }
  } })
  assert.equal((await disabledWorker.processTask(disabled.id)).status, 'succeeded')
  const unknown = create('unknown', { productId: 'unregistered-product' })
  assert.equal((await realWorkflowWorker.processTask(unknown.id)).errorCode, 'unsupported_product_id', 'Unknown products must never run contract review')

  let failDelete = true
  const app = express(); app.use(express.json()); app.use((req, res, next) => { req.user = { id: req.get('X-Test-User') || 'owner' }; next() })
  app.use('/api', createTaskRouter({ taskService: service, taskQueue: { enqueue: async () => {} }, fileStore: { ...store, removeTaskFiles: async (id) => { if (failDelete) throw new Error('synthetic filesystem failure'); return store.removeTaskFiles(id) } } }))
  server = await new Promise((resolve) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)) })
  const endpoint = `http://127.0.0.1:${server.address().port}/api/tasks/labor-arbitration/thread/materials`
  const taskEndpoint = `http://127.0.0.1:${server.address().port}/api/tasks/labor-arbitration`
  const oversized = new FormData()
  oversized.set('threadId', 'oversized-synthetic'); oversized.set('message', '虚构上传边界测试')
  oversized.append('files', new Blob([Buffer.alloc(MAX_FILE_SIZE + 1, 65)], { type: 'text/plain' }), 'oversized.txt')
  const oversizedResponse = await nativeFetch(taskEndpoint, { method: 'POST', body: oversized })
  assert.equal(oversizedResponse.status, 413)
  assert.equal((await oversizedResponse.json()).code, 'LIMIT_FILE_SIZE')
  assert.equal(service.listThreadTasks('owner', 'labor-arbitration', 'oversized-synthetic').length, 0, 'Rejected file must not create a task')
  const sevenFiles = new FormData()
  sevenFiles.set('threadId', 'seven-files-synthetic'); sevenFiles.set('message', '虚构上传数量测试')
  for (let i = 0; i < 7; i++) sevenFiles.append('files', new Blob(['虚构材料']), `${i}.txt`)
  const sevenResponse = await nativeFetch(taskEndpoint, { method: 'POST', body: sevenFiles })
  assert.equal(sevenResponse.status, 400)
  assert.ok((await sevenResponse.json()).error.includes('6 个文件'))
  const patch = (enabled, user = 'owner') => nativeFetch(`${endpoint}/materials`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-Test-User': user }, body: JSON.stringify({ fileId: 'material-one', enabled }) })
  assert.equal((await patch(false, 'other')).status, 404); assert.equal((await patch(false)).status, 200)
  assert.equal((await nativeFetch(endpoint, { method: 'DELETE', headers: { 'X-Test-User': 'other' } })).status, 404)
  const failedDelete = await nativeFetch(endpoint, { method: 'DELETE' }); assert.equal(failedDelete.status, 500); assert.equal((await failedDelete.json()).deleted, false)
  assert.ok(service.getTask(first.id, 'owner')); assert.ok(service.getCheckpoint(first.id, 'source'))
  failDelete = false
  assert.equal((await nativeFetch(endpoint, { method: 'DELETE' })).status, 200)
  assert.equal(service.getTask(first.id, 'owner'), null); assert.equal(service.getCheckpoint(first.id, 'source'), null)
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM task_events WHERE task_id=?').get(first.id).n, 0)
  console.log('PASS arbitration hardening: nested results, request/draft coverage, bounded repair, laws, long materials, PDF/text/scan/cancel, DOCX, retention, ownership, pagination, material selection and deletion retry (synthetic only)')
} finally {
  globalThis.fetch = nativeFetch
  if (server) await new Promise((resolve) => server.close(resolve))
  database.close()
  // Keep the small isolated fixtures for inspection; no deletion of workspace data.
}
