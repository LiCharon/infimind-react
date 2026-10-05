import React, { useEffect, useRef, useState } from 'react'
import { ChevronDown, CircleDollarSign, ExternalLink, Loader2, RefreshCw, X } from 'lucide-react'
import { authFetch } from '../utils/auth-api.js'

// 沿用用工咨询的用量面板、账号接口和工作台公共样式。
export default function ToolAccountPanel({ label }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [data, setData] = useState(null)
  const request = useRef(null)
  const container = useRef(null)
  const cnyBalance = data?.balances?.find((item) => item.currency === 'CNY')

  useEffect(() => () => request.current?.abort(), [])
  useEffect(() => {
    if (!open) return
    const close = (event) => {
      if (event.key === 'Escape' || (event.type === 'pointerdown' && !container.current?.contains(event.target))) setOpen(false)
    }
    document.addEventListener('keydown', close)
    document.addEventListener('pointerdown', close)
    return () => {
      document.removeEventListener('keydown', close)
      document.removeEventListener('pointerdown', close)
    }
  }, [open])

  const loadBalance = async () => {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setLoading(true)
    setError('')
    try {
      const response = await authFetch('/api/account/balance', { headers: { Accept: 'application/json' }, cache: 'no-store', signal: controller.signal })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || '暂时无法读取剩余用量。')
      if (!controller.signal.aborted) setData(payload)
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure.message || '暂时无法读取剩余用量。')
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }

  return (
    <div className="sidebar-footer-wrap" ref={container}>
      {open && (
        <section className="balance-popover" role="dialog" aria-label="剩余用量">
          <header>
            <span className="footer-avatar">法</span><strong>{label}</strong>
            <button type="button" aria-label="关闭用量面板" onClick={() => setOpen(false)}><X size={16} /></button>
          </header>
          <div className="balance-title">
            <CircleDollarSign size={19} /><strong>剩余用量</strong>
            <button type="button" className="balance-refresh" onClick={loadBalance} disabled={loading} aria-label="刷新用量" title="刷新用量">
              <RefreshCw size={16} className={loading ? 'spinner' : ''} />
            </button>
          </div>
          {loading && !data && <p className="balance-state"><Loader2 size={15} className="spinner" />正在查询剩余用量…</p>}
          {error && <p className="balance-error" role="alert">{error}</p>}
          {!loading && !error && data && !cnyBalance && <p className="balance-state">暂未返回人民币用量。</p>}
          {!error && cnyBalance && (
            <section className="balance-summary">
              <div className="balance-summary-head"><span>当前剩余用量</span></div>
              <div className="balance-list"><div className="balance-item">
                <div><span>人民币</span><b>¥ {cnyBalance.total}</b></div>
                <p>充值用量 ¥ {cnyBalance.toppedUp} · 赠送用量 ¥ {cnyBalance.granted}</p>
              </div></div>
            </section>
          )}
          {!loading && !error && cnyBalance && <small className={data.isAvailable ? 'balance-available' : 'balance-unavailable'}>{data.isAvailable ? '当前用量可正常使用' : '当前用量不足，暂不可使用'}</small>}
          <a className="balance-top-up" href="https://platform.deepseek.com/" target="_blank" rel="noreferrer">充值用量<ExternalLink size={14} /></a>
        </section>
      )}
      <button type="button" className="sidebar-footer account-trigger" onClick={() => { if (!open) loadBalance(); setOpen(!open) }} aria-expanded={open} aria-label={label}>
        <span className="footer-avatar">法</span><span>{label}</span>
        <ChevronDown size={17} className={open ? 'balance-chevron open' : 'balance-chevron'} />
      </button>
    </div>
  )
}
