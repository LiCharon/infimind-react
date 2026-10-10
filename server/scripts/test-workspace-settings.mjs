// Requires a running Vite server. API requests use test fixtures; no live model calls.
const BASE_URL = process.env.WORKSPACE_TEST_URL || 'http://localhost:5173';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
(async () => {
  const browser = await chromium.launch({
    headless: true,
    channel: 'chrome'
  });
  const page = await browser.newPage({
    viewport: {
      width: 1440,
      height: 900
    }
  });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    const user = {
      id: 'settings-test',
      username: '设置测试',
      email: 'settings@example.test'
    };
    return route.fulfill({
      json: path === '/api/auth/refresh' ? {
        user,
        accessToken: 'test',
        accessTokenExpiresAt: new Date(Date.now() + 900000).toISOString()
      } : path === '/api/auth/me' ? {
        user
      } : path === '/api/tasks' ? {
        tasks: [],
        hasMore: false
      } : path === '/api/labor/laws' ? {
        laws: []
      } : {
        laws: 0,
        effectiveLaws: 0,
        cases: 0,
        kb: {
          entries: 0
        }
      }
    });
  });
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({
      width,
      height: 900
    });
    await page.goto(`${BASE_URL}/labor-consult`);
    await page.locator('.composer textarea').waitFor();
    await page.getByRole('button', {
      name: '账户菜单',
      exact: true
    }).click();
    await page.getByRole('button', {
      name: '设置',
      exact: true
    }).click();
    await page.locator('dialog[open]').waitFor();
    const dlg = page.locator('dialog');
    assert.equal(await dlg.locator('.workspace-setting-row').count(), 7);
    await page.locator('input[value=dark]').check();
    assert.equal(await page.locator('.app-workspace').getAttribute('data-theme'), 'dark');
    await page.screenshot({
      path: `/tmp/fafee-settings-${width}.png`
    });
    await page.locator('input[value=light]').check();
    await page.locator('#settings-fontSize').fill('20');
    await page.locator('#settings-steps').selectOption('detailed');
    await page.locator('#settings-analysisPanel').uncheck();
    assert.equal(await page.locator('.app-workspace').getAttribute('data-analysis-panel'), 'false');
    await page.locator('#settings-language').selectOption('en');
    await page.getByRole('heading', {
      name: 'Settings',
      exact: true
    }).waitFor();
    await page.getByRole('button', {
      name: 'Edit shortcuts',
      exact: true
    }).click();
    await page.locator('#settings-sendKey').selectOption('command-enter');
    await page.locator('#settings-shortcut-search').selectOption('j');
    await page.getByRole('button', {
      name: 'Back to settings'
    }).click();
    await page.locator('#settings-language').selectOption('zh-CN');
    await page.keyboard.press('Escape');
    assert.equal(await dlg.count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.reload();
    await page.locator('.composer textarea').waitFor();
    assert.equal(await page.locator('.app-workspace').getAttribute('data-steps'), 'detailed');
    await page.keyboard.press('Control+,');
    await page.locator('dialog[open]').waitFor();
    await page.getByRole('button', {
      name: '编辑快捷键'
    }).click();
    await page.getByRole('button', {
      name: '恢复默认快捷键'
    }).click();
    await page.getByRole('button', {
      name: '返回设置'
    }).click();
    await page.locator('#settings-analysisPanel').check();
    await page.locator('#settings-fontSize').fill('16');
    await page.locator('#settings-steps').selectOption('standard');
    await page.keyboard.press('Escape');
    console.log(width + 'px settings responsive, theme/language/preferences/shortcuts persisted');
  }
  for (const tool of ['/labor-consult', '/contract-rewrite', '/contract-draft', '/tools/labor-contract', '/tools/arbitration']) {
    await page.goto(BASE_URL + tool);
    await page.locator('.composer textarea').waitFor();
    await page.keyboard.press('Control+,');
    await page.locator('#settings-language').selectOption('en');
    await page.keyboard.press('Escape');
    await page.getByRole('button', {
      name: 'Account menu',
      exact: true
    }).waitFor();
    assert(!(await page.locator('.app-workspace-topbar strong').innerText().then(x => /[\u4e00-\u9fff]/.test(x))));
    await page.keyboard.press('Control+,');
    await page.locator('#settings-language').selectOption('zh-CN');
    await page.keyboard.press('Escape');
    console.log(tool + ' settings and English shell passed');
  }
  assert.deepEqual(errors, []);
  await browser.close();
})().catch(e => {
  console.error(e);
  process.exit(1);
});
