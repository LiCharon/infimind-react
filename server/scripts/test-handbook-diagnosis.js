import assert from 'node:assert/strict'
import express from 'express'
import JSZip from 'jszip'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildHandbookStructure, locateHandbookQuote } from '../services/handbook-structure.js'
import { runHandbookDiagnosis, normalizeHandbookFindings, mergeHandbookFindings, fakeHandbookResponse } from '../workflows/handbook-diagnosis.js'
import { loadHandbookReferences } from '../services/handbook-references.js'
import { createBusinessDatabase } from '../services/business-db.js'
import { createTaskService } from '../services/task-service.js'
import { createTaskFileStore } from '../services/task-file-store.js'
import { createTaskProcessor } from '../services/task-processor.js'
import { createTaskQueue } from '../services/task-queue.js'
import { createTaskRouter } from '../routes/tasks.js'
import { initialize, close as closeLaws } from '../services/law-whitelist.js'
import { readHandbookEvents } from '../../src/utils/handbook-result.js'

initialize(':memory:')
const directory = mkdtempSync(join(tmpdir(), 'fafee-handbook-test-'))
const text = '测试员工手册\n第一章 考勤制度\n第一条 员工迟到时，公司应先提醒并允许补正记录。\n第二条 员工忘打卡时，公司须核实实际出勤。\n第二章 奖惩制度\n第三条 员工迟到一次，公司可以解除劳动合同。\n'
const noReferences = async () => ({ documents: [], versions: [], warnings: [] })
const makeRunner = () => {
  const checkpoints = new Map()
  const events = []
  return { checkpoints, events, options: { checkpoint: async (key, value) => checkpoints.set(key, { result: structuredClone(value) }),
    getCheckpoint: (key) => checkpoints.get(key), emit: async (event, payload) => events.push({ event, payload: structuredClone(payload) }),
    referenceLoader: noReferences, lawLoader: async () => [], fakeLlm: true } }
}
let passed = 0
const test = async (name, run) => { await run(); passed += 1; console.log(`PASS ${name}`) }

await test('分块保留全部原文，长段落不截断且位置能复原', () => {
  const source = { fileId: 'a', fileName: '合成手册', text: text + '第三章 长条款\n' + '员工应遵守安全规定。'.repeat(1000) }
  const structure = buildHandbookStructure([source], { budget: 80 })
  assert.equal(structure.chunks.map((chunk) => chunk.text).join(''), source.text)
  assert.ok(structure.chunks.length > 10)
  for (const chunk of structure.chunks) assert.equal(source.text.slice(chunk.startOffset, chunk.endOffset), chunk.text)
})
await test('重复原文不猜位置，引用不存在不放行', () => {
  const chunk = buildHandbookStructure([{ fileId: 'a', fileName: '测试', text: '员工应遵守规定。\n员工应遵守规定。' }]).chunks[0]
  assert.equal(locateHandbookQuote('员工应遵守规定。', chunk).status, 'ambiguous')
  assert.equal(locateHandbookQuote('累计旷工三日解除', chunk).status, 'not-found')
})
await test('同一原文的不同问题不丢失，虚构引用不生成修订文本', () => {
  const chunk = buildHandbookStructure([{ fileId: 'a', fileName: '测试', text: '员工迟到一次，公司可以解除劳动合同。' }]).chunks[0]
  const findings = normalizeHandbookFindings(['条件不清', '流程不清'].map((title) => ({ title, topic: '考勤', explanation: title,
    evidence: [{ chunkId: chunk.id, quote: chunk.text }], suggestedClause: '示例' })), [chunk])
  assert.notEqual(findings[0].id, findings[1].id)
  const ungrounded = normalizeHandbookFindings([{ title: '模型虚构', explanation: '未引用上传正文', evidence: [{ chunkId: chunk.id, quote: '旧参考手册中的条款' }], suggestedClause: '不能发布' }], [chunk])[0]
  assert.equal(ungrounded.status, 'pending'); assert.equal(ungrounded.suggestedClause, '')
})
await test('首页说明即使出现员工手册字样也不生成报告', async () => {
  const runner = makeRunner()
  const report = await runHandbookDiagnosis({ ...runner.options, input: { text: '员工手册诊断\n员工手册分析助手\n您好，请直接上传需要分析的员工手册图片。\n发送消息\n由扣子提供' } })
  assert.equal(report.analysisStatus, 'blocked'); assert.equal(report.findings.length, 0)
  assert.equal(runner.events.some((event) => event.event === 'stage.start' && event.payload.stage === 'review'), false)
})
await test('模型不列法规也不能把条款合法性发布为已核实判断', () => {
  const chunk = buildHandbookStructure([{ fileId: 'a', fileName: '合成制度', text: '员工任何一次迟到均直接解除劳动合同。' }]).chunks[0]
  const finding = normalizeHandbookFindings([{ kind: 'clause', title: '解除条件', explanation: '需核实处理条件与法律适用',
    level: 'high', status: 'risk', evidence: [{ chunkId: chunk.id, quote: chunk.text }], authorities: [] }], [chunk])[0]
  assert.equal(finding.status, 'pending')
  assert.equal(finding.level, 'high')
  assert.match(finding.verificationNote, /具体法律依据尚未核实/)
})
await test('冲突归并需模型明确选择且两处来源一致，不吞掉独立条款或不同来源', () => {
  const chunks = buildHandbookStructure([{ fileId: 'a', fileName: '合成制度', text }]).chunks
  const raw = (title, kind = 'conflict', evidenceChunks = chunks.slice(1)) => ({ title, kind, explanation: title, status: 'pending',
    conditions: [title], evidence: evidenceChunks.map((chunk) => ({ chunkId: chunk.id, quote: chunk.text.trim() })) })
  const previous = normalizeHandbookFindings([raw('重复冲突一'), raw('重复冲突二'), raw('独立条款问题', 'clause')], chunks)
  const incoming = normalizeHandbookFindings([{ ...raw('合并后的冲突'), supersedesFindingIds: previous.map((item) => item.id) }], chunks)
  const merged = mergeHandbookFindings(previous, incoming, previous.map((item) => item.id))
  assert.equal(merged.length, 2); assert.ok(merged.some((item) => item.kind === 'clause'))
  assert.deepEqual(merged.find((item) => item.kind === 'conflict').conditions, ['重复冲突二', '重复冲突一', '合并后的冲突'])
  assert.equal(mergeHandbookFindings(previous, incoming, []).length, 4)
  const differentSource = normalizeHandbookFindings([{ ...raw('另一对来源', 'conflict', chunks.slice(0, 2)), supersedesFindingIds: [previous[0].id] }], chunks)
  assert.equal(mergeHandbookFindings(previous, differentSource, [previous[0].id]).length, 4)
})
await test('短条款可以诊断，章节冲突关联两处原文并完成全部关系检查', async () => {
  const runner = makeRunner()
  const report = await runHandbookDiagnosis({ ...runner.options, task: { id: 'task-a' }, input: { text } })
  assert.equal(report.analysisStatus, 'completed')
  assert.ok(report.coverage.every((item) => item.status === 'completed'))
  assert.equal(report.relationCoverage.completed, report.relationCoverage.total)
  const conflict = report.findings.find((finding) => finding.kind === 'conflict')
  assert.ok(conflict); assert.equal(conflict.evidence.length, 2)
  for (const citation of conflict.evidence) assert.equal(citation.location.status, 'found')
  const short = await runHandbookDiagnosis({ ...makeRunner().options, input: { text: '员工须按实际出勤记录申请考勤补正。' } })
  assert.equal(short.analysisStatus, 'completed'); assert.equal(short.scope.kind, 'fragment')
  assert.equal('score' in short, false)
})
await test('解析失败先暂停，明确选择已读部分后才继续', async () => {
  const runner = makeRunner()
  const files = [{ id: 'bad', originalname: '损坏.docx' }]
  const parseFile = async () => { throw new Error('文件损坏') }
  const blocked = await runHandbookDiagnosis({ ...runner.options, files, parseFile, input: { text } })
  assert.equal(blocked.analysisStatus, 'blocked'); assert.equal(blocked.unreadableMaterials.length, 1)
  const readable = await runHandbookDiagnosis({ ...runner.options, files, parseFile, input: { text, allowPartial: true } })
  assert.equal(readable.analysisStatus, 'completed'); assert.equal(readable.unreadableMaterials.length, 1)
})
await test('输出截断不能宣布完成，失败重试复用已完成检查点', async () => {
  const runner = makeRunner()
  let calls = 0
  let fail = true
  const generateCompletion = async (prompt, message) => {
    calls += 1
    const payload = JSON.parse(message)
    const kind = prompt.includes('本阶段只判断') ? 'scope' : prompt.includes('核对提供的两处') ? 'relations' : 'review'
    if (kind === 'relations' && fail) return { content: '{}', finishReason: 'length' }
    return { content: JSON.stringify(fakeHandbookResponse(kind, payload)), finishReason: 'stop' }
  }
  await assert.rejects(runHandbookDiagnosis({ ...runner.options, fakeLlm: false, generateCompletion, input: { text } }), (cause) => cause.code === 'handbook_output_truncated')
  const partial = runner.checkpoints.get('handbook-report').result.result
  assert.equal(partial.analysisStatus, 'streaming'); assert.ok(partial.findings.length)
  const before = calls; fail = false
  const done = await runHandbookDiagnosis({ ...runner.options, fakeLlm: false, generateCompletion, input: { text } })
  assert.equal(done.analysisStatus, 'completed'); assert.equal(calls - before, 1)
})
await test('取消停止后续模型调用，模型未完成 JSON 不成为检查点', async () => {
  const runner = makeRunner(); let calls = 0
  await assert.rejects(runHandbookDiagnosis({ ...runner.options, isCancellationRequested: () => true, input: { text },
    generateCompletion: async () => { calls += 1 } }), (cause) => cause.code === 'TASK_CANCELLED')
  assert.equal(calls, 0)
  await assert.rejects(runHandbookDiagnosis({ ...runner.options, fakeLlm: false, input: { text },
    generateCompletion: async () => ({ content: '{"complete":true', finishReason: 'stop' }) }), /完整的诊断 JSON/)
  assert.equal([...runner.checkpoints.keys()].some((key) => key.startsWith('handbook-scope:')), false)
})
await test('模型标题只辅助分块，原文不符的标题与背景不能生效', async () => {
  const runner = makeRunner()
  const source = '员工制度\n出勤管理\n员工应按时出勤。\n薪酬管理\n公司应按约定支付工资。'
  const generateCompletion = async (prompt, message) => {
    const payload = JSON.parse(message)
    const kind = prompt.includes('本阶段只判断') ? 'scope' : prompt.includes('核对提供的两处') ? 'relations' : 'review'
    const response = fakeHandbookResponse(kind, payload)
    if (kind === 'scope') {
      response.background = { region: '不存在的地区' }
      response.suggestedHeadings = ['出勤管理', '薪酬管理', '模型虚构章节'].map((title) => ({ title, quote: title }))
    }
    return { content: JSON.stringify(response), finishReason: 'stop' }
  }
  const report = await runHandbookDiagnosis({ ...runner.options, fakeLlm: false, input: { text: source }, generateCompletion })
  assert.equal(report.analysisStatus, 'completed')
  assert.ok(report.coverage.some((item) => item.sectionTitle === '出勤管理'))
  assert.ok(report.coverage.some((item) => item.sectionTitle === '薪酬管理'))
  assert.equal(report.coverage.some((item) => item.sectionTitle === '模型虚构章节'), false)
  assert.equal(report.scope.background.region, '')
})
await test('不完整问题不保存成功检查点，修复后能重新调用完成', async () => {
  const runner = makeRunner(); let invalid = true
  const generateCompletion = async (prompt, message) => {
    const payload = JSON.parse(message)
    const kind = prompt.includes('本阶段只判断') ? 'scope' : prompt.includes('核对提供的两处') ? 'relations' : 'review'
    const response = fakeHandbookResponse(kind, payload)
    if (kind === 'review' && invalid) response.findings = [{ title: '缺少说明' }]
    return { content: JSON.stringify(response), finishReason: 'stop' }
  }
  await assert.rejects(runHandbookDiagnosis({ ...runner.options, fakeLlm: false, input: { text }, generateCompletion }), /缺少标题或说明/)
  assert.equal([...runner.checkpoints.keys()].some((key) => key.startsWith('handbook-review:')), false)
  invalid = false
  assert.equal((await runHandbookDiagnosis({ ...runner.options, fakeLlm: false, input: { text }, generateCompletion })).analysisStatus, 'completed')
})
await test('参考资料按外部版本读取，不作为上传原文或法律标准', async () => {
  const manifest = join(directory, 'references.json')
  writeFileSync(join(directory, 'sample.txt'), '员工须遵守本参考制度。')
  writeFileSync(manifest, JSON.stringify({ documents: [{ id: 'old', title: '旧版临时参考', version: 'old-v1', role: 'reference', filePath: 'sample.txt' }] }))
  const references = await loadHandbookReferences({ manifestPath: manifest })
  assert.equal(references.versions[0].role, 'reference'); assert.equal('filePath' in references.versions[0], false)
  const runner = makeRunner()
  const report = await runHandbookDiagnosis({ ...runner.options, input: { text }, referenceLoader: async () => references })
  assert.equal(report.referenceVersions[0].version, 'old-v1')
  assert.equal(report.sourceDocuments.some((doc) => doc.fileId.startsWith('reference:')), false)
})
await test('进度流跨网络包的 CRLF 和中文字符能完整读取', async () => {
  const bytes = new TextEncoder().encode('id: 1\r\nevent: handbook.snapshot\r\ndata: {"label":"检查中"}\r\n\r\n')
  const events = []
  const stream = new ReadableStream({ start(controller) {
    for (const byte of bytes) controller.enqueue(Uint8Array.of(byte))
    controller.close()
  } })
  await readHandbookEvents(new Response(stream), (event, payload, sequence) => events.push({ event, payload, sequence }))
  assert.deepEqual(events, [{ event: 'handbook.snapshot', payload: { label: '检查中' }, sequence: 1 }])
})

const database = createBusinessDatabase(':memory:')
for (const id of ['user-a', 'user-b']) {
  database.prepare('INSERT INTO invite_codes (id, code_hash, created_at) VALUES (?, ?, ?)').run(`invite-${id}`, `hash-${id}`, new Date().toISOString())
  database.prepare('INSERT INTO users (id, username, email, password_hash, password_salt, invite_code_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, id, `${id}@example.test`, 'hash', 'salt', `invite-${id}`, new Date().toISOString())
}
const service = createTaskService(database)
const store = createTaskFileStore({ root: join(directory, 'uploads') })
const processor = createTaskProcessor({ taskService: service, fileStore: store, fakeLlm: true,
  handbookWorkflow: (options) => runHandbookDiagnosis({ ...options, referenceLoader: noReferences, lawLoader: async () => [] }) })
const queue = createTaskQueue({ taskService: service, processTask: processor.processTask, mode: 'local', workerEnabled: true, pollIntervalMs: 15 })
const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.user = { id: req.get('X-Test-User') || 'user-a' }; next() })
app.use('/api', createTaskRouter({ taskService: service, taskQueue: queue, fileStore: store, fakeLlm: true }))
const server = await new Promise((resolve) => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)) })
const url = `http://127.0.0.1:${server.address().port}`
const request = (path, options = {}) => fetch(url + path, options)
const wait = async (taskId) => {
  for (let round = 0; round < 200; round += 1) {
    const task = service.getTask(taskId, 'user-a')
    if (service.isTerminal(task.status)) return task
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('诊断任务等待超时')
}
try {
  await queue.start()
  await test('真实任务接口支持 DOCX 和粘贴文本，SSE 可回放并恢复报告', async () => {
    const zip = new JSZip()
    zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
    zip.file('word/document.xml', `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${text.trim().split('\n').map((line) => `<w:p><w:r><w:t>${line}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`)
    const body = new FormData(); body.append('files', new Blob([await zip.generateAsync({ type: 'nodebuffer' })]), '合成员工手册.docx'); body.append('mode', 'fast')
    const response = await request('/api/tasks/handbook-diagnosis', { method: 'POST', body })
    assert.equal(response.status, 202)
    const created = await response.json(); assert.equal(created.productId, 'handbook-diagnosis'); assert.equal('storagePath' in created.task.files[0], false)
    const done = await wait(created.taskId); assert.equal(done.status, 'succeeded'); assert.equal(done.result.analysisStatus, 'completed')
    const replay = await request(`/api/tasks/${created.taskId}/events?after=0`); assert.match(await replay.text(), /event: handbook\.snapshot/)
    const report = await request(`/api/tasks/handbook-diagnosis/${created.taskId}/report`); assert.equal((await report.json()).report.sourceDocuments.length, 1)
    const history = await request(`/api/tasks/handbook-diagnosis/thread/${created.threadId}`); assert.equal((await history.json()).tasks.length, 1)
    const other = await request(`/api/tasks/handbook-diagnosis/${created.taskId}/report`, { headers: { 'X-Test-User': 'user-b' } }); assert.equal(other.status, 404)
    const followup = await request('/api/tasks/handbook-diagnosis', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'followup', threadId: created.threadId, sourceTaskId: created.taskId, message: '解释迟到问题' }) })
    assert.equal(followup.status, 202); assert.equal((await wait((await followup.json()).taskId)).result.kind, 'followup')
    const foreign = await request('/api/tasks/handbook-diagnosis', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Test-User': 'user-b' }, body: JSON.stringify({ action: 'restart', sourceTaskId: created.taskId }) }); assert.equal(foreign.status, 404)
    const deleted = await request(`/api/tasks/handbook-diagnosis/thread/${created.threadId}`, { method: 'DELETE' }); assert.equal(deleted.status, 200)
    assert.equal((await request(`/api/tasks/handbook-diagnosis/${created.taskId}/report`)).status, 404)
  })
  await test('重复同会话任务有数据库门禁，不同会话和产品保持隔离', async () => {
    service.createTask({ id: 'first', userId: 'user-a', productId: 'handbook-diagnosis', threadId: 'busy', input: { text } })
    assert.throws(() => service.createTask({ userId: 'user-a', productId: 'handbook-diagnosis', threadId: 'busy' }), /UNIQUE/)
    const conflict = await request('/api/tasks/handbook-diagnosis', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, threadId: 'busy' }) }); assert.equal(conflict.status, 409)
    const crossProduct = service.createTask({ id: 'other-product', userId: 'user-a', productId: 'contract-review', threadId: 'other' })
    const misuse = await request('/api/tasks/handbook-diagnosis', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'restart', sourceTaskId: crossProduct.id }) }); assert.equal(misuse.status, 404)
  })
  await test('连续停止尚未解析的文件后能恢复原件，过期会话不能恢复', async () => {
    const rootId = 'cancelled-upload-root'
    const saved = await store.saveIncomingFiles(rootId, [{ originalname: '合成制度.txt', mimetype: 'text/plain', buffer: Buffer.from(text) }])
    service.createTask({ id: rootId, userId: 'user-a', productId: 'handbook-diagnosis', threadId: rootId,
      input: { action: 'analyze' }, files: saved.map((file, index) => ({ ...file, id: `cancelled-file-${index}` })) })
    service.markCancelled(rootId)
    const firstResume = service.createTask({ id: 'cancelled-resume', userId: 'user-a', productId: 'handbook-diagnosis', threadId: rootId,
      input: { action: 'restart', sourceTaskId: rootId, materialTaskId: rootId } })
    service.markCancelled(firstResume.id)
    const resumed = await request('/api/tasks/handbook-diagnosis', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'restart', sourceTaskId: firstResume.id }) })
    assert.equal(resumed.status, 202)
    const final = await wait((await resumed.json()).taskId)
    assert.equal(final.status, 'succeeded'); assert.equal(final.result.sourceDocuments[0].text, text)
    service.createTask({ id: 'expired-handbook', userId: 'user-a', productId: 'handbook-diagnosis', threadId: 'expired-handbook', input: { text } })
    service.markCancelled('expired-handbook')
    database.prepare('UPDATE tasks SET created_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', 'expired-handbook')
    assert.equal((await request('/api/tasks/handbook-diagnosis/expired-handbook/report')).status, 410)
    assert.equal((await request('/api/tasks/handbook-diagnosis', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'restart', sourceTaskId: 'expired-handbook' }) })).status, 410)
  })
  await test('已确认只检查可读部分的报告仍可追问', async () => {
    const partial = await runHandbookDiagnosis({ ...makeRunner().options, input: { text, allowPartial: true }, files: [{ id: 'bad-partial', originalname: '损坏附件.docx' }],
      parseFile: async () => { throw new Error('合成损坏文件') } })
    const source = service.createTask({ id: 'partial-report', userId: 'user-a', productId: 'handbook-diagnosis', threadId: 'partial-report', input: { text, action: 'analyze', allowPartial: true } })
    service.claimTask(source.id)
    service.saveCheckpoint(source.id, 'handbook-parsing', { documents: partial.sourceDocuments, failures: partial.unreadableMaterials, warnings: [] })
    service.completeTask(source.id, partial)
    const followup = await request('/api/tasks/handbook-diagnosis', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'followup', sourceTaskId: source.id, message: '说明当前检查范围' }) })
    assert.equal(followup.status, 202)
    const created = await followup.json()
    assert.equal((await wait(created.taskId)).result.kind, 'followup')
    assert.equal((await (await request(`/api/tasks/handbook-diagnosis/${created.taskId}/report`)).json()).sourceTaskId, source.id)
  })
  console.log(`员工手册专项：${passed} 项通过。测试资料目录：${directory}`)
} finally {
  await queue.close(); await new Promise((resolve) => server.close(resolve)); database.close(); closeLaws()
}
