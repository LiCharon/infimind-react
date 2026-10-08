"""Real browser -> isolated auth/API/queue -> DeepSeek. Requires --live harness --serve.

python server/scripts/test-arbitration-live-ui.py --ready <test-output>/ready.json
No API mocks, production users, production database, or service restarts.
"""
import argparse
import json
import socket
import sqlite3
import subprocess
import time
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--ready', required=True)
args = parser.parse_args()
ready = json.loads(Path(args.ready).read_text(encoding='utf-8'))
output = Path(ready['output']).resolve()
assert output.name.startswith('fafee-arbitration-live-'), '仅允许操作本次独立测试目录'
repo = Path(__file__).resolve().parents[2]
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    port = sock.getsockname()[1]
frontend = f'http://127.0.0.1:{port}'
starter = output / 'start-vite.mjs'
starter.write_text(
    "import { createServer } from " + json.dumps((repo / 'node_modules/vite/dist/node/index.js').as_uri()) + ";\n"
    "const server=await createServer({configFile:" + json.dumps(str(repo / 'vite.config.js')) +
    ",server:{host:'127.0.0.1',port:" + str(port) + ",strictPort:true,proxy:{'/api':{target:" +
    json.dumps(ready['origin']) + ",changeOrigin:true}}}});\nawait server.listen();\n", encoding='utf-8')
log = (output / 'vite-ui.log').open('w', encoding='utf-8')
vite = subprocess.Popen(['node', str(starter)], cwd=repo, stdout=log, stderr=log)
try:
    for _ in range(100):
        with socket.socket() as sock:
            if sock.connect_ex(('127.0.0.1', port)) == 0:
                break
        if vite.poll() is not None:
            raise RuntimeError('隔离 Vite 启动失败，见 vite-ui.log')
        time.sleep(0.1)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')
        context = browser.new_context(viewport={'width':1440, 'height':1000})
        credentials = ready['accounts'][0]
        login = context.request.post(frontend+'/api/auth/login', headers={'X-Fafee-Auth':'1'}, data={'identifier':credentials['username'],'password':credentials['password']})
        assert login.status == 200
        token = login.json()['accessToken']
        auth_headers = {'Authorization':'Bearer '+token}
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(frontend+'/tools/arbitration')
        page.wait_for_load_state('networkidle')
        tasks = context.request.get(frontend+'/api/tasks?productId=labor-arbitration&limit=100', headers=auth_headers).json()['tasks']
        main = next(task for task in tasks if task['threadId']=='http-main-case')
        page.locator('[data-thread-id="http-main-case"]').click()
        expect(page.locator('.arb-report')).to_have_count(3)
        assert page.locator('.arb-answer table').count() == 0
        page.screenshot(path=str(output/'real-ui-restored.png'), full_page=True)
        page.evaluate('localStorage.clear()')
        page.reload()
        page.wait_for_load_state('networkidle')
        page.locator('[data-thread-id="http-main-case"]').click()
        expect(page.locator('.arb-report')).to_have_count(3)
        # Material selection uses real persisted API state.
        page.locator('.arb-materials:not(.arb-sources) summary').click()
        page.get_by_role('button', name='停止使用', exact=True).click()
        expect(page.locator('.arb-materials:not(.arb-sources)')).to_contain_text('已停用')
        page.get_by_role('button', name='恢复使用', exact=True).click()
        expect(page.locator('.arb-materials:not(.arb-sources)')).to_contain_text('正在使用')

        page.get_by_role('button', name='新建案件', exact=True).click()
        expect(page.locator('.arb-welcome-turn')).to_be_visible()
        text = ('劳动仲裁申请书（虚构浏览器测试）\n被申请人：虚构晴川公司；申请人：虚构赵某。履行地杭州。\n'
                '仲裁请求：\n1、支付未签劳动合同二倍工资差额16000元。\n'
                '事实与理由：申请人称2025年1月1日入职，2025年3月1日签约，月薪8000元。\n'
                '企业陈述：是否在入职时签署合同待核实；本轮只上传申请书。')
        page.locator('input[type=file]').set_input_files({'name':'浏览器虚构申请书.txt','mimeType':'text/plain','buffer':text.encode()})
        page.locator('textarea').fill('请从企业侧分析这一项请求，生成待核实的答辩草稿。')
        page.get_by_role('button', name='深度思考', exact=True).click()
        expect(page.get_by_role('button', name='深度思考', exact=True)).to_have_attribute('aria-pressed','false')
        page.get_by_role('button', name='发送', exact=True).click()
        expect(page.locator('textarea')).to_be_enabled()
        expect(page.get_by_role('button', name='停止分析', exact=True)).to_be_enabled()
        # A genuine interrupted request is cancelled before the replacement is queued.
        page.locator('textarea').fill('补充：公司称可能已签署，请只说明需要查找哪些签约证据，不重写完整草稿。')
        page.get_by_role('button', name='停止当前回答并发送', exact=True).click()
        expect(page.locator('.conversation')).to_contain_text('本次回答已停止', timeout=15000)
        page.wait_for_function("document.querySelectorAll('.arb-report').length >= 1 || document.querySelectorAll('.arb-message-error').length > 0", timeout=360000)
        assert page.locator('.arb-message-error').count() == 0, page.locator('.arb-message-error').all_text_contents()
        expect(page.locator('.arb-report')).to_have_count(1, timeout=240000)
        expect(page.locator('.arb-message-error')).to_have_count(0)
        page.screenshot(path=str(output/'real-ui-followup.png'), full_page=True)
        after = context.request.get(frontend+'/api/tasks?productId=labor-arbitration&limit=100', headers=auth_headers).json()['tasks']
        current = next(task for task in after if task['prompt'].startswith('补充：公司称可能已签署'))
        own_thread = current['threadId']
        own_turns = [task for task in after if task['threadId']==own_thread]
        assert len(own_turns) == 2
        assert any(task['status']=='cancelled' and task['result'] is None for task in own_turns)
        assert current['status']=='succeeded'
        full_current=context.request.get(frontend+'/api/tasks/'+current['id'],headers=auth_headers).json()['task']
        assert full_current['result']['defenseDraft']==''
        page.reload()
        page.wait_for_load_state('networkidle')
        page.locator('[data-thread-id='+json.dumps(own_thread)+']').click()
        expect(page.locator('.arb-report')).to_have_count(1)
        # Draft generation button, new version and refresh are exercised against the real worker.
        page.get_by_role('button', name='生成完整答辩意见', exact=True).click()
        page.wait_for_function("document.querySelectorAll('.arb-report').length >= 2 || document.querySelectorAll('.arb-message-error').length > 0", timeout=360000)
        assert page.locator('.arb-message-error').count() == 0, page.locator('.arb-message-error').all_text_contents()
        expect(page.locator('.arb-report')).to_have_count(2, timeout=240000)
        expect(page.locator('.arb-result-actions small').last).to_contain_text('第 1 版')
        page.reload()
        page.wait_for_load_state('networkidle')
        page.locator('[data-thread-id='+json.dumps(own_thread)+']').click()
        expect(page.locator('.arb-report')).to_have_count(2)
        page.set_viewport_size({'width':390,'height':844})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 2')
        page.screenshot(path=str(output/'real-ui-mobile.png'), full_page=True)
        page.set_viewport_size({'width':1440,'height':1000})
        # Expire only the isolated main-case rows. Never operate on server/data/app.db.
        test_db = output/'app-test.db'
        with sqlite3.connect(test_db) as db:
            db.execute('UPDATE tasks SET created_at=? WHERE thread_id=?',('2020-01-01T00:00:00.000Z','http-main-case'))
        page.reload()
        page.wait_for_load_state('networkidle')
        page.locator('[data-thread-id="http-main-case"]').click()
        expect(page.locator('textarea')).to_be_disabled()
        expect(page.locator('.arb-readonly-note')).to_contain_text('到期')
        # Delete the completed synthetic browser case through the real API and verify disappearance.
        thread_url=frontend+'/api/tasks/labor-arbitration/thread/'+own_thread
        deleted=context.request.delete(thread_url,headers=auth_headers)
        assert deleted.status==200 and deleted.json()['deleted']
        assert context.request.get(thread_url,headers=auth_headers).status==404
        page.reload()
        page.wait_for_load_state('networkidle')
        assert page.locator('[data-thread-id='+json.dumps(own_thread)+']').count()==0
        assert errors==[], errors
        browser.close()
        (output/'real-ui-summary.json').write_text(json.dumps({'ok':True,'apiMocks':False,'queue':ready['queue'],
            'checks':['real login','history after cache clear','material disable/restore','upload','interjection/cancel','followup','draft','refresh','mobile','expiry','delete'],'pageErrors':errors},ensure_ascii=False,indent=2),encoding='utf-8')
        print('PASS real UI: auth/upload/queue/live model, interjection, draft, restoration, materials, expiry and deletion')
finally:
    vite.terminate()
    try:
        vite.wait(timeout=10)
    except subprocess.TimeoutExpired:
        vite.kill()
        vite.wait()
    log.close()
