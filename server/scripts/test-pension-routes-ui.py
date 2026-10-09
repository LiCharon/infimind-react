"""Verify actual pension App routes with fictional authentication and parameters.

python server/scripts/test-pension-routes-ui.py [--output <directory>]
Uses an isolated source snapshot; never accesses a live account or backend.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import expect, sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('--output')
args = parser.parse_args()
repo = Path(__file__).resolve().parents[2]
output = Path(args.output) if args.output else Path(tempfile.mkdtemp(prefix='pension-route-ui-'))
output.mkdir(parents=True, exist_ok=True)
report_path = output / 'pension-route-verification.json'
report_path.write_text(json.dumps({'status': 'running'}, indent=2), encoding='utf-8')
checks, page_errors, unexpected_api, external_requests, http_failures, requests = [], [], [], [], [], []
state = {'authenticated': False}
fixture_user = {'id': 'fictional-pension-user', 'username': 'pension-review', 'email': 'review@example.invalid'}
fixture = {
    'recordMonth': '2025-12',
    'gender': 'male', 'currentAge': '59', 'retirementAge': '60', 'actualYears': '19',
    'deemedYears': '0', 'pastAvgIndex': '100', 'accountBalance': '90000', 'localAvgWage': '8000',
    'wageGrowth': '0', 'accountInterest': '0', 'currentMonthlyWage': '8000', 'futureWageGrowth': '0', 'grade': '100'
}


def check(name, condition=True):
    if not condition:
        raise AssertionError(name)
    checks.append(name)


def fill_fixture(page):
    for name, value in fixture.items():
        control = page.locator(f'[name="{name}"]')
        if not control.count():
            continue
        if control.evaluate('(element) => element.tagName') == 'SELECT':
            control.select_option(value)
        else:
            control.fill(value)


server = subprocess.Popen(['node', str(repo / 'server/scripts/serve-medical-period-review.js'), '--app'],
                          cwd=repo, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                          text=True, encoding='utf-8', creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
try:
    url, root = None, None
    for line in server.stdout:
        if line.strip().startswith('{'):
            ready = json.loads(line)
            if ready.get('type') == 'medical-review-ready':
                url, root = ready['url'], Path(ready['root'])
                break
    if not url:
        raise RuntimeError('Isolated actual App did not start.')

    def mock_api(route):
        path = urlparse(route.request.url).path
        requests.append(path)
        token = {'accessToken': 'fictional-test-token', 'accessTokenExpiresAt': '2030-01-01T00:00:00.000Z', 'user': fixture_user}
        if path in ['/api/auth/refresh', '/api/auth/me']:
            value = ({'user': fixture_user} if path.endswith('/me') else token) if state['authenticated'] else {'error': 'Not logged in'}
            route.fulfill(status=200 if state['authenticated'] else 401, json=value)
        elif path == '/api/auth/login':
            state['authenticated'] = True
            route.fulfill(status=200, json=token)
        elif path == '/api/auth/logout':
            state['authenticated'] = False
            route.fulfill(status=200, json={'ok': True})
        else:
            unexpected_api.append(path)
            route.fulfill(status=500, json={'error': 'Unexpected test API'})

    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=os.environ.get('PENSION_TEST_BROWSER', r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'), headless=True)
        context = browser.new_context(viewport={'width': 1440, 'height': 1000}, reduced_motion='reduce')
        context.route('**/*', lambda route: route.continue_() if route.request.url.startswith(url) else
                      (external_requests.append(route.request.url), route.abort()))
        context.route('**/api/**', mock_api)
        page = context.new_page()
        page.on('pageerror', lambda error: page_errors.append(str(error)))
        page.on('response', lambda response: http_failures.append(f'{response.status} {response.url}')
                if response.status >= 400 and response.status != 401 else None)
        for product in ['pension-calc1', 'pension-calc2']:
            target = f'/tools/{product}?from=review'
            page.goto(url + target, wait_until='networkidle')
            expect(page.get_by_role('button', name='登录并继续', exact=True)).to_be_visible()
            check(f'{product}: anonymous redirect preserves target',
                  urlparse(page.url).path == '/auth' and parse_qs(urlparse(page.url).query)['redirect'] == [target])
            check(f'{product}: form protected', page.locator('.pension-calculation-page').count() == 0)
        page.get_by_placeholder('请输入用户名或邮箱').fill('pension-review')
        page.get_by_placeholder('请输入密码').fill('fictional-password-123')
        page.get_by_role('button', name='登录并继续', exact=True).click()
        expect(page.locator('.pension-calculation-page')).to_be_visible()
        check('login resumes flexible pension route and query',
              urlparse(page.url).path == '/tools/pension-calc2' and parse_qs(urlparse(page.url).query)['from'] == ['review'])
        for product, title in [('pension-calc2', '个体工商户／灵活就业者养老保险测算'), ('pension-calc1', '企业职工养老保险测算')]:
            if product == 'pension-calc1':
                page.get_by_role('link', name='企业职工养老', exact=True).click()
            expect(page.locator('.chat-title')).to_contain_text(title)
            check(f'{product}: empty simple form and no chat', page.locator('[name="currentAge"]').input_value() == '' and page.locator('.prototype-chat,textarea,.composer').count() == 0)
            check(f'{product}: sidebar uses shared brand and account styles', page.locator('.chat-sidebar .sidebar-brand').is_visible() and page.locator('.account-trigger').is_visible())
            check(f'{product}: professional policy selectors removed', page.locator('[name="region"],[name="indexMethod"],[name="policyFrom"]').count() == 0)
            fill_fixture(page)
            before = len(requests)
            page.locator('button[type="submit"]').click()
            expect(page.get_by_test_id('pension-total')).to_have_text('2,302.73元／月')
            check(f'{product}: actual App matches independently calculated fixture', len(requests) == before)
            page.get_by_test_id('pension-result').scroll_into_view_if_needed()
            page.screenshot(path=str(output / f'{product}-protected-result.png'))
            page.locator('[name="accountBalance"]').fill('100000')
            expect(page.get_by_test_id('pension-result')).to_have_count(0)
            check(f'{product}: edit clears old result', page.get_by_role('button', name='重新计算', exact=True).is_visible())
            page.locator('button[type="submit"]').click()
            expect(page.get_by_test_id('pension-total')).not_to_have_text('2,302.73元／月')
            check(f'{product}: recalculation updates total')
            expect(page.locator('.pension-history-row')).to_have_count(1)
            check(f'{product}: recalculation updates active record without duplicates')
            page.reload(wait_until='networkidle')
            expect(page.locator('.pension-calculation-page')).to_be_visible()
            check(f'{product}: refresh preserves history and starts empty form', page.locator('[name="currentAge"]').input_value() == '' and page.locator('.pension-history-row').count() == 1)
            page.locator('.pension-history-row > button:first-child').click()
            expect(page.get_by_test_id('pension-total')).to_have_text('2,374.68元／月')
            check(f'{product}: history restores conditions and result', page.locator('[name="accountBalance"]').input_value() == '100000')
            page.get_by_role('button', name='新建测算', exact=True).click()
            expect(page.get_by_test_id('pension-result')).to_have_count(0)
            check(f'{product}: new calculation resets input but preserves saved record', page.locator('[name="currentAge"]').input_value() == '' and page.locator('.pension-history-row').count() == 1)
        # Storage quota failures must not turn a successfully calculated result
        # into an error, or overwrite the previous saved input snapshot.
        fill_fixture(page)
        page.evaluate("() => { window.__pensionSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key.endsWith(':calculations')) throw new DOMException('test quota', 'QuotaExceededError'); return window.__pensionSetItem.call(this, key, value) } }")
        page.locator('button[type="submit"]').click()
        expect(page.get_by_test_id('pension-total')).to_have_text('2,302.73元／月')
        expect(page.get_by_role('status').filter(has_text='未能保存')).to_be_visible()
        check('storage quota failure preserves visible calculation and reports save failure')
        page.evaluate('() => { Storage.prototype.setItem = window.__pensionSetItem }')
        page.reload(wait_until='networkidle')
        expect(page.locator('.pension-history-row')).to_have_count(1)
        page.locator('.pension-history-row > button:first-child').click()
        expect(page.get_by_test_id('pension-total')).to_have_text('2,374.68元／月')
        check('failed save leaves prior persisted record intact')
        page.get_by_role('link', name='工具总览', exact=True).click()
        expect(page.get_by_role('heading', name='今天要处理什么？', exact=True)).to_be_visible()
        check('flexible hub entry names pension insurance explicitly', '个体工商户／灵活就业者养老保险测算' in page.locator('a[href="/tools/pension-calc2"]').inner_text())
        for product in ['pension-calc1', 'pension-calc2']:
            page.locator(f'a[href="/tools/{product}"]').click()
            expect(page.locator('.pension-calculation-page')).to_be_visible()
            check(f'hub {product} opens dedicated form')
            page.get_by_role('link', name='工具总览', exact=True).click()
        page.locator('a[href="/tools/medical-calculator"]').click()
        expect(page.locator('.medical-calculator')).to_be_visible()
        check('medical entry retains independent medical page', page.locator('.pension-calculation-page').count() == 0)
        page.goto(f'{url}/tools/handbook', wait_until='networkidle')
        expect(page.locator('.prototype-chat-header')).to_be_visible()
        check('generic protected tool route retains existing fallback', page.locator('.pension-calculation-page,.medical-calculator').count() == 0)
        page.goto(f'{url}/tools/fictional-unmapped-tool', wait_until='networkidle')
        expect(page.get_by_role('heading', name='今天要处理什么？', exact=True)).to_be_visible()
        check('unknown tool still redirects to hub', urlparse(page.url).path == '/tools')
        page.goto(f'{url}/tools', wait_until='networkidle')
        page.get_by_role('button', name='退出登录', exact=True).click()
        expect(page.get_by_role('button', name='登录并继续', exact=True)).to_be_visible()
        for product in ['pension-calc1', 'pension-calc2']:
            page.goto(f'{url}/tools/{product}', wait_until='networkidle')
            expect(page.get_by_role('button', name='登录并继续', exact=True)).to_be_visible()
            check(f'logout protects {product} again', page.locator('.pension-calculation-page').count() == 0)
        fixture_user['id'] = 'fictional-pension-other-user'
        fixture_user['username'] = 'another-review-user'
        page.get_by_placeholder('请输入用户名或邮箱').fill('another-review-user')
        page.get_by_placeholder('请输入密码').fill('fictional-password-456')
        page.get_by_role('button', name='登录并继续', exact=True).click()
        expect(page.locator('.pension-calculation-page')).to_be_visible()
        check('second account cannot see flexible history from first account', page.locator('.pension-history-row').count() == 0)
        page.get_by_role('link', name='企业职工养老', exact=True).click()
        expect(page.locator('[name="currentMonthlyWage"]')).to_be_visible()
        check('second account cannot see employee history or input', page.locator('.pension-history-row').count() == 0 and page.locator('[name="accountBalance"]').input_value() == '')
        check('no unexpected API requests', not unexpected_api)
        check('no external resources requested', not external_requests)
        check('no unexpected HTTP failures', not http_failures)
        check('no browser exceptions', not page_errors)
        browser.close()
    names = ['src/App.jsx', 'src/pages/ToolHubPage.jsx', 'src/pages/PensionCalculationPage.jsx', 'src/pages/PensionCalculationPage.css',
             'src/utils/pension-calculator.js', 'src/utils/pension-retirement.js', 'src/utils/pension-rules.js', 'src/utils/pension-history.js']
    report = {'status': 'passed', 'checks': len(checks), 'cases': checks, 'pageErrors': page_errors,
              'unexpectedApi': unexpected_api, 'externalRequests': external_requests, 'httpFailures': http_failures,
              'sourceFilesSHA256': {name: hashlib.sha256((root / name).read_bytes()).hexdigest() for name in names},
              'scope': 'actual App and AuthProvider with fictional authentication and parameters; not live backend or policy acceptance'}
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'status': 'passed', 'checks': len(checks), 'output': str(output)}, ensure_ascii=False))
except Exception as error:
    report_path.write_text(json.dumps({'status': 'failed', 'cases': checks, 'error': str(error),
                                     'pageErrors': page_errors, 'unexpectedApi': unexpected_api,
                                     'externalRequests': external_requests}, ensure_ascii=False, indent=2), encoding='utf-8')
    raise
finally:
    server.terminate()
    server.wait(timeout=20)
