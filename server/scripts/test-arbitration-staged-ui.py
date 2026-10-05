"""Edge UI regression with fictional API responses; no external calls or real data.
Run under webapp-testing/with_server.py or pass an isolated Vite URL.
"""
import argparse
import copy
import json
import re
import tempfile
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--url', required=True)
args = parser.parse_args()
output = Path(tempfile.mkdtemp(prefix='fafee-arbitration-staged-ui-'))
record = {'schemaVersion': 2, 'version': 1, 'taskId': 'analysis-one', 'materialSignature': 'files-one',
          'requests': [{'id': 'request-one', 'text': '支付工资差额800元', 'sources': [{'sourceId': 'file:one', 'sourceName': '虚构申请书.txt', 'fileId': 'one', 'located': True, 'line': 5, 'quote': '支付工资差额800元'}]}],
          'facts': [{'id': 'fact-one', 'text': '申请人主张工资差额', 'kind': 'applicant_statement', 'sources': []}],
          'sources': [{'kind': 'document', 'fileId': 'one'}]}
analysis = {'schemaVersion': 2, 'kind': 'analysis', 'conversationTitle': '工资差额争议', 'answer': '先核对请求与企业付款记录。',
            'overallRisk': 'unknown', 'riskBasis': ['尚待核实支付情况'], 'claims': [{'requestId': 'request-one', 'claim': '支付工资差额800元', 'companyPosition': '金额待核实', 'riskLevel': 'unknown', 'reasoning': '申请人单方主张，企业未确认金额。'}],
            'followUpQuestions': ['是否有付款记录？'], 'defenseDraft': '', 'caseRecord': record, 'analysisVersion': 1, 'analysisTaskId': 'analysis-one',
            'usage': {'prompt_tokens': 500000}, 'contextUsage': {'promptTokens': 10000, 'capacity': 1000000}}
tasks, posts, cancellations = {}, [], []
hold = False
materials = [{'id': 'one', 'sourceTaskId': 'analysis-one', 'name': '虚构申请书.txt', 'enabled': True, 'available': True, 'originalAvailable': True}]

def field(raw, name):
    found = re.search(r'name="' + name + r'"\r\n\r\n([^\r]*)', raw)
    return found.group(1) if found else ''

def api(route):
    global hold
    path = urlparse(route.request.url).path
    if path == '/api/auth/refresh': body = {'accessToken': 'synthetic-token', 'accessTokenExpiresAt': '2099-01-01'}
    elif path == '/api/auth/me': body = {'user': {'id': 'synthetic-staged', 'username': 'Demo'}}
    elif path == '/api/tasks/labor-arbitration':
        raw = route.request.post_data_buffer.decode('utf-8', errors='replace')
        posts.append(raw)
        result = copy.deepcopy(analysis)
        message = field(raw, 'message')
        if field(raw, 'action') == 'draft' or '草稿' in message:
            result.update(kind='draft', defenseDraft='### 劳动人事争议仲裁答辩意见书\n\n答辩人：【待补充】\n\n#### 关于工资差额请求\n\n**答辩结论**：金额待核实，企业承诺待企业确认。\n\n**答辩建议**：补充付款记录。\n\n**法条依据**：待核对。\n\n**具体分析**：拟补充证据不等于已提交。\n\n此致【待补充】', draftBasis={'caseVersion': 1, 'materialSignature': 'files-one'})
        elif '补充' in message:
            result['caseRecord']['version'] = 2
            result['analysisVersion'] = 2
            result['changes'] = {'message': '已更新工资差额分析。'}
        task_id = 'task-' + str(len(posts))
        task = {'id': task_id, 'userId': 'synthetic-staged', 'productId': 'labor-arbitration', 'threadId': field(raw, 'threadId'), 'title': '工资差额争议', 'createdAt': '2026-10-04T00:00:00Z', 'prompt': message, 'status': 'running' if hold else 'succeeded', 'result': result, 'files': [], 'resultExpiresAt': '2099-01-01', 'retentionPolicy': {'sourceRetentionDays': 90, 'sessionRetentionDays': 365}}
        hold = False
        tasks[task_id] = task
        route.fulfill(status=202, json={'taskId': task_id, 'task': task})
        return
    elif path == '/api/tasks': body = {'tasks': list(reversed(list(tasks.values())))}
    elif '/thread/' in path:
        thread = path.split('/thread/')[1].split('/')[0]
        if path.endswith('/materials') and route.request.method == 'PATCH':
            data = route.request.post_data_json
            materials[0]['enabled'] = data['enabled']
        body = {'tasks': [task for task in tasks.values() if task['threadId'] == thread], 'materials': materials}
    elif path.endswith('/cancel'):
        task_id = path.split('/')[-2]
        tasks[task_id].update(status='cancelled', result=None)
        cancellations.append(task_id)
        body = {'task': tasks[task_id]}
    elif path.endswith('/events'):
        route.fulfill(status=200, content_type='text/event-stream', body='event: arbitration.progress\ndata: {"label":"正在分析…","_seq":1}\n\n')
        return
    elif path.startswith('/api/tasks/task-'): body = {'task': tasks[path.rsplit('/', 1)[-1]]}
    else: body = {}
    route.fulfill(status=200, json=body)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')
    context = browser.new_context(viewport={'width': 1440, 'height': 1000}, permissions=['clipboard-read', 'clipboard-write'])
    context.route('**/api/**', api)
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(args.url + '/tools/arbitration')
    page.wait_for_load_state('networkidle')
    expect(page.locator('.arb-welcome-turn')).to_contain_text('直接要求生成')
    page.locator('textarea').fill('公司收到虚构申请书，先分析。')
    page.get_by_role('button', name='发送', exact=True).click()
    expect(page.locator('.arb-report')).to_have_count(1)
    assert page.get_by_role('button', name='复制答辩意见', exact=True).count() == 0
    page.get_by_text('查看材料依据', exact=True).click()
    expect(page.locator('.arb-sources')).to_contain_text('虚构申请书.txt · 第5行')
    expect(page.locator('.arb-sources')).to_contain_text('申请人主张')
    page.get_by_role('button', name='生成完整答辩意见', exact=True).click()
    expect(page.locator('.arb-report')).to_have_count(2)
    expect(page.get_by_role('button', name='复制答辩意见', exact=True)).to_be_visible()
    page.get_by_role('button', name='复制答辩意见', exact=True).click()
    expect(page.get_by_role('button', name='已复制', exact=True)).to_be_visible()
    page.locator('textarea').fill('补充：已有付款记录，金额待核对。')
    page.get_by_role('button', name='发送', exact=True).click()
    expect(page.locator('.arb-report')).to_have_count(3)
    expect(page.locator('.arb-report').nth(1)).to_contain_text('建议生成新版本')
    page.reload()
    page.wait_for_load_state('networkidle')
    expect(page.locator('.arb-report')).to_have_count(3)
    expect(page.locator('.arb-report').nth(1)).to_contain_text('建议生成新版本')
    assert len(posts) == 3
    assert page.locator('.arb-answer table').count() == 0
    page.locator('.tool-context-trigger').click()
    expect(page.locator('.tool-context-popover')).to_contain_text('10K / 1M')
    page.locator('.tool-context-trigger').click()
    expect(page.locator('.chat-sidebar')).not_to_contain_text('原件保存')
    expect(page.locator('.chat-sidebar')).not_to_contain_text('最后提交后保存')
    hold = True
    page.locator('textarea').fill('开始下一轮分析。')
    page.get_by_role('button', name='发送', exact=True).click()
    expect(page.get_by_role('button', name='停止分析', exact=True)).to_be_enabled()
    page.locator('textarea').fill('先出草稿')
    page.get_by_role('button', name='停止当前回答并发送', exact=True).click()
    expect(page.locator('.arb-report')).to_have_count(4)
    assert cancellations == ['task-4']
    assert len(posts) == 5
    page.screenshot(path=str(output / 'desktop.png'), full_page=True)
    page.set_viewport_size({'width': 390, 'height': 844})
    assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1')
    page.screenshot(path=str(output / 'mobile.png'), full_page=True)
    assert not errors, errors
    browser.close()
print('PASS staged UI: first analysis, skip/generate, citations, copy, new-material stale version, refresh, interruption, 390px; mocked API. ' + str(output))
