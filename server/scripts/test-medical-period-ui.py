"""Actual React page tests, fictional records, isolated localhost Vite.

Run: python server/scripts/test-medical-period-ui.py
Optional: --url <isolated review URL> --output <local evidence directory>
Uses existing Python Playwright and installed Edge; installs nothing.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile

from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--url')
parser.add_argument('--output')
args = parser.parse_args()
repo = Path(__file__).resolve().parents[2]
output = Path(args.output) if args.output else Path(tempfile.mkdtemp(prefix='fafee-medical-ui-'))
output.mkdir(parents=True, exist_ok=True)
checks = []
errors = []
external_requests = []
api_requests = []
http_failures = []
server = None
review_root = None


def check(name, condition=True):
    if not condition:
        raise AssertionError(name)
    checks.append(name)


def fill(page, name, value):
    if not page.locator(f'[name="{name}"]').is_visible():
        reveal_supplementary(page)
    page.locator(f'[name="{name}"]').fill(value)


def reveal_supplementary(page):
    details = page.locator('.mp-supplementary')
    if details.get_attribute('open') is None:
        details.locator(':scope > summary').click()


def national(page):
    page.locator('[name="region"]').select_option('national')
    fill(page, 'locality', '杭州')
    fill(page, 'asOf', '2026-03-31')
    fill(page, 'hireDate', '2022-05-07')
    fill(page, 'totalWorkYears', '8')
    fill(page, 'tenYearDate', '2028-05-01')
    fill(page, 'segments.0.startDate', '2026-01-01')
    fill(page, 'segments.0.endDate', '2026-03-31')
    page.locator('[name="historyComplete"]').check()


def shanghai(page, workdays='8'):
    page.locator('[name="region"]').select_option('shanghai')
    page.get_by_role('button', name='填写实际日期段', exact=True).click()
    fill(page, 'asOf', '2026-06-30')
    fill(page, 'hireDate', '2024-09-01')
    fill(page, 'segments.0.startDate', '2026-06-01')
    fill(page, 'segments.0.endDate', '2026-06-10')
    fill(page, 'segments.0.workDays', workdays)
    reveal_supplementary(page)
    page.locator('[name="historyComplete"]').check()


def reset(page):
    page.get_by_role('button', name='新建测算', exact=True).click()
    dialog = page.get_by_role('dialog')
    if dialog.is_visible():
        dialog.get_by_role('button', name='清空条件', exact=True).click()


try:
    url = args.url
    if not url:
        server = subprocess.Popen(['node', str(repo / 'server/scripts/serve-medical-period-review.js')],
                                  cwd=repo, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                  text=True, encoding='utf-8', creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        for line in server.stdout:
            if line.strip().startswith('{'):
                ready = json.loads(line)
                if ready.get('type') == 'medical-review-ready':
                    url = ready['url']
                    review_root = Path(ready['root'])
                    check('isolated server ready')
                    break
        if not url:
            raise RuntimeError('Isolated review server did not start.')
    with sync_playwright() as p:
        edge = os.environ.get('MEDICAL_TEST_BROWSER', r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe')
        browser = p.chromium.launch(executable_path=edge, headless=True)
        context = browser.new_context(viewport={'width': 1440, 'height': 1000}, reduced_motion='reduce')
        context.add_init_script("""Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {
          writeText: async text => { window.__medicalCopied = text }
        }})""")
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('console', lambda message: errors.append(message.text) if message.type == 'error' else None)
        page.on('request', lambda request: external_requests.append(request.url)
                if request.url.startswith(('http:', 'https:')) and not request.url.startswith(url) else None)
        page.on('request', lambda request: api_requests.append(request.url) if '/api/' in request.url else None)
        page.on('response', lambda response: http_failures.append(f'{response.status} {response.url}') if response.status >= 400 else None)
        page.goto(url, wait_until='networkidle')
        expect(page.get_by_role('heading', name='测算条件', exact=True)).to_be_visible()
        check('actual React page renders with empty region', page.locator('[name="region"]').input_value() == '')
        check('no chat composer or model controls', page.locator('.composer,.composer-wrap,[name="tool-input"]').count() == 0)
        check('empty result not fabricated', page.locator('.mp-result').count() == 0)
        page.screenshot(path=str(output / 'desktop-empty.png'))
        page.get_by_role('button', name='开始测算', exact=True).click()
        expect(page.get_by_role('alert')).to_contain_text('输入已保留')
        expect(page.locator('[name="region"]')).to_be_focused()
        check('blank form validation and first-field focus')
        check('validation produces no result or history', page.locator('.mp-result').count() == 0 and page.locator('.mp-history-list > .mp-history-row > button:first-child').count() == 0)

        reset(page)
        page.locator('[name="region"]').select_option('shanghai')
        check('Shanghai exposes necessary first date and history confirmation', page.locator('form .mp-field input:visible').count() == 4 and page.locator('[name="summary.firstDate"]').is_visible() and page.locator('[name="historyComplete"]').is_visible())
        fill(page, 'hireDate', '2024-09-01')
        fill(page, 'asOf', '2026-06-30')
        fill(page, 'summary.workDays', '8')
        page.screenshot(path=str(output / 'desktop-shanghai-simple-form.png'))
        for width in [390, 320]:
            page.set_viewport_size({'width': width, 'height': 900})
            check(f'Shanghai simple form at {width} has no horizontal overflow', page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
        page.screenshot(path=str(output / 'narrow-shanghai-simple-form.png'))
        page.set_viewport_size({'width': 1440, 'height': 1000})
        page.get_by_role('button', name='开始测算', exact=True).click()
        expect(page.get_by_role('alert')).to_contain_text('需要填写首个病休日')
        check('full Shanghai calculation cannot omit first date and history confirmation', page.locator('.mp-result').count() == 0)
        page.get_by_role('button', name='仅核对基础额度', exact=True).click()
        check('Shanghai simple summary computes without invented intervals or natural days', page.locator('table').count() == 0 and '8' in page.locator('.mp-metrics').inner_text() and '工作日' in page.locator('.mp-metrics').inner_text() and 'null' not in page.locator('.mp-result').inner_text())
        check('missing first date yields labelled as-of reference and pending balance', '计算截止日2026-06-30' in page.locator('.mp-metrics').inner_text() and ('还需补充' in page.locator('.mp-assessment').inner_text() or '需人工核对' in page.locator('.mp-assessment').inner_text()) and '尚未提供首个病休日' in page.locator('.mp-assessment').inner_text())
        check('maturity date is no longer a standalone result field', '届满日期' not in page.locator('.mp-result-facts').inner_text())
        page.get_by_role('button', name='修改条件', exact=True).click()
        fill(page, 'summary.firstDate', '2026-06-01')
        page.locator('[name="historyComplete"]').check()
        page.screenshot(path=str(output / 'desktop-shanghai-complete-form.png'))
        page.get_by_role('button', name='重新计算', exact=True).click()
        expect(page.locator('.mp-metrics')).to_contain_text('2.61')
        page.screenshot(path=str(output / 'desktop-shanghai-saved-result.png'))
        check('supplementary first date and complete history enable reference balance without natural-day input')
        reset(page)
        page.locator('[name="region"]').select_option('national')
        check('national defaults to exactly four visible input fields', page.locator('form .mp-field input:visible').count() == 4 and page.locator('[name="asOf"]').is_hidden() and page.locator('[name="tenYearDate"]').is_hidden())
        fill(page, 'hireDate', '2022-05-07')
        fill(page, 'totalWorkYears', '8')
        fill(page, 'segments.0.startDate', '2026-01-01')
        fill(page, 'segments.0.endDate', '2026-03-31')
        page.screenshot(path=str(output / 'desktop-national-simple-form.png'))
        page.get_by_role('button', name='开始测算', exact=True).click()
        expect(page.locator('.mp-metrics')).to_contain_text('90')
        check('national four-field flow derives cutoff from actual end date', '截止 2026-03-31' in page.locator('.mp-result').inner_text())
        page.get_by_role('button', name='复制测算单', exact=True).click()
        check('derived cutoff is included in copied receipt', '统计截止日：2026-03-31' in page.evaluate('window.__medicalCopied'))
        page.get_by_role('textbox', name='搜索历史测算', exact=True).fill('2026-03-31')
        check('derived cutoff is searchable in page history', page.locator('.mp-history-list > .mp-history-row > button:first-child').count() == 1)
        page.get_by_role('textbox', name='搜索历史测算', exact=True).fill('')
        page.get_by_role('button', name='修改条件', exact=True).click()
        fill(page, 'tenYearDate', '2020-01-01')
        page.locator('.mp-supplementary > summary').click()
        page.get_by_role('button', name='重新计算', exact=True).click()
        expect(page.locator('[name="tenYearDate"]')).to_be_focused()
        check('invalid supplementary value expands its section and receives focus', page.locator('.mp-supplementary').get_attribute('open') is not None)
        # Clear only this fictional test account's data before the original cases.
        page.evaluate("localStorage.removeItem('fafee-history-v2:fictional-medical-review-user:medical-calculator:calculations')")
        page.reload(wait_until='networkidle')
        national(page)
        page.get_by_role('button', name='开始测算', exact=True).click()
        expect(page.locator('.mp-metrics')).to_contain_text('90')
        check('A1 national quota and natural-day record', '3个月' in page.locator('.mp-metrics').inner_text().replace('\n', ''))
        check('successful form collapses to summary', page.locator('form').is_hidden())
        check('national reference arithmetic is explicitly separated from legal balance', '累计统计范围' in page.locator('.mp-metrics').inner_text() and page.locator('.mp-reference-trial').get_attribute('open') is None and page.locator('.mp-estimate-note').is_hidden())
        check('calculation process and dated record table visible', page.get_by_role('heading', name='计算过程', exact=True).is_visible() and page.locator('tbody tr').count() == 1)
        page.screenshot(path=str(output / 'desktop-national-result.png'))
        page.get_by_role('button', name='复制测算单', exact=True).click()
        expect(page.get_by_role('status')).to_contain_text('已复制')
        receipt = page.evaluate('window.__medicalCopied')
        check('copied receipt carries original dates and uncertainties', all(text in receipt for text in ['2022-05-07', '2026-03-31', '90', '待核对事项', 'https://']))
        page.get_by_role('button', name='修改条件', exact=True).click()
        fill(page, 'asOf', '2026-06-30')
        expect(page.get_by_role('button', name='复制测算单', exact=True)).to_be_disabled()
        expect(page.get_by_role('button', name='重新计算', exact=True)).to_be_visible()
        check('edited result retains old snapshot and marks stale', '2026-03-31' in page.locator('.mp-result').inner_text() and page.locator('.mp-result-stale').count() == 1)
        page.locator('.mp-result').scroll_into_view_if_needed()
        page.screenshot(path=str(output / 'desktop-stale.png'))
        fill(page, 'segments.0.endDate', '2026-01-01')
        page.get_by_role('button', name='重新计算', exact=True).click()
        expect(page.locator('.mp-metrics')).to_contain_text('1')
        check('recalculation clears stale state, stores a new immutable page record', page.locator('.mp-result-stale').count() == 0 and page.locator('.mp-history-list > .mp-history-row > button:first-child').count() == 2)
        page.locator('.mp-history-list > .mp-history-row > button:first-child').nth(1).click()
        expect(page.locator('.mp-metrics')).to_contain_text('90')
        check('restoring previous snapshot restores parameters together', page.locator('[name="asOf"]').input_value() == '2026-03-31')
        page.get_by_role('textbox', name='搜索历史测算', exact=True).fill('不存在的地区')
        check('history search empty state', page.locator('.mp-history-list').inner_text() == '没有匹配的历史记录。')
        page.get_by_role('textbox', name='搜索历史测算', exact=True).fill('')
        page.get_by_role('button', name='新建测算', exact=True).click()
        page.get_by_role('dialog').get_by_role('button', name='取消', exact=True).click()
        check('cancel reset preserves current result', page.locator('.mp-result').count() == 1)
        reset(page)
        check('confirmed reset clears current data, retains page records', page.locator('.mp-result').count() == 0 and page.locator('.mp-history-list > .mp-history-row > button:first-child').count() == 2)

        national(page)
        page.get_by_role('button', name='非连续分段', exact=True).click()
        fill(page, 'segments.0.startDate', '2026-01-05')
        fill(page, 'segments.0.endDate', '2026-01-14')
        page.get_by_role('button', name='添加一段病休', exact=True).click()
        fill(page, 'segments.1.startDate', '2026-01-10')
        fill(page, 'segments.1.endDate', '2026-01-20')
        page.get_by_role('button', name='开始测算', exact=True).click()
        expect(page.get_by_role('alert')).to_contain_text('重叠')
        check('overlap blocks result, points at original second row', page.locator('.mp-result').count() == 0 and page.locator('[name="segments.1.startDate"]').get_attribute('aria-invalid') == 'true')
        check('overlap preserves both segments', page.locator('[name="segments.1.startDate"]').input_value() == '2026-01-10')
        page.screenshot(path=str(output / 'desktop-overlap.png'))
        check('continuous switch cannot silently discard multiple rows', page.get_by_role('button', name='连续病休', exact=True).is_disabled())
        fill(page, 'segments.1.startDate', '2026-02-02')
        fill(page, 'segments.1.endDate', '2026-02-09')
        page.get_by_role('button', name='添加一段病休', exact=True).click()
        fill(page, 'segments.2.startDate', '2026-03-16')
        fill(page, 'segments.2.endDate', '2026-03-20')
        page.get_by_role('button', name='开始测算', exact=True).click()
        expect(page.locator('.mp-metrics')).to_contain_text('23')
        check('A2 segmented counts with gaps excluded', page.locator('tbody tr').count() == 3 and '34天' in page.locator('tbody').inner_text())
        page.screenshot(path=str(output / 'desktop-segmented-result.png'))
        page.get_by_role('button', name='修改条件', exact=True).click()
        page.get_by_role('button', name='移除第3段病休', exact=True).click()
        check('remove segment updates draft and invalidates old result', page.locator('.mp-segment').count() == 2 and page.locator('.mp-result-stale').count() == 1)
        reset(page)

        shanghai(page)
        check('Shanghai national-only fields hidden', page.locator('[name="totalWorkYears"]').count() == 0 and page.locator('[name="tenYearDate"]').count() == 0)
        page.get_by_role('button', name='开始测算', exact=True).click()
        expect(page.locator('.mp-metrics')).to_contain_text('2.61')
        check('A3 actual 20.67 workday balance, not wage or old constant', '0.39' in page.locator('.mp-result').inner_text() and '20.67' in page.locator('.mp-result').inner_text())
        check('Shanghai table preserves supplied workdays', '8天' in page.locator('tbody').inner_text())
        page.screenshot(path=str(output / 'desktop-shanghai-result.png'))
        page.get_by_role('button', name='修改条件', exact=True).click()
        fill(page, 'segments.0.workDays', '')
        page.get_by_role('button', name='重新计算', exact=True).click()
        expect(page.get_by_role('alert')).to_contain_text('实际病休工作日')
        check('full Shanghai balance calculation cannot omit actual workdays')
        page.get_by_role('button', name='仅核对基础额度', exact=True).click()
        check('missing Shanghai workdays do not become zero', ('还需补充' in page.locator('.mp-assessment').inner_text() or '需人工核对' in page.locator('.mp-assessment').inner_text()) and '未知' in page.locator('tbody').inner_text())
        page.get_by_role('button', name='修改条件', exact=True).click()
        fill(page, 'segments.0.workDays', '0.5')
        page.locator('[name="historyComplete"]').uncheck()
        page.get_by_role('button', name='重新计算', exact=True).click()
        expect(page.get_by_role('alert')).to_contain_text('确认已提供本单位期间')
        check('balance calculation requires an explicit complete-history confirmation')
        page.get_by_role('button', name='仅核对基础额度', exact=True).click()
        check('fractional workdays retained, incomplete history blocks balance', '0.5天' in page.locator('tbody').inner_text() and ('还需补充' in page.locator('.mp-assessment').inner_text() or '需人工核对' in page.locator('.mp-assessment').inner_text()))
        reset(page)

        national(page)
        page.get_by_role('button', name='只有首日与累计量', exact=True).click()
        fill(page, 'summary.firstDate', '2026-01-05')
        fill(page, 'summary.naturalDays', '23')
        page.get_by_role('button', name='开始测算', exact=True).click()
        check('A12 summary counts without a fictional table/end date', page.locator('table').count() == 0 and '23' in page.locator('.mp-metrics').inner_text() and '日期分布未知' in page.locator('.mp-result').inner_text())
        page.screenshot(path=str(output / 'desktop-summary-result.png'))
        page.get_by_role('button', name='修改条件', exact=True).click()
        page.get_by_role('button', name='有实际日期段', exact=True).click()
        check('switching recording mode preserves hidden date draft', page.locator('[name="segments.0.endDate"]').input_value() == '2026-03-31')
        fill(page, 'tenYearDate', '2020-01-01')
        page.get_by_role('button', name='重新计算', exact=True).click()
        expect(page.get_by_role('alert')).to_contain_text('矛盾')
        check('contradictory tenure date blocks recalculation without clearing input', page.locator('[name="tenYearDate"]').input_value() == '2020-01-01')
        reset(page)

        shanghai(page)
        page.locator('.mp-exceptions summary').click()
        page.locator('[name="specialCircumstances"]').check()
        fill(page, 'specialNote', '需要核对更长约定')
        page.get_by_role('button', name='开始测算', exact=True).click()
        check('special case blocks reference balance and explains review', ('还需补充' in page.locator('.mp-assessment').inner_text() or '需人工核对' in page.locator('.mp-assessment').inner_text()) and '延长审批' in page.locator('.mp-assessment').inner_text())
        reset(page)
        page.locator('[name="region"]').select_option('national')
        fill(page, 'asOf', '2026-06-30')
        fill(page, 'hireDate', '2024-09-01')
        fill(page, 'totalWorkYears', '8')
        fill(page, 'segments.0.startDate', '2026-06-01')
        fill(page, 'segments.0.endDate', '2026-06-10')
        page.get_by_role('button', name='开始测算', exact=True).click()
        check('national baseline counts records and leaves unresolved local balance unknown', '10' in page.locator('.mp-metrics').inner_text() and ('还需补充' in page.locator('.mp-assessment').inner_text() or '需人工核对' in page.locator('.mp-assessment').inner_text()))

        for width in [1440, 1024, 768, 390, 320]:
            page.set_viewport_size({'width': width, 'height': 900})
            check(f'result viewport {width} has no outer horizontal overflow', page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
        page.screenshot(path=str(output / 'narrow-result.png'))
        page.get_by_role('button', name='切换测算记录栏', exact=True).click()
        expect(page.get_by_role('textbox', name='搜索历史测算', exact=True)).to_be_visible()
        check('narrow sidebar opens without outer overflow', page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
        page.keyboard.press('Shift+Tab')
        check('narrow sidebar traps keyboard focus', page.locator('.mp-sidebar-content').evaluate('(e) => e.contains(document.activeElement)'))
        page.keyboard.press('Escape')
        check('narrow sidebar Escape closes and restores focus', page.locator('.mp-sidebar-backdrop').count() == 0 and page.get_by_role('button', name='切换测算记录栏', exact=True).evaluate('(e) => document.activeElement === e'))
        page.get_by_role('button', name='修改条件', exact=True).click()
        for width in [390, 320]:
            page.set_viewport_size({'width': width, 'height': 900})
            check(f'form viewport {width} has no outer horizontal overflow', page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
        page.screenshot(path=str(output / 'narrow-form.png'))
        saved_count = page.locator('.mp-history-list > .mp-history-row > button:first-child').count()
        page.reload(wait_until='networkidle')
        check('refresh keeps saved records while starting an empty form', page.locator('.mp-history-list > .mp-history-row > button:first-child').count() == saved_count and saved_count > 0 and page.locator('[name="region"]').input_value() == '')
        page.set_viewport_size({'width': 1440, 'height': 1000})
        page.locator('.mp-history-list > .mp-history-row > button:first-child').first.click()
        expect(page.locator('.mp-result')).to_contain_text('10')
        check('saved history restores result and original inputs after refresh', page.locator('[name="hireDate"]').input_value() == '2024-09-01')
        reset(page)
        page.set_viewport_size({'width': 1440, 'height': 1000})
        page.get_by_role('button', name='切换测算记录栏', exact=True).click()
        check('desktop sidebar collapses without hiding form', page.locator('.sidebar-collapsed').count() == 1 and page.locator('[name="region"]').is_visible())
        page.get_by_role('button', name='切换测算记录栏', exact=True).click()
        check('desktop sidebar expands', page.locator('.sidebar-collapsed').count() == 0)
        check('new calculation action retains compact shared sidebar font', page.get_by_role('button', name='新建测算', exact=True).evaluate('(e) => parseFloat(getComputedStyle(e).fontSize)') <= 14)
        check('account footer matches the existing 13px font', page.locator('.account-trigger').evaluate('(e) => getComputedStyle(e).fontSize') == '13px')

        # Clipboard refusal must offer a manual copy, not report false success.
        page.evaluate("Object.defineProperty(navigator, 'clipboard', {value: {writeText: async () => {throw new Error('denied')}}, configurable: true})")
        shanghai(page)
        page.get_by_role('button', name='开始测算', exact=True).click()
        page.get_by_role('button', name='复制测算单', exact=True).click()
        expect(page.locator('#mp-copy-text')).to_be_visible()
        check('clipboard failure exposes complete read-only receipt', page.locator('#mp-copy-text').get_attribute('readonly') is not None and '待核对事项' in page.locator('#mp-copy-text').input_value())
        page.get_by_role('button', name='修改条件', exact=True).click()
        fill(page, 'segments.0.workDays', '7')
        check('editing removes stale manual-copy text', page.locator('#mp-copy-text').count() == 0)

        # A fresh, fictional browser context exercises write refusal independently.
        blocked_context = browser.new_context(viewport={'width': 1440, 'height': 1000})
        blocked_context.add_init_script("Object.defineProperty(Storage.prototype, 'setItem', {value: () => {throw new Error('QuotaExceededError')}})")
        blocked = blocked_context.new_page()
        blocked.goto(url, wait_until='networkidle')
        shanghai(blocked)
        blocked.get_by_role('button', name='开始测算', exact=True).click()
        expect(blocked.locator('.mp-metrics')).to_contain_text('2.61')
        expect(blocked.locator('.mp-storage-error')).to_contain_text('本次记录未保存')
        check('storage write failure keeps result usable and reports unsaved record', blocked.locator('.mp-history-list > .mp-history-row > button:first-child').count() == 1)
        blocked.reload(wait_until='networkidle')
        check('write refusal never claims a persistent record', blocked.locator('.mp-history-list > .mp-history-row > button:first-child').count() == 0)
        blocked_context.close()

        # Old algorithm snapshots may restore inputs, but require explicit recalculation.
        page.evaluate("""() => {
          const key = 'fafee-history-v2:fictional-medical-review-user:medical-calculator:calculations';
          const data = JSON.parse(localStorage.getItem(key));
          data.records[0].result.algorithmVersion = 'old-test-version';
          localStorage.setItem(key, JSON.stringify(data));
        }""")
        page.reload(wait_until='networkidle')
        page.locator('.mp-history-list > .mp-history-row > button:first-child').first.click()
        check('outdated history restores conditions without presenting an old result', page.locator('.mp-result').count() == 0 and page.locator('[name="segments.0.workDays"]').input_value() == '8')
        expect(page.get_by_role('status')).to_contain_text('请重新计算')
        reset(page)
        page.locator('[name="region"]').select_option('national')
        fill(page, 'hireDate', '2025-11-02')
        fill(page, 'totalWorkYears', '1')
        fill(page, 'segments.0.startDate', '2026-02-02')
        fill(page, 'segments.0.endDate', '2026-02-06')
        page.locator('[name="historyComplete"]').check()
        check('form separates rule, tenure and records without additional mandatory fields',
              page.locator('form legend').all_text_contents() == ['适用规则', '工作年限', '病休记录'] and page.locator('form .mp-field input:visible').count() == 4)
        check('main history checkbox is not falsely labelled supplementary information', '选填' in page.locator('.mp-supplementary > summary').inner_text())
        check('history coverage is explained before calculation and confirmation', '2026-02-02' in page.locator('.mp-coverage-hint').inner_text() and '6个月' in page.locator('.mp-coverage-hint').inner_text())
        page.set_viewport_size({'width': 1440, 'height': 1150})
        page.locator('.conversation').evaluate('(e) => e.scrollTop = 0')
        page.screenshot(path=str(output / 'user-example-form.png'))
        page.get_by_role('button', name='开始测算', exact=True).click()
        expect(page.locator('.mp-metrics')).to_contain_text('累计统计范围')
        check('user example separates 3-month quota, 5 natural days and 6-month scope',
              '5' in page.locator('.mp-metrics').inner_text() and '6' in page.locator('.mp-metrics').inner_text() and '2.83' not in page.locator('.mp-metrics').inner_text())
        check('national law balance status and matching facts are explicit', '法定余额待核对' in page.locator('.mp-assessment').inner_text() and '累计工作1年' in page.locator('.mp-condition-summary').inner_text())
        check('reference arithmetic is closed by default and absent from primary process', page.locator('.mp-estimate-note').is_hidden() and '2.83' not in page.locator('.mp-process').inner_text())
        page.evaluate("Object.defineProperty(navigator, 'clipboard', {value: {writeText: async text => {window.__medicalCopied = text}}, configurable: true})")
        page.get_by_role('button', name='复制测算单', exact=True).click()
        expect(page.get_by_role('status')).to_contain_text('已复制')
        user_receipt = page.evaluate('window.__medicalCopied')
        check('copied receipt agrees with visible national status and scope', page.locator('.mp-assessment h3').inner_text() in user_receipt and page.locator('.mp-coverage-hint').text_content().replace('本次核算范围', '') in user_receipt and '参考折算（非核定余额）' in user_receipt and '非核定法定余额' in user_receipt)
        page.locator('.mp-reference-trial > summary').click()
        check('optional reference explains the 30-day assumption and 85-day arithmetic', '85天' in page.locator('.mp-estimate-note').inner_text() and '非核定法定余额' in page.locator('.mp-estimate-note').inner_text())
        page.locator('.mp-reference-trial > summary').click()
        check('history uses shared icons and relative timestamps', page.locator('.sidebar-search .lucide-history').count() == 1 and page.locator('.mp-history-list .lucide-message-circle').count() > 0 and page.locator('.history-thread-time').first.inner_text() == '刚刚')
        page.locator('.conversation').evaluate('(e) => e.scrollTop = 0')
        page.screenshot(path=str(output / 'user-example-result.png'))
        count_before_delete = page.locator('.mp-history-row').count()
        page.locator('.mp-history-remove').nth(1).click()
        deletion = page.get_by_role('dialog', name='删除这条测算记录？', exact=True)
        expect(deletion).to_be_visible()
        deletion.get_by_role('button', name='取消', exact=True).click()
        check('cancel deletion leaves all saved records and current result intact', page.locator('.mp-history-row').count() == count_before_delete and '累计统计范围' in page.locator('.mp-metrics').inner_text())
        page.locator('.mp-history-remove').nth(1).click()
        deletion.get_by_role('button', name='删除记录', exact=True).click()
        check('confirmed deletion removes only one record and retains current calculation', page.locator('.mp-history-row').count() == count_before_delete - 1 and '累计统计范围' in page.locator('.mp-metrics').inner_text())
        page.reload(wait_until='networkidle')
        check('confirmed deletion survives refresh', page.locator('.mp-history-row').count() == count_before_delete - 1)
        page.locator('.mp-history-row > button:first-child').first.click()
        expect(page.locator('.mp-metrics')).to_contain_text('累计统计范围')
        check('restoring history keeps reference arithmetic folded and preserves its explanation', page.locator('.mp-estimate-note').is_hidden() and '非核定法定余额' in page.locator('.mp-estimate-note').text_content())
        page.get_by_role('button', name='修改条件', exact=True).click()
        fill(page, 'totalWorkYears', '9')
        page.get_by_role('button', name='重新计算', exact=True).click()
        check('nine-year tenure requires the actual ten-year date before reference arithmetic', '请补充实际满10年的日期' in page.locator('.mp-assessment').inner_text() and page.locator('.mp-reference-trial').count() == 0)
        page.get_by_role('button', name='修改条件', exact=True).click()
        fill(page, 'tenYearDate', '2026-12-01')
        page.get_by_role('button', name='重新计算', exact=True).click()
        check('supplying a ten-year date after cutoff restores only the folded reference', page.locator('.mp-reference-trial').count() == 1 and page.locator('.mp-estimate-note').is_hidden() and '法定余额待核对' in page.locator('.mp-assessment').inner_text())
        page.locator('.mp-reference-trial > summary').click()
        page.get_by_role('button', name='修改条件', exact=True).click()
        fill(page, 'segments.0.endDate', '2026-02-07')
        page.get_by_role('button', name='重新计算', exact=True).click()
        check('a new calculation folds previously expanded reference arithmetic', page.locator('.mp-estimate-note').is_hidden() and '6' in page.locator('.mp-metrics').inner_text())
        reset(page)
        page.locator('[name="region"]').select_option('shanghai')
        fill(page, 'hireDate', '2024-09-01')
        fill(page, 'asOf', '2026-06-30')
        fill(page, 'summary.firstDate', '2026-03-01')
        fill(page, 'summary.workDays', '62')
        page.locator('[name="historyComplete"]').check()
        page.get_by_role('button', name='开始测算', exact=True).click()
        expect(page.locator('.mp-metrics')).to_be_visible()
        check('positive Shanghai balance below display precision is not reported as zero or exhausted', '<0.01' in page.locator('.mp-metrics').inner_text() and '0.01个病休工作日' in page.locator('.mp-metrics').inner_text() and '已达到' not in page.locator('.mp-assessment').inner_text())
        page.get_by_role('button', name='复制测算单', exact=True).click()
        expect(page.get_by_role('status')).to_contain_text('已复制')
        tiny_receipt = page.evaluate('window.__medicalCopied')
        check('Shanghai receipt preserves the tiny positive workday balance', '剩余不足0.01个月' in tiny_receipt and '0.01个病休工作日' in tiny_receipt and page.locator('.mp-assessment h3').inner_text() in tiny_receipt)
        check('no API/model calls in form calculation', len(api_requests) == 0)
        check('no external requests', len(external_requests) == 0)
        check('no HTTP failures', len(http_failures) == 0)
        check('no browser exceptions or console errors: ' + json.dumps(errors, ensure_ascii=False), len(errors) == 0)
        browser.close()
    source_hashes = {}
    if review_root:
        for relative in ['src/pages/MedicalCalculatorPage.jsx', 'src/pages/MedicalCalculatorPage.css',
                         'src/utils/medical-period-calculator.js', 'src/utils/medical-period-history.js', 'src/pages/ContractRewritePage.css']:
            source_hashes[relative] = hashlib.sha256((review_root / relative).read_bytes()).hexdigest()
    report = {'status': 'passed', 'checks': len(checks), 'cases': checks, 'pageErrors': errors,
              'externalRequests': external_requests, 'apiRequests': api_requests, 'httpFailures': http_failures,
              'url': url, 'reviewRoot': str(review_root) if review_root else None, 'sourceFilesSHA256': source_hashes,
              'scope': 'actual medical React page in isolated review; live backend, production deployment and legal acceptance not verified'}
    (output / 'verification.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'status': 'passed', 'checks': len(checks), 'output': str(output)}, ensure_ascii=False))
finally:
    if server:
        server.terminate()
        server.wait(timeout=20)
