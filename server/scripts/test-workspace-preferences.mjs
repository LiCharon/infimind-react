// Requires a running Vite server. API requests use test fixtures; no live model calls.
const BASE_URL = process.env.WORKSPACE_TEST_URL || 'http://localhost:5173';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
(async () => {
  const browser = await chromium.launch({
    headless: true,
    channel: 'chrome'
  });
  const context = await browser.newContext({
    viewport: {
      width: 1440,
      height: 900
    }
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const user = {
    id: 'preference-check',
    username: '测试',
    email: 'p@example.test'
  };
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/labor-consult') return route.fulfill({
      contentType: 'text/event-stream',
      body: 'event: consult.reasoning\ndata: {"content":"分析过程测试"}\n\nevent: consult.delta\ndata: {"content":"正文测试 [参考链接](https://workspace.example.test/source)"}\n\n'
    });
    const json = path === '/api/auth/refresh' ? {
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
    };
    return route.fulfill({
      json
    });
  });
  await page.context().route('https://workspace.example.test/**', route => route.fulfill({
    contentType: 'text/html',
    body: '<p>Mock source page</p>'
  }));
  const open = async () => {
    await page.keyboard.press('Control+,');
    await page.locator('dialog[open]').waitFor();
  };
  await page.goto(`${BASE_URL}/labor-consult`);
  await page.locator('.composer textarea').waitFor();
  await page.locator('.tool-thinking-toggle').click();
  await page.locator('.composer textarea').fill('测试偏好');
  await page.locator('.voice-send').click();
  await page.locator('.labor-answer a').waitFor();
  await page.waitForFunction(() => !document.querySelector('.thread-running'));
  const iconSize = await page.locator('.tool-thinking-toggle').evaluate(e => getComputedStyle(e).fontSize);
  await open();
  await page.locator('#settings-fontSize').fill('22');
  await page.locator('#settings-steps').selectOption('detailed');
  await page.getByRole('button', {
    name: '编辑快捷键'
  }).click();
  await page.locator('#settings-shortcut-search').selectOption('j');
  await page.getByRole('button', {
    name: '返回设置'
  }).click();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.labor-answer p').evaluate(e => getComputedStyle(e).fontSize), '22px');
  assert.equal(await page.locator('.tool-thinking-toggle').evaluate(e => getComputedStyle(e).fontSize), iconSize);
  assert(await page.locator('.labor-reasoning-body').isVisible());
  await page.keyboard.press('Control+j');
  await page.waitForFunction(() => document.activeElement?.matches('.sidebar-search input'));
  assert.equal(await page.locator('.sidebar-search input').evaluate(e => e === document.activeElement), true);
  await page.locator('.composer textarea').focus();
  await page.keyboard.press('Control+k');
  assert.equal(await page.locator('.composer textarea').evaluate(e => e === document.activeElement), true);
  await open();
  await page.locator('#settings-steps').selectOption('compact');
  await page.keyboard.press('Escape');
  assert(await page.locator('.labor-reasoning').isHidden());
  await page.getByRole('button', {
    name: '展开证据面板'
  }).click();
  assert(await page.locator('.labor-evidence').isVisible());
  await open();
  await page.locator('#settings-analysisPanel').uncheck();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.labor-evidence').count(), 0);
  assert(await page.locator('.labor-answer').isVisible());
  const popupPromise = page.waitForEvent('popup');
  await page.locator('.labor-answer a').click();
  const popup = await popupPromise;
  await popup.waitForLoadState();
  assert.equal(popup.url(), 'https://workspace.example.test/source');
  await popup.close();
  await open();
  await page.locator('#settings-links').selectOption('current-tab');
  await page.locator('input[value=system]').check();
  await page.keyboard.press('Escape');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForFunction(() => document.querySelector('.app-workspace').dataset.theme === 'dark');
  assert.equal(await page.locator('.app-workspace').getAttribute('data-theme'), 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForFunction(() => document.querySelector('.app-workspace').dataset.theme === 'light');
  assert.equal(await page.locator('.app-workspace').getAttribute('data-theme'), 'light');
  await page.locator('.labor-answer a').click();
  await page.waitForURL('https://workspace.example.test/source');
  await page.goto(`${BASE_URL}/labor-consult`);
  await page.locator('.composer textarea').waitFor();
  await page.getByRole('button', {
    name: '会话选项'
  }).click();
  await page.getByRole('menuitem', {
    name: '新建侧边聊天'
  }).click();
  const side = page.frameLocator('iframe');
  await side.locator('.workspace-side-chat-empty').waitFor();
  await open();
  await page.locator('#settings-language').selectOption('en');
  await page.locator('input[value=dark]').check();
  await page.keyboard.press('Escape');
  await side.getByRole('heading', {
    name: 'Think it through with Fafee'
  }).waitFor();
  assert.equal(await side.locator('.app-workspace').getAttribute('data-theme'), 'dark');
  assert.equal(await side.locator('.app-workspace').evaluate(e => getComputedStyle(e).getPropertyValue('--workspace-chat-font-size').trim()), '22px');
  assert.equal(await page.locator('.app-workspace').getAttribute('lang'), 'en');
  // A second account in the same browser starts with its own defaults.
  const other = await page.context().newPage();
  await other.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    const otherUser = { ...user, id: 'separate-settings-account' };
    return route.fulfill({ json: path === '/api/auth/refresh' ? { user: otherUser, accessToken: 'test', accessTokenExpiresAt: new Date(Date.now() + 900000).toISOString() } : path === '/api/auth/me' ? { user: otherUser } : { tasks: [], laws: [] } });
  });
  await other.goto(`${BASE_URL}/labor-consult`);
  await other.locator('.composer textarea').waitFor();
  assert.equal(await other.locator('.app-workspace').getAttribute('lang'), 'zh-CN');
  assert.equal(await other.locator('.app-workspace').evaluate(e => getComputedStyle(e).getPropertyValue('--workspace-chat-font-size').trim()), '16px');
  assert.equal(await page.locator('.app-workspace').getAttribute('lang'), 'en');
  await other.close();
  assert.deepEqual(errors, []);
  console.log('Font sizing, work-step visibility, evidence toggle, remapped shortcuts, link destinations, live system theme, and side-chat preference sync passed');
  await browser.close();
})().catch(e => {
  console.error(e);
  process.exit(1);
});
