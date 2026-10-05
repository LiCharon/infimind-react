import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve, basename, join } from 'node:path'
import { isArbitrationDraftStale } from '../../src/utils/arbitration-history.js'

// Uses only the isolated --live --serve harness; never the deployment API.
const argument = process.argv.indexOf('--ready')
if (argument < 0) throw new Error('用法：node server/scripts/test-arbitration-live-revisions.js --ready <隔离目录>/ready.json')
const ready = JSON.parse(await readFile(resolve(process.argv[argument + 1]), 'utf8'))
const output = resolve(ready.output)
assert.ok(basename(output).startsWith('fafee-arbitration-live-'))
assert.equal(new URL(ready.origin).hostname, '127.0.0.1')
const login = await fetch(`${ready.origin}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Fafee-Auth': '1' },
  body: JSON.stringify({ identifier: ready.accounts[0].username, password: ready.accounts[0].password }) })
assert.equal(login.status, 200)
const token = (await login.json()).accessToken
const headers = { Authorization: `Bearer ${token}` }
const threadId = `qa-revisions-${Date.now()}`
const turns = []
const initialText = '劳动仲裁申请书（全部虚构，仅作工程测试）\n申请人：虚构周某。被申请人：虚构晨星公司。\n履行地区：杭州。\n仲裁请求：\n1、支付加班费1200元。\n2、支付工资差额2000元。\n事实与理由：申请人称公司未支付上述金额，实际工作时间、工资及支付情况均待证据核实。'
async function turn(name, message, { action = 'followup', files = [] } = {}) {
  const body = new FormData()
  for (const [key, value] of Object.entries({ threadId, message, action, mode: 'fast' })) body.set(key, value)
  for (const file of files) body.append('files', new Blob([file.text], { type: 'text/plain' }), file.name)
  await writeFile(join(output, `revisions-${name}-input.json`), JSON.stringify({ threadId, message, action, files }, null, 2))
  const response = await fetch(`${ready.origin}/api/tasks/labor-arbitration`, { method: 'POST', headers, body })
  assert.equal(response.status, 202, `创建${name}失败`)
  const id = (await response.json()).taskId
  const deadline = Date.now() + 480000
  while (Date.now() < deadline) {
    const taskResponse = await fetch(`${ready.origin}/api/tasks/${id}`, { headers })
    assert.equal(taskResponse.status, 200)
    const task = (await taskResponse.json()).task
    if (['succeeded', 'failed', 'cancelled'].includes(task.status)) {
      await writeFile(join(output, `revisions-${name}.json`), JSON.stringify({ result: task.result, status: task.status, error: task.errorSummary, taskId: id }, null, 2))
      assert.equal(task.status, 'succeeded', `${name}：${task.errorSummary}`)
      turns.push({ name, taskId: id, caseVersion: task.result.caseVersion, analysisTaskId: task.result.analysisTaskId,
        materialSignature: task.result.materialSignature, risk: task.result.overallRisk, claims: task.result.claims.length, stages: task.result.stageUsage?.map((call) => call.stage) })
      console.log(`完成材料版本测试：${name}，案件版本${task.result.caseVersion}`)
      return task.result
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`${name}等待超时；隔离任务保留供检查`)
}
try {
  const initial = await turn('initial', '先分析请求与答辩方向，不生成草稿。', { action: 'analyze', files: [{ name: '虚构申请书.txt', text: initialText }] })
  assert.equal(initial.claims.length, 2); assert.equal(initial.defenseDraft, '')
  const draft = await turn('draft', '先按已有信息出草稿，未知事项保留待补充。', { action: 'draft' })
  assert.ok(draft.defenseDraft, draft.draftError?.message)
  assert.equal(draft.draftBasis.analysisTaskId, draft.analysisTaskId)
  const receipt = await turn('receipt', '补充一份虚构付款流水，请更新支付情况的分析，不生成草稿。', { files: [{ name: '虚构付款流水.txt',
    text: '银行流水样例（全部虚构）。2025年4月1日，虚构晨星公司向虚构周某转账800元，用途备注：工资差额。此样例只记录付款，费用归属及是否抵扣申请人请求需核实。' }] })
  assert.equal(receipt.defenseDraft, '')
  assert.deepEqual(receipt.caseRecord.requests.map((request) => request.id), initial.caseRecord.requests.map((request) => request.id))
  assert.notEqual(receipt.materialSignature, initial.materialSignature)
  assert.ok(isArbitrationDraftStale(draft, receipt.caseRecord))
  const threadUrl = `${ready.origin}/api/tasks/labor-arbitration/thread/${threadId}`
  const history = await (await fetch(threadUrl, { headers })).json()
  const oldApplication = history.materials.find((file) => file.name === '虚构申请书.txt')
  assert.ok(oldApplication)
  const stopped = await fetch(`${threadUrl}/materials`, { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ fileId: oldApplication.id, enabled: false }) })
  assert.equal(stopped.status, 200)
  const corrected = await turn('corrected', '旧申请书已停用，这份是同案变更申请书。加班费变为1000元，其它请求不变；请分析，不生成草稿。', { files: [{ name: '虚构变更申请书.txt', text: initialText.replace('加班费1200元', '加班费1000元') }] })
  assert.ok(corrected.caseRecord.requests.some((request) => /加班费1000元/.test(request.text)))
  assert.ok(!corrected.caseRecord.requests.some((request) => /加班费1200元/.test(request.text)))
  assert.ok(!corrected.caseRecord.sources.some((source) => source.fileId === oldApplication.id))
  assert.equal(corrected.caseRecord.requests.find((request) => /工资差额/.test(request.text)).id, initial.caseRecord.requests.find((request) => /工资差额/.test(request.text)).id)
  const conflict = await turn('conflict', '企业另一部门提供相反陈述，请保留冲突、说明需核实什么，不能直接认定已付款或未付款。', { files: [{ name: '虚构相反陈述.txt',
    text: '虚构晨星公司另一部门陈述：虚构周某的工资差额尚未支付；前述800元流水可能是费用报销，不是工资。该说法与流水备注冲突，付款用途和是否抵扣待核实。' }] })
  assert.ok(conflict.caseRecord.conflicts.length)
  assert.equal(conflict.defenseDraft, '')
  const reply = await turn('reply', '接下来如何整理这些证据？只回答这个问题，不重新分析或生成草稿。')
  assert.equal(reply.kind, 'reply')
  assert.equal(reply.analysisTaskId, conflict.analysisTaskId)
  assert.ok(!reply.stageUsage.some((call) => call.stage === 'arbitration_analysis'))
  await writeFile(join(output, 'revisions-summary.json'), JSON.stringify({ ok: true, threadId, turns, note: '不同输入的变化测试；不以风险一致或改变作为法律金标。' }, null, 2))
  console.log('PASS real revisions: receipt, corrected request, material disable, contradictory statements, draft version and reply reuse')
} catch (error) {
  await writeFile(join(output, 'revisions-summary.json'), JSON.stringify({ ok: false, threadId, turns, error: error.message }, null, 2))
  throw error
}
