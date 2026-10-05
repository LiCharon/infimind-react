// Browser regression against a running Vite server. All APIs are intercepted;
// synthetic documents never reach the real API or an external model.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { chromium } from 'playwright'

const directory = join(tmpdir(), 'fafee-lca-ui-review')
mkdirSync(directory, { recursive: true })
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const browser = await chromium.launch({ headless: true, ...(existsSync(edge) ? { executablePath: edge } : {}) })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const original = '劳动合同\n甲方：虚构测试公司\n月工资为8000元。\n' + Array.from({ length: 80 }, (_, index) => `第${index + 1}项约定：这是用于验证完整合同阅读位置的虚构内容。`).join('\n')
const result = {
  productId: 'labor-contract-analysis', schemaVersion: 3, analysisStatus: 'completed',
  analysisType: 'ordinary_labor_contract', sourceTaskId: 'task-0', score: { value: 80 },
  reviewReport: '# 劳动合同分析结果\n\n**参考分数**：80/100\n\n## 重点风险\n工资支付日期待确认。',
  reviewRounds: [{ round: 1, newCount: 1, newFindings: [{ level: '中', title: '工资日期待确认', risk: '付款日不明' }] }, { round: 2, newCount: 0, newFindings: [] }],
  reviewStoppedEarly: true, warnings: [],
  sourceDocuments: [{ fileId: 'file-0', fileName: '虚构合同.txt', text: original }],
  revisions: [{ findingId: 'finding-1', level: '中', action: 'modify', title: '工资日期待确认', lineStart: 3, lineEnd: 3,
    originalText: '月工资为8000元。', rewrittenText: '月工资为8000元，每月【 】日支付。', riskNote: '确认支付日期',
    localizedEdits: [{ editId: 'edit-1', operation: 'insert-after', lineStart: 3, lineEnd: 3, targetQuote: '月工资为8000元。', replacementText: '每月【 】日支付。', quoteSpans: [{ line: 3, start: 0, end: 10 }] }] }]
}
let running = false
let legacy = false
let failed = false
let sourceRequests = 0
let snapshotStep = 0
let replay = false
let classificationType = 'unsupported'
let classificationParseStatus = 'succeeded'
let classificationUnavailable = false
const classificationRequests = []
const analysisRequests = []
const tasks = Array.from({ length: 70 }, (_, index) => ({
  id: `task-${index}`, threadId: `task-${index}`, productId: 'labor-contract-analysis', title: `劳动合同测试 ${index}`,
  status: 'succeeded', createdAt: new Date(Date.now() - index * 3600000).toISOString(),
  analysisType: 'ordinary_labor_contract', action: 'analyze', mode: 'fast', result,
  files: [{ id: 'file-0', originalName: '虚构合同.txt', cleanupAt: '2020-01-01T00:00:00Z' }]
}))
tasks[1].result = { ...result, sourceTaskId: 'task-1', reviewReport: result.reviewReport + '\n\n' + Array.from({ length: 60 }, (_, index) => `第${index + 1}项测试分析内容。`).join('\n\n') }
const current = (id = 'task-0') => id !== 'task-0' ? tasks.find((task) => task.id === id) : failed ? { ...tasks[0], status: 'failed', currentStage: 'review', result: null, errorSummary: 'synthetic ECONNRESET' }
  : running ? { ...tasks[0], status: 'running', currentStage: 'review', result: null, ...(replay ? { lastEventSeq: 7, stageSummary: '第 3 轮已保存 5 条新问题，继续核对全文。' } : {}) }
  : legacy ? { ...tasks[0], result: { ...result, sourceDocuments: undefined } } : tasks[0]
try {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    let body
    if (url.pathname === '/api/auth/refresh') body = { accessToken: 'browser-test-only', expiresAt: '2099-01-01' }
    else if (url.pathname === '/api/auth/me') body = { user: { id: 'browser-test', username: '测试用户', email: 'test@example.test' } }
    else if (url.pathname === '/api/tasks') body = { tasks }
    else if (url.pathname === '/api/tasks/labor-contract-analysis/classify') {
      classificationRequests.push(route.request().postData() || '')
      if (classificationUnavailable) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '合成识别服务暂不可用' }) })
      body = { classifications: [{ index: 0, parseStatus: classificationParseStatus, suggestedType: classificationType, confidence: 'low' }] }
    } else if (url.pathname === '/api/tasks/labor-contract-analysis' && route.request().method() === 'POST') {
      analysisRequests.push(route.request().postData() || '')
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '合成队列不可用，保留输入供重试' }) })
    }
    else if (url.pathname.includes('/source/')) { sourceRequests += 1; body = { documents: result.sourceDocuments, expiresAt: null } }
    else if (url.pathname.includes('/thread/')) body = { tasks: [current(url.pathname.split('/').at(-1))] }
    else if (url.pathname.endsWith('/events')) {
      if (running && snapshotStep) {
        const revisions = snapshotStep === 1 ? result.revisions : [...result.revisions, { ...result.revisions[0], findingId: 'finding-2', title: '工资构成待确认', rewrittenText: '工资构成另行明确。' }]
        const events = [['review.round', { round: 1, phase: 'end', newCount: 1, newFindings: [] }],
          ['stage.start', { stage: 'rewrite', label: '正在修订' }],
          ['rewrite.result', { revisions, partial: true, stats: { groups: 2, blocks: revisions.length } }]]
        const after = Number(url.searchParams.get('after')) || 0
        return route.fulfill({ status: 200, contentType: 'text/event-stream', body: events.map(([event, data], index) => ({ event, data, seq: snapshotStep * 10 + index }))
          .filter(({ seq }) => seq > after).map(({ event, data, seq }) => `event: ${event}\ndata: ${JSON.stringify({ ...data, _seq: seq })}\n\n`).join('') })
      }
      if (failed) {
        const events = [
          ['analysis.delta', { content: '## 审查摘要\n已保留的摘要', replace: true }],
          ['review.delta', { content: '## 重点风险\n已保留的风险正文', replace: true }],
          ['review.round', { round: 1, phase: 'end', newCount: 1, newFindings: [{ title: '保留第一轮', level: '中' }] }],
          ['review.round', { round: 2, phase: 'end', newCount: 1, newFindings: [{ title: '保留第二轮', level: '中' }] }],
          ['review.round', { round: 3, phase: 'start' }],
          ['task.retry_waiting', {}], ['analysis.reset', { reason: 'generation-start' }], ['done', {}]
        ]
        return route.fulfill({ status: 200, contentType: 'text/event-stream', body: events.map(([event, data], index) => `event: ${event}\ndata: ${JSON.stringify({ ...data, _seq: index + 1 })}\n\n`).join('') })
      }
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'event: review.round\ndata: {"round":1,"phase":"start","_seq":1}\n\n' })
    } else if (url.pathname.startsWith('/api/tasks/task-')) body = { task: current(url.pathname.split('/').at(-1)) }
    else body = {}
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
  await page.goto('http://localhost:5173/tools/labor-contract', { waitUntil: 'networkidle' })
  await page.locator('.lca-history-item').last().waitFor()
  const metrics = await page.evaluate(() => {
    const history = document.querySelector('.lca-history-list')
    const header = document.querySelector('.chat-header').getBoundingClientRect()
    const composer = document.querySelector('.composer-wrap').getBoundingClientRect()
    return { height: innerHeight, body: document.documentElement.scrollHeight, historyHeight: history.clientHeight, historyScroll: history.scrollHeight, headerTop: header.top, composerBottom: composer.bottom }
  })
  assert.ok(metrics.body <= metrics.height + 2, JSON.stringify(metrics))
  assert.ok(metrics.historyScroll > metrics.historyHeight)
  assert.ok(metrics.headerTop >= 0 && metrics.composerBottom <= metrics.height + 2)
  await page.locator('.lca-history-list').evaluate((node) => { node.scrollTop = node.scrollHeight })
  assert.equal(await page.locator('.lca-retention-note').count(), 0)
  const toggle = page.getByRole('button', { name: '深度思考', exact: true })
  await toggle.click()
  assert.equal(await toggle.getAttribute('aria-pressed'), 'false')
  await toggle.click()
  assert.equal(await toggle.getAttribute('aria-pressed'), 'true')
  assert.equal(await page.getByRole('button', { name: '快速', exact: true }).count(), 0)
  await page.getByRole('button', { name: /上下文占比/ }).click()
  await page.getByText('上下文已用', { exact: false }).waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '折叠任务记录', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.chat-sidebar').getBoundingClientRect().width < 2)
  await page.getByRole('button', { name: '展开任务记录', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.chat-sidebar').getBoundingClientRect().width > 200)
  await page.screenshot({ path: join(directory, 'history-composer.png') })

  await page.goto('http://localhost:5173/tools/labor-contract?taskId=task-0', { waitUntil: 'networkidle' })
  await page.locator('.lca-open-report-card').click()
  await page.locator('.quote-mark').waitFor()
  assert.equal(await page.getByText('合同原文已到期。', { exact: false }).count(), 0)
  assert.equal(await page.locator('.lca-open-report-card').textContent().then((value) => value.includes('$')), false)
  await page.getByRole('button', { name: '关闭审查批注稿' }).click()
  assert.ok(await page.getByText('无需继续', { exact: true }).count())
  await page.locator('.lca-open-report-card').click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载', exact: true }).click()
  const download = await downloadPromise
  assert.ok(download.suggestedFilename().endsWith('审查批注稿.doc'))
  await download.saveAs(join(directory, 'synthetic-annotations.doc'))
  await page.screenshot({ path: join(directory, 'annotations.png') })

  const savedEdits = result.revisions[0].localizedEdits
  result.revisions[0].localizedEdits = [{ ...savedEdits[0], operation: 'replace', replacementText: '', localizationStatus: 'finding-fallback' }]
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('.lca-open-report-card').click()
  assert.equal(await page.locator('.local-edit-suggestion span').textContent(), '提示', '兼容旧报告的空局部替换')
  await page.getByText('查看批注与完整修订条款', { exact: true }).click()
  await page.locator('.full-revision').getByText(result.revisions[0].rewrittenText, { exact: false }).waitFor()
  const fallbackDownloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载', exact: true }).click()
  const fallbackDownload = await fallbackDownloadPromise
  const fallbackPath = join(directory, 'fallback-annotations.doc')
  await fallbackDownload.saveAs(fallbackPath)
  assert.ok(readFileSync(fallbackPath, 'utf8').includes(result.revisions[0].rewrittenText), '下载保留回退批注的完整条款建议')
  result.revisions[0].localizedEdits = savedEdits

  legacy = true
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('.lca-open-report-card').click()
  await page.locator('.quote-mark').waitFor()
  assert.ok(sourceRequests > 0, '没有正文快照字段的旧报告从服务端加载保留的原文')
  assert.equal(await page.getByText('合同原文已到期。', { exact: false }).count(), 0)

  running = true
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('.review-rounds-panel').waitFor()
  assert.ok(await page.locator('.round-thinking').count(), '审查开始前就显示真实轮次状态')
  assert.equal(await page.locator('.lca-streamed-review').count(), 0, '测试尚未发正文，仍应显示审查进度')
  await page.screenshot({ path: join(directory, 'review-start.png') })
  snapshotStep = 1
  await page.locator('.lca-open-report-card').waitFor()
  await page.locator('.lca-open-report-card').click()
  await page.locator('.lca-report-pane .quote-mark').waitFor()
  await page.waitForFunction(() => { const node = document.querySelector('.lca-report-scroll'); return node && node.scrollHeight > node.clientHeight + 650 })
  await page.locator('.lca-report-scroll').evaluate((node) => {
    node.style.scrollBehavior = 'auto'; node.scrollTop = 600; window.__originalPane = node
    window.__readingLine = [...node.querySelectorAll('.clause-text')].find((line) => line.getBoundingClientRect().top >= node.getBoundingClientRect().top)
    window.__readingPosition = window.__readingLine.getBoundingClientRect().top
  })
  snapshotStep = 2
  await page.waitForFunction(() => document.querySelector('.lca-report-pane')?.textContent.includes('2 处批注'))
  const reading = await page.locator('.lca-report-scroll').evaluate((node) => ({ same: node === window.__originalPane && node.contains(window.__readingLine), before: window.__readingPosition, after: window.__readingLine.getBoundingClientRect().top }))
  assert.ok(reading.same && Math.abs(reading.before - reading.after) < 2, JSON.stringify(reading))
  assert.equal(await page.getByRole('button', { name: '下载', exact: true }).isDisabled(), true)
  await page.screenshot({ path: join(directory, 'progressive-full-document.png') })
  snapshotStep = 0
  running = false
  await page.getByRole('button', { name: '关闭审查批注稿' }).click()
  await page.locator('.lca-report-pane .quote-mark').waitFor()
  assert.equal(await page.locator('.lca-report-pane').count(), 1, '正在查看的分析完成后自动展开批注稿')
  await page.getByRole('button', { name: '关闭审查批注稿' }).click()
  await page.waitForTimeout(400)
  assert.equal(await page.locator('.lca-report-pane').count(), 0, '手动关闭后不重复自动展开')
  await page.locator('.lca-history-item').nth(1).click()
  await page.waitForURL('**/tools/labor-contract?taskId=task-1')
  await page.waitForFunction(() => {
    const node = document.querySelector('.conversation')
    return node && node.scrollHeight > node.clientHeight + 200 && node.scrollHeight - node.clientHeight - node.scrollTop < 3
  })
  assert.equal(await page.locator('.lca-report-pane').count(), 0, '选择已完成历史只滚到底部，不自动打开旧批注稿')

  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window)
    window.__replayedStages = []
    new MutationObserver(() => {
      const text = document.querySelector('.lca-progress-card')?.textContent || ''
      if (text.includes('回放')) window.__replayedStages.push(text)
    }).observe(document, { childList: true, subtree: true, characterData: true })
    window.fetch = (resource, options) => {
      const url = new URL(typeof resource === 'string' ? resource : resource.url, location.href)
      if (localStorage.getItem('lca-test-replay') !== 'yes' || !url.pathname.endsWith('/task-0/events')) return originalFetch(resource, options)
      const events = [
        ['stage.progress', { message: '首轮回放' }], ['review.round', { phase: 'end', round: 1, newCount: 2 }],
        ['stage.progress', { message: '第二轮回放' }], ['review.round', { phase: 'end', round: 2, newCount: 1 }],
        ['review.round', { phase: 'start', round: 3 }], ['review.delta', { content: '已恢复累计风险正文' }],
        ['stage.progress', { message: '第 3 轮已保存 5 条新问题，继续核对全文。' }]
      ].map(([event, data], index) => ({ event, data, seq: index + 1 })).filter(({ seq }) => seq > Number(url.searchParams.get('after')))
      const encoder = new TextEncoder()
      return Promise.resolve(new Response(new ReadableStream({
        start(controller) {
          let index = 0
          const next = () => {
            if (index === events.length) { controller.close(); return }
            const { event, data, seq } = events[index++]
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify({ ...data, _seq: seq })}\n\n`))
            setTimeout(next, 40)
          }
          next()
        }
      }), { headers: { 'Content-Type': 'text/event-stream' } }))
    }
  })
  running = true
  replay = true
  await page.evaluate(() => localStorage.setItem('lca-test-replay', 'yes'))
  await page.goto('http://localhost:5173/tools/labor-contract?taskId=task-0', { waitUntil: 'domcontentloaded' })
  await page.getByText('已恢复累计风险正文', { exact: true }).waitFor()
  assert.deepEqual(await page.evaluate(() => window.__replayedStages), [], '历史分段回放不得倒播首轮和第二轮阶段')
  assert.equal(await page.locator('.round-thinking').count(), 1, '恢复后只有第三轮处于进行中')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByText('已恢复累计风险正文', { exact: true }).waitFor()
  assert.equal(await page.getByText('已恢复累计风险正文', { exact: true }).count(), 1, '再次刷新不重复追加风险正文')
  await page.evaluate(() => localStorage.removeItem('lca-test-replay'))
  replay = false
  running = false
  failed = true
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByText('已保留的风险正文', { exact: true }).waitFor()
  await page.getByText('连接中断', { exact: true }).waitFor()
  assert.ok(await page.getByText('保留第一轮', { exact: true }).count())
  assert.ok(await page.getByText('保留第二轮', { exact: true }).count())
  assert.equal(await page.locator('.lca-open-report-card').count(), 0, '失败草稿不得显示最终稿入口')
  await page.getByRole('button', { name: '重新分析', exact: true }).waitFor()
  await page.screenshot({ path: join(directory, 'retained-failure.png') })
  await page.getByRole('button', { name: '新建分析', exact: true }).click()
  await page.locator('input[type="file"]').setInputFiles({ name: '虚构未识别材料.txt', mimeType: 'text/plain', buffer: Buffer.from('单位聘用乙方担任文员。') })
  await page.getByRole('alert').filter({ hasText: '由谁与谁签署' }).waitFor()
  assert.equal(await page.getByRole('button', { name: /重新识别/ }).count(), 0, '不增加重新识别按钮')
  await page.getByRole('button', { name: '开始分析', exact: true }).click()
  assert.equal(classificationRequests.length, 1, '缺少说明时只提示，不重复调用模型')
  await page.locator('.lca-chat-input').fill('这是单位与职工签署的劳动合同，请结合正文识别。')
  await page.getByRole('button', { name: '开始分析', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '仍无法从正文确认' }).waitFor()
  assert.equal(classificationRequests.length, 2)
  assert.ok(classificationRequests[1].includes('name="clarification"'))
  assert.ok(classificationRequests[1].includes('这是单位与职工签署的劳动合同'))
  assert.equal(analysisRequests.length, 0, '仍不支持的类型不能凭说明创建任务')
  classificationType = 'direct_labor_contract'
  await page.getByRole('button', { name: '开始分析', exact: true }).click()
  await page.getByText('合成队列不可用，保留输入供重试', { exact: true }).waitFor()
  assert.equal(classificationRequests.length, 3, '一次发送只调用一次重新分类')
  assert.equal(analysisRequests.length, 1, '识别成功后同一次发送继续创建分析')
  assert.ok(analysisRequests[0].includes('direct_labor_contract'), '不得仍保留旧unsupported角色')
  assert.ok((await page.locator('.lca-chat-input').inputValue()).includes('这是单位与职工签署'))
  assert.equal(await page.getByRole('button', { name: '移除 虚构未识别材料.txt', exact: true }).count(), 1)
  classificationParseStatus = 'empty'
  classificationType = 'unsupported'
  await page.getByRole('button', { name: '新建分析', exact: true }).click()
  await page.locator('input[type="file"]').setInputFiles({ name: '虚构空白材料.txt', mimeType: 'text/plain', buffer: Buffer.from('   ') })
  await page.getByRole('alert').filter({ hasText: '没有读取到可分析文字' }).waitFor()
  await page.locator('.lca-chat-input').fill('这是一份劳动合同')
  await page.locator('.lca-chat-input').press('Enter')
  assert.equal(await page.getByRole('button', { name: '开始分析', exact: true }).isDisabled(), true)
  assert.equal(analysisRequests.length, 1)
  assert.equal(await page.getByRole('button', { name: /重新识别/ }).count(), 0)
  await page.screenshot({ path: join(directory, 'classification-clarification.png') })

  classificationParseStatus = 'failed'
  await page.getByRole('button', { name: '新建分析', exact: true }).click()
  await page.locator('input[type="file"]').setInputFiles({ name: '虚构损坏材料.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from('invalid') })
  await page.getByRole('alert').filter({ hasText: '能否正常打开' }).waitFor()
  assert.equal(await page.getByRole('button', { name: '开始分析', exact: true }).isDisabled(), true)

  classificationParseStatus = 'succeeded'
  classificationUnavailable = true
  await page.getByRole('button', { name: '新建分析', exact: true }).click()
  await page.locator('input[type="file"]').setInputFiles({ name: '虚构服务失败.txt', mimeType: 'text/plain', buffer: Buffer.from('劳动合同') })
  await page.getByRole('alert').filter({ hasText: '暂时无法完成识别' }).waitFor()
  assert.equal(await page.getByRole('button', { name: '开始分析', exact: true }).isDisabled(), false, '服务故障允许用原按钮重试，不误判文件坏了')
  classificationUnavailable = false
  classificationType = 'direct_labor_contract'
  await page.getByRole('button', { name: '开始分析', exact: true }).click()
  await page.getByText('合成队列不可用，保留输入供重试', { exact: true }).waitFor()
  assert.equal(analysisRequests.length, 2, '服务恢复后无须补材料类型说明')

  classificationType = 'dispatch_agreement'
  await page.getByRole('button', { name: '新建分析', exact: true }).click()
  const dispatchFile = { name: '虚构劳务派遣协议.txt', mimeType: 'text/plain', buffer: readFileSync('server/scripts/fixtures/labor-dispatch-agreement.synthetic.txt') }
  await page.locator('input[type="file"]').setInputFiles(dispatchFile)
  const perspective = page.locator('.lca-analysis-options select')
  await perspective.waitFor()
  assert.equal(await perspective.inputValue(), '', '不默认推断用户代表哪一方')
  await page.getByRole('button', { name: '开始分析', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '请选择本次代表' }).waitFor()
  assert.equal(analysisRequests.length, 2)
  await perspective.selectOption('using_unit')
  assert.equal(await page.getByRole('alert').filter({ hasText: '请选择本次代表' }).count(), 0, '选择后清掉已经解决的提示')
  await page.locator('.composer').screenshot({ path: join(directory, 'dispatch-perspective.png') })
  await page.getByRole('button', { name: '开始分析', exact: true }).click()
  await page.getByText('合成队列不可用，保留输入供重试', { exact: true }).waitFor()
  assert.equal(analysisRequests.length, 3)
  assert.ok(analysisRequests.at(-1).includes('labor_dispatch_agreement'))
  assert.ok(analysisRequests.at(-1).includes('using_unit'))
  await perspective.selectOption('dispatch_unit')
  const dispatchResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/tasks/labor-contract-analysis' && response.request().method() === 'POST')
  await page.getByRole('button', { name: '开始分析', exact: true }).click()
  await dispatchResponse
  assert.equal(analysisRequests.length, 4)
  assert.ok(analysisRequests.at(-1).includes('dispatch_unit'))
  classificationType = 'dispatch_employment_contract'
  await page.getByRole('button', { name: '新建分析', exact: true }).click()
  await page.locator('input[type="file"]').setInputFiles({ name: '虚构派遣劳动合同.txt', mimeType: 'text/plain', buffer: readFileSync('server/scripts/fixtures/labor-dispatch-employment-contract.synthetic.txt') })
  await page.waitForFunction(() => !document.querySelector('.voice-send')?.disabled)
  assert.equal(await perspective.count(), 0, '单独派遣劳动合同不出现协议视角下拉框')
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ passed: true, metrics, screenshots: directory }))
} catch (error) {
  console.error(JSON.stringify({ url: page.url(), errors, body: (await page.locator('body').innerText()).slice(0, 1600) }))
  await page.screenshot({ path: join(directory, 'failure.png') })
  throw error
} finally {
  await browser.close()
}
