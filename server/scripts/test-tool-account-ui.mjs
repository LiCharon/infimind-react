// All account and authentication requests are intercepted; no account balance or model is accessed.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { chromium } from 'playwright'

const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const browser = await chromium.launch({ headless: true, ...(existsSync(edge) ? { executablePath: edge } : {}) })
const screenshots = join(tmpdir(), 'fafee-tool-account-ui')
mkdirSync(screenshots, { recursive: true })
const errors = []
const paths = ['/contract-rewrite', '/contract-draft', '/labor-consult', '/tools/labor-contract', '/tools/arbitration', '/tools/ai-assistant', '/tools/handbook', '/tools/medical-calculator', '/tools/pension-calc1', '/tools/pension-calc2']
try {
  for (const path of paths) {
    let balanceCalls = 0
    let balanceState = 'available'
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
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
    const trigger = page.locator('.account-trigger')
    assert.equal(await trigger.count(), 1, `${path}: shared account trigger`)
    assert.ok(!(await trigger.textContent()).includes('助手助手'), `${path}: repeated assistant label`)
    assert.equal(balanceCalls, 0, `${path}: don't query balance until opened`)
    await trigger.click()
    await page.locator('.balance-item b').filter({ hasText: '408.15' }).waitFor()
    assert.equal(await trigger.getAttribute('aria-expanded'), 'true')
    assert.equal(await page.getByRole('link', { name: '充值用量' }).getAttribute('href'), 'https://platform.deepseek.com/')
    const rect = await page.locator('.balance-popover').boundingBox()
    assert.ok(rect.y >= 0 && rect.y + rect.height <= 900, `${path}: popover clipped`)
    await page.screenshot({ path: join(screenshots, path.split('/').pop() + '.png') })
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('.balance-popover').count(), 0)
    await trigger.click()
    await page.locator('.balance-item b').waitFor()
    await page.getByRole('button', { name: '关闭用量面板' }).click()
    assert.equal(await trigger.getAttribute('aria-expanded'), 'false')
    await trigger.click()
    await page.locator('.balance-item b').waitFor()
    balanceState = 'error'
    await page.getByRole('button', { name: '刷新用量' }).click()
    await page.getByRole('alert').filter({ hasText: '合成查询失败' }).waitFor()
    assert.equal(await page.locator('.balance-available').count(), 0, 'failed refresh must not display stale availability')
    balanceState = 'unavailable'
    await page.getByRole('button', { name: '刷新用量' }).click()
    await page.getByText('当前用量不足，暂不可使用', { exact: true }).waitFor()
    balanceState = 'missing'
    await page.getByRole('button', { name: '刷新用量' }).click()
    await page.getByText('暂未返回人民币用量。', { exact: true }).waitFor()
    assert.equal(await page.locator('.balance-unavailable').count(), 0)
    await page.locator('.composer textarea').click()
    assert.equal(await page.locator('.balance-popover').count(), 0)
    assert.equal(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 2), true, `${path}: page overflow`)
    await page.close()
  }
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ passed: true, paths, screenshots }))
} finally { await browser.close() }
