// All requests are intercepted. This checks shared UI without calling a real model.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { chromium } from 'playwright'

const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const browser = await chromium.launch({ headless: true, ...(existsSync(edge) ? { executablePath: edge } : {}) })
const directory = join(tmpdir(), 'fafee-shared-workbench-ui')
mkdirSync(directory, { recursive: true })
const errors = []
const checks = []
try {
  for (const [path, key, thinking] of [
    ['/contract-rewrite', 'fafee-history-v2:browser-test:contract-review:threads', true],
    ['/contract-draft', 'fafee-history-v2:browser-test:contract-draft:threads', true],
    ['/labor-consult', 'fafee-labor-consult-threads-v1', true],
    ['/tools/arbitration', 'fafee-labor-arbitration-v1:browser-test', true],
    ['/tools/handbook', 'fafee-history-v2:browser-test:handbook:threads', false]
  ]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    page.on('pageerror', (error) => errors.push(`${path}: ${error.message}`))
    await page.addInitScript(({ key }) => {
      const threads = Array.from({ length: 70 }, (_, index) => ({ id: `synthetic-${index}`, title: `合成历史会话 ${index}`, messages: [
        { id: `user-${index}`, type: 'user', role: 'user', content: '合成测试问题' },
        { id: `assistant-${index}`, type: 'assistant', role: 'assistant', content: '合成测试回答' }
      ], updatedAt: Date.now() - index * 3600000 }))
      window.localStorage.setItem(key, JSON.stringify(threads))
    }, { key })
    await page.route('**/api/**', async (route) => {
      const url = new URL(route.request().url())
      const body = url.pathname === '/api/auth/refresh' ? { accessToken: 'browser-test-only', expiresAt: '2099-01-01' }
        : url.pathname === '/api/auth/me' ? { user: { id: 'browser-test', username: '测试用户', email: 'test@example.test' } }
          : { tasks: [], threads: [], conversations: [], messages: [], balances: [] }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    })
    await page.goto(`http://localhost:5173${path}`, { waitUntil: 'networkidle' })
    await page.locator('.composer textarea').waitFor()
    const metrics = await page.evaluate(() => {
      const history = document.querySelector('.chat-sidebar .history-list')
      const composer = document.querySelector('.composer').getBoundingClientRect()
      return { body: document.documentElement.scrollHeight, viewport: innerHeight, historyHeight: history.clientHeight, historyScroll: history.scrollHeight, rowHeight: history.querySelector('button').getBoundingClientRect().height, count: history.querySelectorAll('button').length, composerBottom: composer.bottom }
    })
    assert.ok(metrics.count >= 70, `${path}: long history was not loaded: ${JSON.stringify(metrics)}`)
    assert.ok(metrics.body <= metrics.viewport + 2, `${path}: ${JSON.stringify(metrics)}`)
    assert.ok(metrics.historyScroll > metrics.historyHeight)
    assert.ok(metrics.rowHeight >= 44, `${path}: history rows must not shrink or clip text`)
    assert.ok(metrics.composerBottom <= metrics.viewport + 2)
    assert.equal(await page.getByRole('link', { name: '工具总览', exact: true }).getAttribute('href'), '/tools')
    assert.equal(await page.getByRole('button', { name: '快速', exact: true }).count(), 0)
    if (thinking) {
      const toggle = page.getByRole('button', { name: '深度思考', exact: true })
      const previous = await toggle.getAttribute('aria-pressed')
      await toggle.click()
      assert.notEqual(await toggle.getAttribute('aria-pressed'), previous)
    }
    await page.getByRole('button', { name: /上下文占比/ }).click()
    await page.locator('.tool-context-popover').waitFor()
    await page.keyboard.press('Escape')
    const collapse = page.getByRole('button', { name: /折叠.*(栏|记录)|收起.*(栏|记录)/ }).first()
    await collapse.click()
    await page.waitForFunction(() => document.querySelector('.chat-sidebar').getBoundingClientRect().width < 2)
    await page.getByRole('button', { name: /展开.*(栏|记录)/ }).first().click()
    await page.waitForFunction(() => document.querySelector('.chat-sidebar').getBoundingClientRect().width > 200)
    await page.screenshot({ path: join(directory, path.split('/').pop() + '.png') })
    await page.setViewportSize({ width: 390, height: 844 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), `${path}: mobile horizontal overflow`)
    await page.getByRole('link', { name: '工具总览', exact: true }).click()
    await page.waitForURL('**/tools')
    checks.push({ path, ...metrics })
    await page.close()
  }
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ passed: true, checks, screenshots: directory }))
} finally { await browser.close() }
