import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Calculator, Check, Copy, History, MessageCircle, PanelLeftClose, PanelLeftOpen, PenLine, Plus, Trash2, X } from 'lucide-react'
import ContractWorkbenchLayout from '../components/ContractWorkbenchLayout'
import ToolAccountPanel from '../components/ToolAccountPanel'
import ToolOverviewLink from '../components/ToolOverviewLink'
import { useAuth } from '../components/AuthProvider'
import { calculateMedicalPeriod, describeMedicalPeriodResult, formatMedicalResult, prepareMedicalPeriodInput } from '../utils/medical-period-calculator.js'
import { deleteMedicalRecord, readMedicalHistory, saveMedicalRecord } from '../utils/medical-period-history.js'
import { formatRelativeTime, RELATIVE_TIME_TICK_MS } from '../utils/relative-time.js'
import './ContractRewritePage.css'
import './MedicalCalculatorPage.css'

const emptySegment = () => ({ startDate: '', endDate: '', workDays: '' })
const emptyInput = () => ({
  region: '', locality: '', asOf: '', hireDate: '', totalWorkYears: '', tenYearDate: '',
  recordMode: 'intervals', leaveType: 'continuous', segments: [emptySegment()],
  summary: { firstDate: '', naturalDays: '', workDays: '' },
  historyComplete: false, specialCircumstances: false, specialNote: ''
})
const fieldId = (name) => `mp-${name.replaceAll('.', '-')}`
const todayDate = () => {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
const regionNotes = {
  shanghai: '累计天数请填病休工作日，不含休息日和法定休假日。',
  national: '病休起止日均计入，中间未病休的日期不计入。',
  other: '适用规则暂不明确时，可核对病休记录；不会借用其他地区额度。'
}

function Field({ name, label, help, error, required = false, children }) {
  return <div className="mp-field">
    <label htmlFor={fieldId(name)}>{label}{required ? <span className="mp-required"> *</span> : <span className="mp-optional">选填</span>}</label>
    {children}
    <small id={`${fieldId(name)}-help`}>{help}</small>
    {error && <p id={`${fieldId(name)}-error`} className="mp-field-error">{error}</p>}
  </div>
}

function Result({ result, dirty, onEdit, onCopy, copyText }) {
  const { quota, records, usage, referenceEstimate } = result
  const display = describeMedicalPeriodResult(result)
  return <section className={`mp-result${dirty ? ' mp-result-stale' : ''}`} aria-labelledby="mp-result-title">
    <header className="mp-panel-header"><div><span className="mp-eyebrow">基础规则与记录核对</span><h2 id="mp-result-title">测算结果</h2><p>{result.regionLabel}{result.input.locality ? ` · ${result.input.locality}` : ''} · 截止 {result.input.asOf}</p></div><div className="mp-result-actions"><button type="button" className="mp-text-button" onClick={onEdit}>修改条件</button><button type="button" className="compact-button" onClick={onCopy} disabled={dirty}><Copy size={15} />复制测算单</button></div></header>
    {dirty && <p className="mp-stale-message" role="status">条件已修改，以下为上次结果。请重新计算；旧结果暂不可复制。</p>}
    <div className="mp-result-body">
      <div className="mp-metrics">
        <div><span>{display.quotaLabel}</span><strong>{quota ? <>{quota.months}<small>个月</small></> : '待核对'}</strong><p>{display.quotaDetail}</p></div>
        <div><span>已录入病休时间</span><strong>{display.recordValue}<small>{display.recordUnit}</small></strong><p>{display.recordDetail}</p></div>
        <div><span>{display.thirdLabel}</span><strong>{display.thirdValue}<small>{display.thirdUnit}</small></strong><p>{display.thirdDetail}</p></div>
      </div>
      <p className="mp-quota-meaning">{display.meaning}</p>
      <section className={`mp-assessment mp-assessment-${display.status.tone}`} aria-label="核算状态"><h3>{display.status.title}</h3><p>{display.status.detail}</p>{display.actions.length > 1 && <ul>{display.actions.slice(1).map((item) => <li key={item.code}>{item.message}</li>)}</ul>}</section>
      <dl className="mp-result-facts"><div><dt>核算范围</dt><dd>{display.scope}</dd></div>{usage && <div><dt>已用折算</dt><dd>{records.workDays}个病休工作日 ÷ 20.67，约{usage.usedMonths.toFixed(2)}个月；比较额度时使用未舍入数值。</dd></div>}</dl>
      {referenceEstimate && <details className="mp-reference-trial"><summary>查看30天/月参考折算（非核定余额）</summary><p className="mp-estimate-note">{display.referenceDetail}</p></details>}
      <section className="mp-process" aria-labelledby="mp-process-title"><h3 id="mp-process-title">计算过程</h3><ol>{result.steps.map((step) => <li key={step.title}><strong>{step.title}</strong><p>{step.detail}</p></li>)}</ol></section>
      {records.rows.length > 0 ? <section className="mp-record-detail"><h3>病休记录明细</h3><div className="mp-table-wrap" tabIndex={0} aria-label="病休记录明细表"><table><thead><tr><th scope="col">原记录</th><th scope="col">开始日期</th><th scope="col">结束日期</th><th scope="col">自然日</th>{result.input.region === 'shanghai' && <th scope="col">病休工作日</th>}<th scope="col">距前段间隔</th></tr></thead><tbody>{records.rows.map((row) => <tr key={row.inputIndex}><td>第{row.inputIndex + 1}段</td><td>{row.startDate}</td><td>{row.endDate}</td><td>{row.naturalDays}天</td>{result.input.region === 'shanghai' && <td>{row.workDays === null ? '未知' : `${row.workDays}天`}</td>}<td>{row.gapDays}天</td></tr>)}</tbody></table></div></section> : <p className="mp-rule-note">当前为汇总记录，保留原始累计量，不生成不存在的病休时间线。</p>}
      <details className="mp-review"><summary>计算口径与适用条件</summary><ul>{result.reviewReasons.filter((item) => item.code !== 'SH_MATURITY_PENDING').map((item) => <li key={item.code}>{item.message}</li>)}</ul></details>
      <details className="mp-sources"><summary>查看规则依据与版本</summary><p>{result.rule.version}</p><p>来源核对：{result.rule.verifiedOn} · 地区适用及业务验收待复核</p><ul>{result.rule.sources.map((source) => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a></li>)}</ul></details>
      {copyText && <div className="mp-copy-fallback"><label htmlFor="mp-copy-text">自动复制不可用，可选择全文手动复制。</label><textarea id="mp-copy-text" readOnly value={copyText} rows={8} onFocus={(event) => event.target.select()} /></div>}
      <p className="mp-disclaimer">医疗期届满不自动构成解除劳动合同的结论；基础测算需结合实际材料复核。</p>
    </div>
  </section>
}

export function MedicalCalculatorWorkspace({ userId }) {
  const [savedHistory] = useState(() => readMedicalHistory(userId))
  const [input, setInput] = useState(emptyInput)
  const [errors, setErrors] = useState([])
  const [result, setResult] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [records, setRecords] = useState(savedHistory.records)
  const [storageError, setStorageError] = useState(savedHistory.error)
  const [historyQuery, setHistoryQuery] = useState('')
  const [activeRecord, setActiveRecord] = useState(null)
  const [deletingRecord, setDeletingRecord] = useState(null)
  const [now, setNow] = useState(Date.now)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [copyText, setCopyText] = useState('')
  const formRef = useRef(null)
  const resultRef = useRef(null)
  const sidebarRef = useRef(null)
  const sidebarButtonRef = useRef(null)
  const resetRef = useRef(null)
  const deleteRef = useRef(null)
  const revision = useRef(0)
  const today = todayDate()
  const isShanghai = input.region === 'shanghai'
  const hasSupplementary = Boolean(input.locality || input.tenYearDate || input.specialCircumstances || input.specialNote || (isShanghai && input.recordMode === 'summary' && input.summary.naturalDays) || (!isShanghai && input.recordMode === 'intervals' && input.asOf))
  const errorFor = (field) => errors.find((item) => item.field === field)?.message
  const scopePreview = useMemo(() => {
    const candidate = calculateMedicalPeriod(prepareMedicalPeriodInput(input), { today })
    return candidate.ok ? describeMedicalPeriodResult(candidate) : null
  }, [input, today])

  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), RELATIVE_TIME_TICK_MS); return () => window.clearInterval(timer) }, [])

  useEffect(() => {
    if (!mobileSidebarOpen) return
    sidebarRef.current?.querySelector('input,button')?.focus()
    const keydown = (event) => {
      if (event.key === 'Escape') { setMobileSidebarOpen(false); sidebarButtonRef.current?.focus() }
      if (event.key !== 'Tab' || !window.matchMedia('(max-width: 760px)').matches) return
      const focusable = [...sidebarRef.current.querySelectorAll('button,input,a')].filter((element) => !element.disabled && element.getClientRects().length)
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', keydown)
    return () => document.removeEventListener('keydown', keydown)
  }, [mobileSidebarOpen])

  const change = (next) => {
    revision.current++
    setInput((previous) => typeof next === 'function' ? next(previous) : next)
    setErrors([])
    setDirty(Boolean(result))
    setNotice('')
    setCopyText('')
  }
  const setField = (name, value) => change((previous) => ({ ...previous, [name]: value }))
  const setRegion = (value) => change((previous) => ({ ...previous, region: value, recordMode: value === 'shanghai' ? 'summary' : 'intervals' }))
  const setSegment = (index, name, value) => change((previous) => ({ ...previous, segments: previous.segments.map((row, rowIndex) => rowIndex === index ? { ...row, [name]: value } : row) }))
  const setSummary = (name, value) => change((previous) => ({ ...previous, summary: { ...previous.summary, [name]: value } }))
  const inputProps = (name, value, onChange, type = 'date') => ({
    name, id: fieldId(name), value, onChange: (event) => onChange(event.target.value),
    ...(type !== 'select' && type !== 'text' ? { type } : {}),
    'aria-required': ['region', 'hireDate', 'totalWorkYears', 'summary.firstDate'].includes(name) || name === 'asOf' && (isShanghai || input.recordMode === 'summary') || name === 'summary.naturalDays' && !isShanghai || name === 'summary.workDays' && isShanghai || /^segments\.\d+\.(startDate|endDate)$/.test(name) || isShanghai && /^segments\.\d+\.workDays$/.test(name),
    'aria-invalid': Boolean(errorFor(name)),
    'aria-describedby': `${fieldId(name)}-help${errorFor(name) ? ` ${fieldId(name)}-error` : ''}`,
    ...(type === 'date' ? { min: '1900-01-01', max: name === 'tenYearDate' ? '2100-12-31' : today } : {})
  })
  const focusField = (field) => {
    const element = formRef.current?.elements.namedItem(field)
    if (element && typeof element.focus === 'function') {
      let parent = element.parentElement
      while (parent && parent !== formRef.current) {
        if (parent.tagName === 'DETAILS') parent.open = true
        parent = parent.parentElement
      }
      element.focus()
    }
    else formRef.current?.scrollIntoView({ block: 'start' })
  }
  const calculate = (event) => {
    event.preventDefault()
    const quotaOnly = event.nativeEvent.submitter?.dataset.purpose === 'quota-only'
    const next = calculateMedicalPeriod(prepareMedicalPeriodInput(input), { today })
    if (isShanghai && !quotaOnly) {
      const requiredErrors = []
      const missing = (value) => value === undefined || value === null || String(value).trim() === ''
      if (input.recordMode === 'summary' && !input.summary.firstDate) requiredErrors.push({ field: 'summary.firstDate', message: '核对已用与剩余医疗期，需要填写首个病休日；日期未知可先核对基础额度。' })
      if (input.recordMode === 'summary' && missing(input.summary.workDays)) requiredErrors.push({ field: 'summary.workDays', message: '核对余额需要实际累计病休工作日，未知不能按0处理。' })
      if (input.recordMode === 'intervals') input.segments.forEach((row, index) => {
        if (missing(row.workDays)) requiredErrors.push({ field: `segments.${index}.workDays`, message: '核对余额需要每段实际病休工作日；考勤未知可先核对基础额度。' })
      })
      if (!input.historyComplete) requiredErrors.push({ field: 'historyComplete', message: '核对余额前，请确认已提供本单位期间的全部病休记录；资料未齐可先核对基础额度。' })
      if (requiredErrors.length) {
        if (next.ok) { next.ok = false; next.errors = requiredErrors }
        else next.errors.push(...requiredErrors)
      }
    }
    setNotice('')
    setCopyText('')
    if (!next.ok) {
      setErrors(next.errors)
      setDirty(Boolean(result))
      requestAnimationFrame(() => focusField(next.errors[0].field))
      return
    }
    setErrors([])
    setResult(next)
    setDirty(false)
    setCollapsed(true)
    const entry = { id: `medical-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`, createdAt: Date.now(), input: structuredClone(input), result: next }
    const saved = saveMedicalRecord(userId, entry, { pendingRecords: records.filter((record) => record.persisted === false) })
    if (saved.ok) {
      setRecords(saved.records)
      setStorageError(saved.error)
      setNotice('测算记录已保存。')
    } else {
      setRecords((previous) => [{ ...entry, compatible: true, persisted: false, displayResult: next }, ...previous])
      setStorageError(saved.error)
    }
    setActiveRecord(entry.id)
    requestAnimationFrame(() => { resultRef.current?.scrollIntoView({ block: 'start' }); resultRef.current?.focus({ preventScroll: true }) })
  }
  const reset = () => {
    revision.current++
    setInput(emptyInput()); setResult(null); setErrors([]); setDirty(false); setCollapsed(false)
    setActiveRecord(null); setNotice(''); setCopyText(''); setMobileSidebarOpen(false)
    resetRef.current?.close()
    requestAnimationFrame(() => {
      formRef.current?.querySelectorAll('details').forEach((element) => { element.open = false })
      formRef.current?.elements.namedItem('region')?.focus()
    })
  }
  const requestReset = () => {
    if (JSON.stringify(input) === JSON.stringify(emptyInput()) && !result) reset()
    else resetRef.current?.showModal()
  }
  const restore = (entry) => {
    revision.current++
    setInput({ ...emptyInput(), ...structuredClone(entry.input), summary: { ...emptyInput().summary, ...entry.input.summary } }); setResult(entry.compatible ? entry.result : null); setDirty(false); setCollapsed(entry.compatible)
    setErrors([]); setActiveRecord(entry.id); setNotice(''); setCopyText(''); setMobileSidebarOpen(false)
    if (!entry.compatible) setNotice('历史计算版本或结果已变化，已恢复原始条件，请重新计算。')
    requestAnimationFrame(() => entry.compatible ? resultRef.current?.focus({ preventScroll: true }) : formRef.current?.elements.namedItem('region')?.focus())
  }
  const edit = () => { setCollapsed(false); requestAnimationFrame(() => formRef.current?.elements.namedItem('region')?.focus()) }
  const copy = async () => {
    if (!result || dirty) return
    const version = revision.current
    const text = formatMedicalResult(result)
    try {
      await navigator.clipboard.writeText(text)
      if (revision.current === version) setNotice('已复制测算条件、计算过程及待核对事项。')
    } catch {
      if (revision.current === version) { setCopyText(text); setNotice('自动复制不可用，请在结果下方选择全文复制。') }
    }
  }

  const requestDelete = (event, entry) => {
    event.stopPropagation()
    setDeletingRecord(entry)
    deleteRef.current?.showModal()
  }
  const confirmDelete = () => {
    if (!deletingRecord) return
    const removed = deleteMedicalRecord(userId, deletingRecord.id)
    if (removed.ok) {
      setRecords((previous) => previous.filter((entry) => entry.id !== deletingRecord.id))
      setStorageError(removed.error)
      if (activeRecord === deletingRecord.id) setActiveRecord(null)
      setNotice('已删除这条历史记录，当前测算条件和结果保留。')
    } else setStorageError(removed.error)
    deleteRef.current?.close()
    setDeletingRecord(null)
  }

  const sidebar = <div className="mp-sidebar-content" ref={sidebarRef}>
    <label className="sidebar-search"><History size={17} /><input aria-label="搜索历史测算" value={historyQuery} onChange={(event) => setHistoryQuery(event.target.value)} placeholder="搜索历史测算" /></label>
    <div className="sidebar-brand"><span className="brand-orb"><img src="/logo.png" alt="" /></span><strong>法飞飞</strong></div>
    <button type="button" className="sidebar-action" onClick={requestReset}><PenLine size={20} />新建测算</button>
    <p className="history-label">历史测算</p>
    <nav className="history-list mp-history-list" aria-label="历史测算记录">
      {records.filter((entry) => `${entry.displayResult.regionLabel} ${entry.input.locality} ${entry.displayResult.input.asOf}`.includes(historyQuery.trim())).map((entry) => {
        const view = entry.displayResult
        return <div className={`mp-history-row${entry.id === activeRecord ? ' selected' : ''}`} key={entry.id}><button type="button" className={entry.id === activeRecord ? 'selected' : ''} onClick={() => restore(entry)} title={`${view.regionLabel} · 截止 ${view.input.asOf}`}><span className="history-thread-icon"><MessageCircle size={16} /></span><span className="history-thread-main"><span className="history-thread-title">{view.input.region === 'national' ? '全国' : view.regionLabel} · {view.input.asOf}</span><small className="history-thread-time">{formatRelativeTime(entry.createdAt, now)}{!entry.compatible && ' · 需重算'}{entry.persisted === false && ' · 未保存'}</small></span></button><button type="button" className="history-delete mp-history-remove" aria-label={`删除${view.input.asOf}的测算记录`} onClick={(event) => requestDelete(event, entry)}><Trash2 size={14} /></button></div>
      })}
      {!records.length && <p className="mp-history-empty">完成测算后，记录自动保存在这里。</p>}
      {records.length > 0 && !records.some((entry) => `${entry.displayResult.regionLabel} ${entry.input.locality} ${entry.displayResult.input.asOf}`.includes(historyQuery.trim())) && <p className="mp-history-empty">没有匹配的历史记录。</p>}
    </nav>
    <p className="mp-sidebar-note">按账号保存在当前浏览器，可刷新后继续查看。</p>
    <ToolAccountPanel label="法飞飞医疗期计算器" />
  </div>

  return <>
    <ContractWorkbenchLayout className={`medical-calculator${mobileSidebarOpen ? ' mp-sidebar-open' : ''}`} sidebarCollapsed={sidebarCollapsed} sidebar={sidebar} title="医疗期计算器" subtitle="基础规则与病休记录核对" headerLeft={<><button type="button" className="icon-button sidebar-toggle" ref={sidebarButtonRef} aria-label="切换测算记录栏" onClick={() => window.matchMedia('(max-width: 760px)').matches ? setMobileSidebarOpen((value) => !value) : setSidebarCollapsed((value) => !value)}>{sidebarCollapsed ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}</button><ToolOverviewLink /></>}>
      <div className="mp-page">
        <div className="mp-welcome"><h1>医疗期测算</h1><p>核对基础医疗期额度，统计实际病休时间。</p></div>
        <p className="mp-intro">医疗期是停工治病期间的劳动合同保护期限。实际病休需依据医疗证明，医疗期届满后的解除仍需满足法定条件。</p>
        <section className="mp-parameters" aria-labelledby="mp-parameter-title">
          <header className="mp-panel-header"><div><h2 id="mp-parameter-title">测算条件</h2></div>{collapsed && <button type="button" className="mp-text-button" onClick={edit}>编辑条件</button>}</header>
          {collapsed && result && <div className="mp-condition-summary"><span>{result.regionLabel}</span><span>入职 {result.input.hireDate}</span>{result.input.region === 'national' && <span>累计工作{result.input.totalWorkYears}年</span>}<span>截止 {result.input.asOf}</span><span>{result.records.precision === 'summary' ? '汇总记录' : `${result.records.rows.length}段日期记录`}</span><span>{result.input.historyComplete ? '已勾选历史完整' : '历史完整性未确认'}</span></div>}
          <form ref={formRef} noValidate onSubmit={calculate} hidden={collapsed}>
            <fieldset className="mp-region-fields"><legend>适用规则</legend><div className="mp-region-grid">
              <Field name="region" label="适用地区" help="按劳动关系适用地区选择。" error={errorFor('region')} required><select {...inputProps('region', input.region, setRegion, 'select')}><option value="">请选择适用地区</option><option value="national">全国（非上海）</option><option value="shanghai">上海</option></select></Field>
              <p className="mp-region-hint">{isShanghai ? "上海按病休工作日核算" : input.region === "national" ? "全国基础规则；地方特殊规定需另行核对" : "全国（非上海）与上海分别计算"}</p>
            </div></fieldset>
            <fieldset className="mp-basic-fields"><legend>工作年限</legend><div className="mp-field-grid">
              <Field name="hireDate" label="本单位入职日期" help="填写本单位工作年限的起点。" error={errorFor('hireDate')} required><input {...inputProps('hireDate', input.hireDate, (value) => setField('hireDate', value))} /></Field>
              {input.region === 'national' && <Field name="totalWorkYears" label="累计工作年限（已满年数）" help={`按最早一段病休开始日填写，含以前单位工作年限${scopePreview ? `；参考起点${scopePreview.referenceDate || '待核对'}` : ''}。`} error={errorFor('totalWorkYears')} required><div className="mp-unit-input"><input {...inputProps('totalWorkYears', input.totalWorkYears, (value) => setField('totalWorkYears', value), 'number')} min="0" max="80" step="1" placeholder="已满年数" /><span>年</span></div></Field>}
              {(isShanghai || input.recordMode === 'summary') && <Field name="asOf" label="计算截止日期" help="填写要统计到哪一天。" error={errorFor('asOf')} required><input {...inputProps('asOf', input.asOf, (value) => setField('asOf', value))} /></Field>}
            </div></fieldset>
            <fieldset className={`mp-record-fields${isShanghai && input.recordMode === 'summary' ? ' mp-record-summary' : ''}`}>
              <legend>病休记录</legend>
              {isShanghai && input.recordMode === 'summary' && <div className="mp-field-grid">
                {isShanghai && input.recordMode === 'summary' && <Field name="summary.workDays" label="累计病休天数（工作日）" help="按本单位实际考勤累计，未知不要填0。" error={errorFor('summary.workDays')} required><div className="mp-unit-input"><input {...inputProps('summary.workDays', input.summary.workDays, (value) => setSummary('workDays', value), 'number')} min="0" step="0.01" placeholder="例如：20" /><span>天</span></div></Field>}
              {isShanghai && input.recordMode === 'summary' && <Field name="summary.firstDate" label="本单位首次病休日期" help="核对首次病休时的年限；未知可先核对基础额度。" error={errorFor('summary.firstDate')} required><input {...inputProps('summary.firstDate', input.summary.firstDate, (value) => setSummary('firstDate', value))} /></Field>}
              </div>}
              {isShanghai && <div className="mp-record-heading"><span>{input.recordMode === 'summary' ? '需要逐段核对？' : '有考勤汇总量？'}</span><button type="button" className="mp-text-button" onClick={() => setField('recordMode', input.recordMode === 'summary' ? 'intervals' : 'summary')}>{input.recordMode === 'summary' ? '填写实际日期段' : '填写累计病休天数'}</button></div>}
              {input.recordMode === 'intervals' ? <>
                <div className="mp-choice mp-choice-secondary" role="group" aria-label="病休类型"><button type="button" aria-pressed={input.leaveType === 'continuous'} disabled={input.segments.length > 1} onClick={() => setField('leaveType', 'continuous')}>连续病休</button><button type="button" aria-pressed={input.leaveType === 'segmented'} onClick={() => setField('leaveType', 'segmented')}>非连续分段</button></div>
                {input.segments.length > 1 && <p className="mp-field-help">切回连续前请核对多段记录，不会自动删减。</p>}
                {input.segments.map((row, index) => <div className={`mp-segment${input.leaveType === 'continuous' ? ' mp-segment-single' : ''}`} key={index}>{input.leaveType === 'segmented' && <div className="mp-segment-heading"><strong>第{index + 1}段病休</strong>{input.segments.length > 1 && <button type="button" className="mp-text-button" aria-label={`移除第${index + 1}段病休`} onClick={() => change((previous) => ({ ...previous, segments: previous.segments.filter((_, rowIndex) => rowIndex !== index) }))}><Trash2 size={14} />移除此段</button>}</div>}<div className={`mp-field-grid${isShanghai ? ' mp-three-fields' : ''}`}>
                  <Field name={`segments.${index}.startDate`} label="开始日期" help="本段实际病休的第一天，包含当天。" error={errorFor(`segments.${index}.startDate`)} required><input {...inputProps(`segments.${index}.startDate`, row.startDate, (value) => setSegment(index, 'startDate', value))} /></Field>
                  <Field name={`segments.${index}.endDate`} label="结束日期" help="本段实际病休的最后一天。" error={errorFor(`segments.${index}.endDate`)} required><input {...inputProps(`segments.${index}.endDate`, row.endDate, (value) => setSegment(index, 'endDate', value))} /></Field>
                  {isShanghai && <Field name={`segments.${index}.workDays`} label="实际病休工作日" help="按考勤填写；核对余额必填，未知可先核对基础额度。" error={errorFor(`segments.${index}.workDays`)} required><div className="mp-unit-input"><input {...inputProps(`segments.${index}.workDays`, row.workDays, (value) => setSegment(index, 'workDays', value), 'number')} min="0" step="0.01" placeholder="考勤天数" /><span>天</span></div></Field>}
                </div></div>)}
                {input.leaveType === 'segmented' && <button type="button" className="mp-add-button" onClick={() => change((previous) => ({ ...previous, segments: [...previous.segments, emptySegment()] }))}><Plus size={16} />添加一段病休</button>}
              </> : !isShanghai && <><p className="mp-field-help">仅记录汇总量，不补成连续病休。</p><div className="mp-field-grid">
                <Field name="summary.firstDate" label="本次核算起算病休日" help="填写本次累计期间的起点，需与相关病休历史一致。" error={errorFor('summary.firstDate')} required><input {...inputProps('summary.firstDate', input.summary.firstDate, (value) => setSummary('firstDate', value))} /></Field>
                <Field name="summary.naturalDays" label="累计病休自然日" help="填写原始资料中的实际累计量，不包括中间未病休的日期。" error={errorFor('summary.naturalDays')} required><div className="mp-unit-input"><input {...inputProps('summary.naturalDays', input.summary.naturalDays, (value) => setSummary('naturalDays', value), 'number')} min="1" step="1" /><span>天</span></div></Field>
              </div></>}
              {input.region && <p className="mp-field-help">{regionNotes[input.region]}</p>}
              {errorFor('segments') && <p className="mp-field-error">{errorFor('segments')}</p>}
              {input.region && <p className="mp-coverage-hint"><strong>本次核算范围</strong>{scopePreview ? scopePreview.scope : isShanghai ? '请核对本单位入职后至计算截止日的全部病休工作日，包括此前病休。' : '填写日期后说明本次参考起点和累计范围；此前相关病休也需录入。'}</p>}
              <label className="mp-check"><input type="checkbox" name="historyComplete" checked={input.historyComplete} aria-invalid={Boolean(errorFor('historyComplete'))} aria-describedby="mp-history-complete-help" onChange={(event) => setField('historyComplete', event.target.checked)} /><span>{isShanghai ? '已包含本单位期间的全部病休工作日' : '已包含相关病休历史，未遗漏更早的起算记录'}<small id="mp-history-complete-help">{isShanghai ? '累计工作日应包含以前病休；资料未齐可先核对基础额度。' : '如果此前还有影响本次核算的病休，请补充日期；不确定是否齐全时先不勾选。'}</small></span></label>
              {errorFor('historyComplete') && <p className="mp-field-error">{errorFor('historyComplete')}</p>}
            </fieldset>
            <details className="mp-supplementary"><summary>补充核对信息<span>{hasSupplementary ? '已补充' : '选填'}</span></summary><div>
              <div className="mp-field-grid">
                {input.region === 'national' && <Field name="locality" label="具体省市（备注）" help="仅保存地区备注，不会自动切换地方计算规则。"><input {...inputProps('locality', input.locality, (value) => setField('locality', value), 'text')} maxLength={100} placeholder="例如：浙江省杭州市" /></Field>}
                {!isShanghai && input.recordMode === 'intervals' && <Field name="asOf" label="病休统计截止日" help="默认取最晚一段结束日，需要其他统计日期再填写。" error={errorFor('asOf')}><input {...inputProps('asOf', input.asOf, (value) => setField('asOf', value))} /></Field>}
                {input.region === 'national' && <Field name="tenYearDate" label="累计工龄满10年的日期" help="用于核对病休期间跨档，未知可留空。" error={errorFor('tenYearDate')}><input {...inputProps('tenYearDate', input.tenYearDate, (value) => setField('tenYearDate', value))} /></Field>}
                {isShanghai && input.recordMode === 'summary' && <>
                  <Field name="summary.naturalDays" label="累计病休自然日" help="有自然日汇总资料再填，不用工作日倒推。" error={errorFor('summary.naturalDays')}><div className="mp-unit-input"><input {...inputProps('summary.naturalDays', input.summary.naturalDays, (value) => setSummary('naturalDays', value), 'number')} min="1" step="1" /><span>天</span></div></Field>
                </>}
              </div>
              <details className="mp-exceptions"><summary>特殊情形与更长约定</summary><div><label className="mp-check"><input type="checkbox" name="specialCircumstances" checked={input.specialCircumstances} onChange={(event) => setField('specialCircumstances', event.target.checked)} /><span>涉及特殊疾病、劳动能力鉴定、延长审批或更长约定<small>只展示基础参考与记录统计，延长期限交人工核对。</small></span></label><Field name="specialNote" label="补充说明" help="记录待核对事项，无需填写姓名、联系方式或诊断隐私。"><textarea {...inputProps('specialNote', input.specialNote, (value) => setField('specialNote', value), 'text')} rows={2} maxLength={1000} /></Field><p className="mp-field-help">因工负伤、职业病涉及其他规则，请另行核对。</p></div></details>
              {input.region === 'national' && <div className="mp-choice" role="group" aria-label="记录资料完整程度"><button type="button" aria-pressed={input.recordMode === 'intervals'} onClick={() => setField('recordMode', 'intervals')}>有实际日期段</button><button type="button" aria-pressed={input.recordMode === 'summary'} onClick={() => setField('recordMode', 'summary')}>只有首日与累计量</button></div>}
            </div></details>
            {errors.length > 0 && <div className="mp-error-banner" role="alert"><strong>请核对以下条件，输入已保留：</strong><ul>{errors.map((item, index) => <li key={`${item.field}-${index}`}><button type="button" onClick={() => focusField(item.field)}>{item.message}</button></li>)}</ul></div>}
            <footer className="mp-form-actions"><button type="button" className="mp-text-button" onClick={requestReset}>清空条件</button><span>{dirty ? '条件已修改，请重新计算' : '填写后查看结果与过程'}</span>{isShanghai && <button type="submit" className="mp-text-button" data-purpose="quota-only">仅核对基础额度</button>}<button type="submit" className="mp-primary"><Calculator size={17} />{dirty ? '重新计算' : '开始测算'}<ArrowRight size={16} /></button></footer>
          </form>
        </section>
        {notice && <p className="mp-notice" role="status"><Check size={16} />{notice}</p>}
        {storageError && <p className="mp-storage-error" role="status">{storageError}</p>}
        {result && <div ref={resultRef} tabIndex={-1} className="mp-result-container"><Result key={activeRecord} result={result} dirty={dirty} onEdit={edit} onCopy={copy} copyText={copyText} /></div>}
        {!result && <p className="mp-disclaimer">测算仅供参考，需结合实际资料核对。</p>}
      </div>
    </ContractWorkbenchLayout>
    {mobileSidebarOpen && <button type="button" className="mp-sidebar-backdrop" aria-label="关闭测算记录栏" onClick={() => { setMobileSidebarOpen(false); sidebarButtonRef.current?.focus() }} />}
    <dialog ref={resetRef} className="mp-reset-dialog" aria-labelledby="mp-reset-title"><div><h2 id="mp-reset-title">清空当前测算条件？</h2><button type="button" className="icon-button" aria-label="关闭清空确认" onClick={() => resetRef.current?.close()}><X size={18} /></button></div><p>当前条件和结果将清空，已保存的历史测算记录保留。</p><footer><button type="button" className="compact-button" onClick={() => resetRef.current?.close()}>取消</button><button type="button" className="mp-primary" onClick={reset}>清空条件</button></footer></dialog>
    <dialog ref={deleteRef} className="mp-reset-dialog" aria-labelledby="mp-delete-title"><div><h2 id="mp-delete-title">删除这条测算记录？</h2><button type="button" className="icon-button" aria-label="关闭删除确认" onClick={() => deleteRef.current?.close()}><X size={18} /></button></div><p>仅删除截止 {deletingRecord?.displayResult.input.asOf} 的这条历史记录，当前测算条件和结果保留。</p><footer><button type="button" className="compact-button" onClick={() => deleteRef.current?.close()}>取消</button><button type="button" className="mp-primary" onClick={confirmDelete}>删除记录</button></footer></dialog>
  </>
}

export default function MedicalCalculatorPage() {
  const { user } = useAuth()
  return user?.id === undefined || user?.id === null ? null : <MedicalCalculatorWorkspace key={user.id} userId={String(user.id)} />
}
