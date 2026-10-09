// Requires a running Vite server. API requests use test fixtures; no live model calls.
const BASE_URL = process.env.WORKSPACE_TEST_URL || 'http://localhost:5173';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
(async () => {
  const browser = await chromium.launch({
    headless: true,
    channel: 'chrome'
  });
  for (const tool of ['/labor-consult', '/contract-draft', '/tools/arbitration', '/tools/labor-contract', '/contract-rewrite']) {
    const page = await browser.newPage({
      viewport: {
        width: 1440,
        height: 900
      }
    });
    const pendingEvents = [],
      created = [],
      cancellations = [],
      errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const user = {
      id: 'durable-send',
      username: '测试',
      email: 's@example.test'
    };
    const tasks = new Map();
    let creationRoute = null;
    let delayCreation = false;
    let allowCancel = false;
    const product = {
      '/labor-consult': 'labor-consult',
      '/contract-draft': 'contract-draft',
      '/tools/arbitration': 'labor-arbitration',
      '/tools/labor-contract': 'labor-contract-analysis',
      '/contract-rewrite': 'contract-review'
    }[tool];
    const terminal = (task, status) => ({
      ...task,
      status,
      result: status === 'succeeded' ? {
        analysisStatus: 'completed',
        productId: product,
        answer: '第一条完整回答',
        reviewReport: '第一条完整回答',
        draftText: '合同完整正文',
        caseRecord: {
          requests: [],
          facts: []
        }
      } : null
    });
    const respondCreation = async route => {
      const body = route.request().postData();
      const text = (body.match(/name="(?:message|focus)"\r\n\r\n([^\r]*)/) || [])[1];
      const tid = (body.match(/name="threadId"\r\n\r\n([^\r]*)/) || [])[1] || 'analysis-thread';
      const task = {
        id: 'job-' + (created.length + 1),
        threadId: tid,
        productId: product,
        status: 'running',
        action: 'analyze',
        mode: 'thinking',
        title: '测试任务',
        createdAt: new Date().toISOString(),
        prompt: text
      };
      created.push({
        task,
        body
      });
      tasks.set(task.id, task);
      await route.fulfill({
        json: {
          taskId: task.id,
          productId: product,
          status: 'running',
          task
        }
      });
    };
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/tasks/' + product && route.request().method() === 'POST') {
        if (delayCreation) {
          creationRoute = route;
          return;
        }
        return respondCreation(route);
      }
      if (/\/api\/tasks\/job-\d+\/events/.test(path)) {
        pendingEvents.push({
          route,
          id: path.split('/')[3]
        });
        return;
      }
      if (/\/api\/tasks\/job-\d+\/cancel/.test(path)) {
        const id = path.split('/')[3];
        cancellations.push(id);
        tasks.set(id, {
          ...tasks.get(id),
          status: 'cancel_requested'
        });
        await route.fulfill({
          json: {
            task: tasks.get(id)
          }
        });
        return;
      }
      if (/^\/api\/tasks\/job-\d+$/.test(path)) {
        const id = path.split('/')[3];
        if (allowCancel && tasks.get(id).status === 'cancel_requested') tasks.set(id, terminal(tasks.get(id), 'cancelled'));
        await route.fulfill({
          json: {
            task: tasks.get(id)
          }
        });
        return;
      }
      if (path.endsWith('/classify')) {
        await route.fulfill({
          json: {
            classifications: [{
              suggestedType: 'direct_labor_contract',
              suggestedLabel: '劳动合同',
              parseStatus: 'succeeded',
              confidence: 'high'
            }]
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
        tasks: [...tasks.values()],
        hasMore: false
      } : path.includes('/thread/') ? {
        tasks: [...tasks.values()]
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
    await page.keyboard.press('Control+,');
    await page.locator('#settings-busySend').selectOption('queue');
    await page.keyboard.press('Escape');
    if (['/tools/labor-contract', '/contract-rewrite'].includes(tool)) {
      await page.locator('input[type=file]').first().setInputFiles({
        name: '合同.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('劳动合同试用期三个月')
      });
    }
    await page.locator('.composer textarea').fill('第一条');
    await page.locator('.voice-send').click();
    for (let i = 0; i < 80 && pendingEvents.length < 1; i++) await page.waitForTimeout(50);
    assert.equal(created.length, 1, tool + ' first task not created');
    if (tool === '/contract-rewrite') await page.locator('input[type=file]').first().setInputFiles({
      name: '追问合同.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('合同内容')
    });
    await page.locator('.composer textarea').fill('第二条');
    await page.locator('.voice-send').click();
    await page.locator('.workspace-send-queue').waitFor();
    assert.equal(created.length, 1);
    assert.equal(cancellations.length, 0);
    tasks.set('job-1', terminal(tasks.get('job-1'), 'succeeded'));
    await pendingEvents[0].route.fulfill({
      contentType: 'text/event-stream',
      body: 'event: task.succeeded\ndata: {"_seq":1}\n\n'
    });
    for (let i = 0; i < 100 && created.length < 2; i++) await page.waitForTimeout(50);
    assert.equal(created.length, 2, tool + ' queued task not sent');
    assert.match(created[1].body, /第二条/);
    tasks.set('job-2', terminal(tasks.get('job-2'), 'succeeded'));
    for (let i = 0; i < 50 && pendingEvents.length < 2; i++) await page.waitForTimeout(50);
    await pendingEvents[1].route.fulfill({
      contentType: 'text/event-stream',
      body: 'event: task.succeeded\ndata: {"_seq":1}\n\n'
    });
    await page.waitForTimeout(500);
    // Interruption must not issue a replacement task until server cancellation is confirmed.
    await page.keyboard.press('Control+,');
    await page.locator('#settings-busySend').selectOption('interrupt');
    await page.keyboard.press('Escape');
    delayCreation = true;
    if (tool === '/tools/labor-contract') {
      await page.keyboard.press('Control+n');
      await page.locator('input[type=file]').first().setInputFiles({
        name: '新合同.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('劳动合同试用期三个月')
      });
    }
    if (tool === '/contract-rewrite') await page.locator('input[type=file]').first().setInputFiles({
      name: '新合同.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('合同内容')
    });
    await page.locator('.composer textarea').fill('第三条');
    await page.locator('.voice-send').click();
    for (let i = 0; i < 50 && !creationRoute; i++) await page.waitForTimeout(50);
    assert(creationRoute);
    if (tool === '/tools/labor-contract') {
      // Creation is deliberately blocked in this tool's composer.
      assert(await page.locator('.voice-send').isDisabled());
      delayCreation = false;
      await respondCreation(creationRoute);
      await page.waitForTimeout(300);
    } else {
      if (tool === '/contract-rewrite') await page.locator('input[type=file]').first().setInputFiles({
        name: '插话合同.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('合同内容')
      });
      await page.locator('.composer textarea').fill('第四条插话');
      await page.locator('.voice-send').click();
      assert.equal(created.length, 2);
      delayCreation = false;
      await respondCreation(creationRoute);
    }
    if (tool === '/tools/labor-contract') {
      await page.locator('.composer textarea').fill('第四条插话');
      await page.locator('.voice-send').click();
    }
    for (let i = 0; i < 50 && !cancellations.length; i++) await page.waitForTimeout(50);
    assert.equal(cancellations.at(-1), 'job-3', tool + ' did not cancel');
    assert.equal(created.length, 3, 'replacement created before old task terminal');
    allowCancel = true;
    const event3 = pendingEvents.find(x => x.id === 'job-3');
    if (event3) await event3.route.fulfill({
      contentType: 'text/event-stream',
      body: 'event: task.cancelled\ndata: {"_seq":1}\n\n'
    }).catch(() => {});
    for (let i = 0; i < 150 && created.length < 4; i++) await page.waitForTimeout(50);
    assert.equal(created.length, 4, tool + ' replacement not created');
    assert.match(created[3].body, /第四条插话/);
    if (tool === '/contract-rewrite') {
      const eventCount = pendingEvents.length;
      await page.reload();
      await page.locator('.composer textarea').waitFor();
      for (let i = 0; i < 100 && pendingEvents.length <= eventCount; i++) await page.waitForTimeout(50);
      const restored = pendingEvents.at(-1);
      assert.equal(restored.id, 'job-4');
      tasks.set('job-4', terminal(tasks.get('job-4'), 'succeeded'));
      await restored.route.fulfill({ contentType: 'text/event-stream', body: 'event: task.succeeded\ndata: {"_seq":1}\n\n' });
      await page.waitForFunction(() => !document.querySelector('.history-list .thread-running'));
    }
    assert.deepEqual(errors, []);
    console.log(tool + ' durable queue and interruption wait for confirmed cancellation passed');
    await page.close();
  }
  await browser.close();
})().catch(e => {
  console.error(e);
  process.exit(1);
});
