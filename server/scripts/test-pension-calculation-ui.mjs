import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { build } from 'vite'
import react from '@vitejs/plugin-react'
import { chromium } from 'playwright'
import { pensionHistoryKey } from '../../src/utils/pension-history.js'

// Standalone actual-page review with fictional authentication. Actual App and
// login protection are tested separately by test-pension-routes-ui.py.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(import.meta.url)
const output = process.env.PENSION_TEST_OUTPUT || mkdtempSync(join(tmpdir(), 'pension-simple-ui-'))
mkdirSync(output, { recursive: true })
const verificationPath = join(output, 'verification.json')
writeFileSync(verificationPath, JSON.stringify({ status: 'running' }))
const entryDir = mkdtempSync(join(tmpdir(), 'pension-simple-entry-'))
const entry = join(entryDir, 'entry.jsx')
const modulePath = (value) => JSON.stringify(value.replaceAll('\\', '/'))
writeFileSync(entry, `import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Routes, Route, Link } from 'react-router-dom';
import { AuthProvider } from ${modulePath(join(root, 'src/components/AuthProvider.jsx'))};
import PensionCalculationPage from ${modulePath(join(root, 'src/pages/PensionCalculationPage.jsx'))};
import ${modulePath(join(root, 'src/index.css'))};
if (!window.location.hash) window.location.hash = '/tools/pension-calc1';
createRoot(document.getElementById('root')).render(<AuthProvider><HashRouter><Routes>
<Route path="/tools/:toolId" element={<PensionCalculationPage />} />
<Route path="/tools" element={<main><h1>独立验收入口</h1><Link to="/tools/pension-calc1">企业职工养老</Link></main>} />
</Routes></HashRouter></AuthProvider>);`)
const bundle = await build({
  configFile: false, envFile: false, root, publicDir: false, plugins: [react()], logLevel: 'error',
  define: { 'process.env.NODE_ENV': '"production"' },
  resolve: { alias: { 'react-dom/client': require.resolve('react-dom/client'),
    'react-router-dom': require.resolve('react-router-dom'), react: dirname(require.resolve('react/package.json')) } },
  build: { write: false, minify: true, cssCodeSplit: false,
    lib: { entry, name: 'PensionReview', formats: ['iife'] }, rollupOptions: { output: { inlineDynamicImports: true } } }
})
const files = (Array.isArray(bundle) ? bundle : [bundle]).flatMap((part) => part.output)
const logo = `data:image/png;base64,${readFileSync(join(root, 'public/logo.png')).toString('base64')}`
const code = files.filter((part) => part.type === 'chunk').map((part) => part.code.replaceAll('"/logo.png"', JSON.stringify(logo))).join('\n')
const css = files.filter((part) => part.type === 'asset' && part.fileName.endsWith('.css')).map((part) => part.source).join('\n')
// This downloadable review file cannot access company APIs or real accounts.
const authShim = `window.fetch = async (input) => {
  const user = { id:'fictional-pension-review', username:'验收账号', email:'review@example.invalid' };
  const path = String(input);
  const value = path === '/api/auth/refresh' ? { accessToken:'fictional-review-token', accessTokenExpiresAt:'2030-01-01T00:00:00.000Z', user }
    : path === '/api/auth/me' ? { user } : path === '/api/account/balance' ? { balances: [], isAvailable: true } : null;
  if (!value) throw new Error('独立审阅页不连接外部服务');
  return new Response(JSON.stringify(value), { status:200, headers:{'Content-Type':'application/json'} });
};`
const htmlPath = join(output, 'index.html')
writeFileSync(htmlPath, `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>养老简表与历史记录验收（模拟账号）</title><style>${css}</style></head><body class="loaded"><div id="root"></div><script>${authShim}${code.replaceAll('</script', '<\\/script')}</script></body></html>`)
const edge = process.env.PLAYWRIGHT_EXECUTABLE_PATH || (existsSync('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe') ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : undefined)
const browser = await chromium.launch({ headless: true, ...(edge ? { executablePath: edge } : {}) })
const checks = [], screenshots = [], errors = [], externalRequests = []
const note = (name) => { checks.push(name); console.log(`PASS ${name}`) }
const fixture = { gender:'male', currentAge:'59', retirementAge:'60', actualYears:'19', deemedYears:'0',
  recordMonth:'2025-12', currentAgeExtraMonths:'0', retirementAgeExtraMonths:'0', actualExtraMonths:'0', deemedExtraMonths:'0',
  pastAvgIndex:'100', accountBalance:'90000', localAvgWage:'8000', wageGrowth:'0', accountInterest:'0', currentMonthlyWage:'8000', futureWageGrowth:'0', grade:'100' }
async function fullFormScreenshot(page, name) {
  await page.locator('.pension-tool-navigation').scrollIntoViewIfNeeded()
  const height = await page.locator('.conversation').evaluate((element) => element.scrollHeight + 80)
  await page.setViewportSize({ width:1440, height })
  await page.screenshot({ path:join(output, name), fullPage:true }); screenshots.push(name)
  await page.setViewportSize({ width:1440, height:1000 })
}
try {
  const context = await browser.newContext({ viewport: { width:1440, height:1000 }, reducedMotion:'reduce' })
  await context.route('**/*', async (route) => { if (/^https?:/.test(route.request().url())) { externalRequests.push(route.request().url()); await route.abort() } else await route.continue() })
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil:'networkidle' })
  await page.locator('.pension-calculation-page').waitFor()
  assert.ok(await page.locator('.sidebar-brand').isVisible())
  assert.equal(await page.locator('.chat-sidebar').evaluate((element) => element.getBoundingClientRect().width), 268)
  assert.equal(await page.locator('.chat-title strong').evaluate((element) => getComputedStyle(element).fontSize), '16px')
  assert.equal(await page.locator('[name="accountBalance"]').inputValue(), '')
  assert.equal(await page.locator('[name="region"],textarea,.composer').count(), 0)
  assert.ok((await page.locator('.pension-content').innerText()).includes('一般情景估算'))
  assert.ok((await page.locator('.pension-content').innerText()).includes('0.8填80'))
  assert.equal(await page.locator('[name="paymentDivisor"]').count(), 0)
  assert.equal((await page.locator('[name="actualYears"]').boundingBox()).y, (await page.locator('[name="actualExtraMonths"]').boundingBox()).y)
  note('默认简表、空金额、现役侧栏268px与标题16px，无专业选择或对话区')
  await page.screenshot({ path:join(output, '桌面-企业养老简表.png') }); screenshots.push('桌面-企业养老简表.png')
  await fullFormScreenshot(page, '桌面-企业养老完整填写说明.png')
  await page.locator('button[type="submit"]').click()
  await page.getByRole('alert').waitFor()
  assert.equal(await page.getByTestId('pension-result').count(), 0)
  note('空值提示并阻止计算')
  async function fill(values) { for (const [name,value] of Object.entries(values)) { const control = page.locator(`[name="${name}"]`); if (!await control.count()) continue; if (await control.evaluate((element) => element.tagName) === 'SELECT') await control.selectOption(value); else await control.fill(value) } }
  async function calculate() { await page.locator('button[type="submit"]').click(); await page.getByTestId('pension-result').waitFor() }
  await fill(fixture); await calculate()
  assert.equal(await page.getByTestId('pension-total').innerText(), '2,302.73元／月')
  assert.equal(await page.locator('.pension-history-row').count(), 1)
  await page.getByTestId('pension-result').scrollIntoViewIfNeeded()
  note('小程序字段手算一致，计算后保存历史')
  await page.screenshot({ path:join(output, '桌面-企业养老结果与历史.png') }); screenshots.push('桌面-企业养老结果与历史.png')
  await page.locator('[name="accountBalance"]').fill('100000')
  assert.equal(await page.getByTestId('pension-result').count(), 0)
  await page.getByRole('button', { name:'重新计算', exact:true }).waitFor()
  await calculate()
  assert.equal(await page.getByTestId('pension-total').innerText(), '2,374.68元／月')
  assert.equal(await page.locator('.pension-history-row').count(), 1)
  note('修改清除旧结果；重算更新原记录')
  await page.getByRole('button', { name:'新建测算', exact:true }).click()
  assert.equal(await page.locator('[name="currentAge"]').inputValue(), '')
  await page.locator('.pension-history-row > button:first-child').click()
  assert.equal(await page.locator('[name="accountBalance"]').inputValue(), '100000')
  assert.equal(await page.getByTestId('pension-total').innerText(), '2,374.68元／月')
  note('新建保留历史，点历史恢复条件与结果')
  await page.reload({ waitUntil:'networkidle' }); await page.locator('.pension-calculation-page').waitFor()
  assert.equal(await page.locator('.pension-history-row').count(), 1)
  await page.locator('.pension-history-row > button:first-child').click()
  assert.equal(await page.getByTestId('pension-total').innerText(), '2,374.68元／月')
  note('刷新后恢复已保存记录')
  await page.locator('[name="history-search"]').fill('不存在')
  assert.equal(await page.locator('.pension-history-row').count(), 0)
  await page.locator('[name="history-search"]').fill('59岁')
  assert.equal(await page.locator('.pension-history-row').count(), 1)
  await page.locator('[name="history-search"]').fill('')
  note('历史搜索匹配标题并显示空状态')
  await page.getByRole('button', { name:'收起历史记录栏', exact:true }).click()
  assert.ok(await page.locator('.chat-sidebar').evaluate((element) => element.getBoundingClientRect().width <= 1))
  await page.getByRole('button', { name:'展开历史记录栏', exact:true }).click()
  assert.equal(await page.locator('.chat-sidebar').evaluate((element) => element.getBoundingClientRect().width), 268)
  note('侧栏收起与展开正常')
  await page.locator('.pension-history-delete').click()
  assert.equal(await page.locator('.pension-history-row').count(), 0)
  assert.equal(await page.getByTestId('pension-result').count(), 0)
  await page.reload({ waitUntil:'networkidle' }); await page.locator('.pension-calculation-page').waitFor()
  assert.equal(await page.locator('.pension-history-row').count(), 0)
  note('删除活动记录后清空页面，刷新不会复活')
  await fill({ ...fixture, currentAgeExtraMonths:'6', actualExtraMonths:'6' }); await calculate()
  assert.equal(await page.getByTestId('pension-total').innerText(), '2,275.11元／月')
  assert.ok((await page.locator('.pension-facts').innerText()).includes('20年'))
  assert.ok((await page.locator('.pension-facts').innerText()).includes('6个月'))
  note('年/月输入独立手算一致，结果显示年月不显示无限小数')
  await fill({ ...fixture, retirementAgeExtraMonths:'3' }); await calculate()
  assert.equal(await page.getByTestId('pension-total').count(), 0)
  assert.ok((await page.getByTestId('pension-result').innerText()).includes('计发月数'))
  await page.getByText('查看分项计算过程', { exact:true }).click()
  assert.ok(!(await page.getByTestId('pension-result').innerText()).includes('null'))
  await page.locator('[name="paymentDivisor"]').fill('138'); await calculate()
  assert.equal(await page.getByTestId('pension-total').innerText(), '2,341.74元／月')
  await page.screenshot({ path:join(output, '桌面-按月精度测算结果.png') }); screenshots.push('桌面-按月精度测算结果.png')
  note('非整岁提示查询计发月数，未知保留分项，填写后可计算且过程无null')
  await fill({ ...fixture, recordMonth:'2029-09', currentAgeExtraMonths:'6', actualYears:'14', actualExtraMonths:'6' }); await calculate()
  assert.equal(await page.getByTestId('pension-total').count(), 0)
  assert.ok((await page.getByTestId('pension-result').innerText()).includes('还差6个月'))
  assert.ok((await page.getByTestId('pension-result').innerText()).includes('2030-03'))
  note('修改截止年月清除旧结果，跨2030提示六个月不足而非显示可领合计')
  await page.getByRole('link', { name:'个体工商户／灵活就业养老', exact:true }).click()
  await fullFormScreenshot(page, '桌面-灵活就业填写说明.png')
  await fill(fixture); await calculate()
  assert.equal(await page.getByTestId('pension-total').innerText(), '2,302.73元／月')
  assert.ok((await page.locator('.pension-result-grid').innerText()).includes('1,600.00'))
  assert.ok((await page.locator('.pension-result-grid').innerText()).includes('所选档次月缴费参考'))
  await page.getByText('比较不同缴费档次', { exact:true }).click()
  assert.equal(await page.getByRole('table').locator('tbody tr').count(), 4)
  note('灵活就业只显示适用字段，缴费与账户分开并可展开比较')
  await page.getByTestId('pension-result').scrollIntoViewIfNeeded()
  await page.screenshot({ path:join(output, '桌面-灵活就业结果与历史.png') }); screenshots.push('桌面-灵活就业结果与历史.png')
  await page.locator('[name="grade"]').fill('0.6')
  assert.ok((await page.locator('.pension-inline-help').innerText()).includes('超出本页常用比较区间'))
  await page.getByRole('button', { name:'100%', exact:true }).click()
  assert.equal(await page.locator('[name="grade"]').inputValue(), '100')
  assert.equal(await page.locator('.pension-inline-help').count(), 0)
  note('档次快捷填写与百分数异常就地提示；不伪装当地开放档位')
  await page.locator('[name="deemedExtraMonths"]').fill('6')
  assert.ok((await page.locator('.pension-inline-help').innerText()).includes('请按社保记录填写年限'))
  assert.equal(await page.getByTestId('pension-result').count(), 0)
  await fullFormScreenshot(page, '桌面-视同缴费即时说明.png')
  await calculate()
  assert.equal(await page.getByTestId('pension-total').count(), 0)
  assert.ok((await page.getByTestId('pension-result').innerText()).includes('视同'))
  note('有视同记录时保留缺项，不套固定过渡系数')
  for (const width of [320,390,680,768,1024,1440,1920]) {
    await page.setViewportSize({ width, height:1000 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    assert.ok(await page.locator('button[type="submit"]').isVisible())
    note(`${width}px表单和结果无页面横向溢出`)
  }
  await page.setViewportSize({ width:390, height:900 })
  // Desktop left the drawer expanded; close it first, then verify mobile access.
  if (await page.getByRole('button', { name:'关闭历史记录栏', exact:true }).isVisible()) await page.getByRole('button', { name:'关闭历史记录栏', exact:true }).click()
  await page.getByRole('button', { name:'展开历史记录栏', exact:true }).click()
  assert.ok(await page.locator('.chat-sidebar').isVisible())
  await page.locator('.pension-history-row > button:first-child').click()
  assert.equal(await page.locator('.sidebar-brand').count(), 0)
  note('窄屏通过顶部展开历史，恢复后关闭侧栏')
  await page.setViewportSize({ width:1440, height:1000 })
  const legacyForm = { ...fixture, toolId:'pension-calc1', referenceYear:2025 }
  for (const field of ['recordMonth','currentAgeExtraMonths','retirementAgeExtraMonths','actualExtraMonths','deemedExtraMonths']) delete legacyForm[field]
  await page.evaluate(({ key, form }) => localStorage.setItem(key, JSON.stringify([{ id:'legacy-record', title:'旧测算记录', updatedAt:1000, form, result:{ ruleVersion:'older-version', components:{total:999999} } }])), { key:pensionHistoryKey('fictional-pension-review','pension-calc1'), form:legacyForm })
  await page.getByRole('link', { name:'企业职工养老', exact:true }).click()
  assert.ok((await page.locator('.pension-content').innerText()).includes('填写口径已更新'))
  await page.locator('.pension-history-row > button:first-child').click()
  assert.equal(await page.locator('[name="recordMonth"]').inputValue(), '2024-12')
  assert.equal(await page.locator('[name="actualExtraMonths"]').inputValue(), '0')
  assert.equal(await page.getByTestId('pension-result').count(), 0)
  await calculate()
  assert.equal(await page.getByTestId('pension-total').innerText(), '2,302.73元／月')
  note('旧记录保留原年份和输入，提示核对后重算，不显示旧版或篡改金额')
  assert.deepEqual(errors, []); assert.deepEqual(externalRequests, [])
  note('无浏览器异常或外部请求')
} catch (error) { writeFileSync(verificationPath, JSON.stringify({ status:'failed', checks, screenshots, error:error.message, errors, externalRequests }, null, 2)); throw error }
finally { await browser.close() }
const sourceHashes = Object.fromEntries(['src/pages/PensionCalculationPage.jsx','src/pages/PensionCalculationPage.css','src/utils/pension-calculator.js','src/utils/pension-history.js'].map((file) => [file,createHash('sha256').update(readFileSync(join(root,file))).digest('hex')]))
writeFileSync(verificationPath, JSON.stringify({ status:'passed', checks, screenshots, sourceHashes, errors, externalRequests, scope:'actual page; standalone fictional authentication; actual App checked separately', htmlPath }, null, 2))
console.log(JSON.stringify({ status:'passed', checks:checks.length, screenshots:screenshots.length, output }))
