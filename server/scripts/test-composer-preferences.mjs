// Requires a running Vite server. API requests use test fixtures; no live model calls.
const BASE_URL = process.env.WORKSPACE_TEST_URL || 'http://localhost:5173';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
(async () => {
  const browser = await chromium.launch({
    headless: true,
    channel: 'chrome'
  });
  for (const tool of ['/labor-consult', '/contract-rewrite', '/contract-draft']) {
    const page = await browser.newPage({
      viewport: {
        width: 1440,
        height: 900
      }
    });
    const pending = [],
      errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const user = {
      id: 'queue-test',
      username: '测试',
      email: 'q@example.test'
    };
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (['/api/labor-consult', '/api/contract-chat', '/api/contract-draft'].includes(path)) {
        pending.push({
          route,
          data: route.request().postDataJSON()
        });
        return;
      }
      if (path === '/api/tasks/contract-draft') {
        await route.fulfill({
          status: 409,
          json: {
            code: 'draft_sse_required'
          }
        });
        return;
      }
      const json = path === '/api/auth/refresh' ? {
        user,
        accessToken: 'test',
        accessTokenExpiresAt: new Date(Date.now() + 900000).toISOString()
      } : path === '/api/auth/me' ? {
        user
      } : path === '/api/tasks' ? {
        tasks: [],
        hasMore: false
      } : path === '/api/conversation-title' ? {
        ok: false
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
      await route.fulfill({
        json
      });
    });
    await page.goto(BASE_URL + tool);
    await page.locator('.composer textarea').waitFor();
    if ((await page.locator('.tool-thinking-toggle').getAttribute('aria-pressed')) === 'true') await page.locator('.tool-thinking-toggle').click();
    await page.keyboard.press('Control+,');
    await page.locator('#settings-busySend').selectOption('queue');
    await page.getByRole('button', {
      name: '编辑快捷键'
    }).click();
    await page.locator('#settings-sendKey').selectOption('command-enter');
    await page.keyboard.press('Escape');
    const input = page.locator('.composer textarea');
    await input.fill('第一条');
    await input.press('Enter');
    assert.equal(pending.length, 0, 'plain Enter sent despite shortcut preference');
    await input.press('Control+Enter');
    await page.waitForFunction(() => document.querySelector('.history-list .thread-running'));
    for (let i = 0; i < 40 && !pending.length; i++) await page.waitForTimeout(50);
    assert.equal(pending.length, 1);
    await input.fill('第二条');
    await input.press('Control+Enter');
    await page.locator('.workspace-send-queue').waitFor();
    assert.equal(pending.length, 1, 'queue interrupted running response');
    await input.fill('取消这条');
    await input.press('Control+Enter');
    await page.locator('.workspace-send-queue button').last().click();
    await input.fill('尚未发送的草稿');
    const event = tool === '/labor-consult' ? 'consult.delta' : 'chat.delta';
    await pending[0].route.fulfill({
      contentType: 'text/event-stream',
      body: `event: ${event}\ndata: {"content":"第一条已回答"}\n\n`
    });
    for (let i = 0; i < 60 && pending.length < 2; i++) await page.waitForTimeout(50);
    assert.equal(pending.length, 2);
    assert.equal(pending[1].data.message, '第二条');
    assert(pending[1].data.history.some(x => x.content.includes('第一条已回答')), 'queue used stale conversation history');
    assert.equal(await input.inputValue(), '尚未发送的草稿', 'auto-send erased unsent draft');
    await pending[1].route.fulfill({
      contentType: 'text/event-stream',
      body: `event: ${event}\ndata: {"content":"第二条已回答"}\n\n`
    });
    await page.waitForFunction(() => !document.querySelector('.history-list .thread-running'));
    assert.deepEqual(errors, []);
    console.log(tool + ' send keys, queue, cancel queued item, fresh history and draft preservation passed');
    await page.close();
  }
  await browser.close();
})().catch(e => {
  console.error(e);
  process.exit(1);
});
