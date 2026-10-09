// All account and authentication requests are intercepted; no account balance or model is accessed.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { chromium } from 'playwright'

const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const browser = await chromium.launch({ headless: true, ...(existsSync(edge) ? { executablePath: edge } : process.platform === 'darwin' ? { channel: 'chrome' } : {}) })
const screenshots = join(tmpdir(), 'fafee-tool-account-ui')
mkdirSync(screenshots, { recursive: true })
const errors = []
const paths = ['/contract-rewrite', '/contract-draft', '/labor-consult', '/tools/labor-contract', '/tools/arbitration', '/tools/ai-assistant', '/tools/handbook', '/tools/medical-calculator', '/tools/pension-calc1', '/tools/pension-calc2']
try {
  for (const width of [1440, 390, 320]) {
  console.log(`Checking account menu at ${width}px`)
  for (const path of paths) {
    let balanceCalls = 0
    let balanceState = 'available'
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
    page.on('pageerror', (error) => errors.push(`${path}: ${error.message}`))
    await page.route('**/api/**', async (route) => {
      const url = new URL(route.request().url())
      let status = 200
      let body = { tasks: [], threads: [], conversations: [], messages: [] }
      if (url.pathname === '/api/auth/refresh') body = { accessToken: 'browser-test-only', expiresAt: '2099-01-01' }
      if (url.pathname === '/api/auth/me') body = { user: { id: 'account-test', username: '测试用户', email: 'test@example.test' } }
      if (url.pathname === '/api/account/balance') {
        balanceCalls++
        if (balanceState === 'error') { status = 503; body = { error: '合成查询失败，请重试。' } }
        else body = { balances: balanceState === 'missing' ? [] : [{ currency: 'CNY', total: balanceState === 'available' ? '408.15' : '0.00', toppedUp: '408.15', granted: '0.00' }], isAvailable: balanceState === 'available' }
      }
      return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    })
    await page.goto(`http://localhost:5173${path}`, { waitUntil: 'networkidle' })
    const trigger = page.getByRole('button', { name: '账户菜单', exact: true })
    assert.equal(await trigger.count(), 1, `${path}: shared account trigger`)
    assert.equal(await page.locator('.account-trigger, .balance-popover, .sidebar-footer-wrap').count(), 0, `${path}: old sidebar account entry removed`)
    assert.equal(balanceCalls, 0, `${path}: don't query balance on page load`)
    await trigger.click()
    const account = page.getByRole('dialog', { name: '账户', exact: true })
    const usage = account.locator('summary').filter({ hasText: '剩余用量' })
    assert.equal(balanceCalls, 0, `${path}: don't query until usage is expanded`)
    assert.equal(await account.locator('details').getAttribute('open'), null)
    await usage.focus()
    await page.keyboard.press('Enter')
    await page.locator('.workspace-usage-total dd').filter({ hasText: '408.15' }).waitFor()
    assert.equal(await trigger.getAttribute('aria-expanded'), 'true')
    assert.equal(await account.getByRole('link', { name: '充值用量' }).getAttribute('href'), 'https://platform.deepseek.com/')
    assert.equal(await account.getByRole('link', { name: '返回官网', exact: true }).count(), 1)
    assert.equal(await account.getByRole('button', { name: '退出登录', exact: true }).count(), 1)
    const rect = await account.boundingBox()
    assert.ok(rect.x >= 0 && rect.x + rect.width <= width && rect.y >= 0 && rect.y + rect.height <= 900, `${path} ${width}: account panel clipped`)
    if (path === '/labor-consult') await page.screenshot({ path: join(screenshots, `${width}-expanded.png`) })
    const firstCalls = balanceCalls
    await usage.click()
    assert.equal(await page.locator('.workspace-usage-content').isHidden(), true)
    if (path === '/labor-consult') await page.screenshot({ path: join(screenshots, `${width}-collapsed.png`) })
    await usage.click()
    await page.locator('.workspace-usage-total dd').waitFor()
    assert.equal(balanceCalls, firstCalls, `${path}: collapse/reopen reuses the current query`)
    await page.keyboard.press('Escape')
    assert.equal(await account.count(), 0)
    assert.equal(await trigger.getAttribute('aria-expanded'), 'false')
    await trigger.click()
    await page.locator('summary').filter({ hasText: '剩余用量' }).click()
    await page.locator('.workspace-usage-total dd').waitFor()
    balanceState = 'error'
    await page.getByRole('button', { name: '刷新用量', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: '合成查询失败' }).waitFor()
    assert.equal(await page.locator('.workspace-usage-availability').count(), 0, 'failed refresh must not display stale availability')
    assert.equal(await page.locator('.workspace-usage-total').count(), 0, 'failed refresh must not display stale balance')
    balanceState = 'unavailable'
    await page.getByRole('button', { name: '刷新用量', exact: true }).click()
    await page.getByText('当前用量不足，暂不可使用', { exact: true }).waitFor()
    balanceState = 'missing'
    await page.getByRole('button', { name: '刷新用量', exact: true }).click()
    await page.getByText('暂未返回人民币用量。', { exact: true }).waitFor()
    assert.equal(await page.locator('.workspace-usage-availability').count(), 0)
    await page.locator('.app-workspace-page-title').click()
    assert.equal(await account.count(), 0)
    assert.equal(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 2 && document.documentElement.scrollWidth <= innerWidth), true, `${path}: page overflow`)
    await page.close()
  }
  }
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ passed: true, paths, screenshots }))
} finally { await browser.close() }
