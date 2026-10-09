import { useWorkspaceText } from './WorkspaceContext'
import { useEffect, useId, useRef, useState } from 'react'
import { ChevronDown, ExternalLink, Gauge, Loader2, RefreshCw } from 'lucide-react'
import gsap from 'gsap'
import { authFetch } from '../utils/auth-api.js'

export default function AccountUsagePanel() {
  const t = useWorkspaceText()
  const [expanded, setExpanded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [data, setData] = useState(null)
  const requestRef = useRef(null)
  const contentRef = useRef(null)
  const contentId = useId()
  const cnyBalance = data?.balances?.find((item) => item.currency === 'CNY')

  useEffect(() => () => requestRef.current?.abort(), [])
  useEffect(() => {
    if (!expanded || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const tween = gsap.fromTo(contentRef.current, { opacity: 0, y: -3 }, { opacity: 1, y: 0, duration: 0.14, ease: 'power2.out' })
    return () => tween.kill()
  }, [expanded])

  const loadBalance = async () => {
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
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
    <details className="workspace-account-usage" onToggle={(event) => {
      const open = event.currentTarget.open
      setExpanded(open)
      if (open && !data && !loading) void loadBalance()
    }}>
      <summary aria-controls={contentId}>
        <Gauge size={18} strokeWidth={1.7} aria-hidden="true" /><span>{t("剩余用量")}</span>
        <ChevronDown className="workspace-usage-chevron" size={17} aria-hidden="true" />
      </summary>
      <div className="workspace-usage-content" id={contentId} ref={contentRef}>
        {loading && !data && <p className="workspace-usage-state" role="status"><Loader2 size={14} className="workspace-usage-spinner" aria-hidden="true" />{t("正在查询剩余用量…")}</p>}
        {error && <p className="workspace-usage-error" role="alert">{error}</p>}
        {!loading && !error && data && !cnyBalance && <p className="workspace-usage-state">{t("暂未返回人民币用量。")}</p>}
        {!error && cnyBalance && <dl className="workspace-usage-balances">
          <div className="workspace-usage-total"><dt>{t("人民币")}</dt><dd>¥ {cnyBalance.total}</dd></div>
          <div><dt>{t("充值用量")}</dt><dd>¥ {cnyBalance.toppedUp}</dd></div>
          <div><dt>{t("赠送用量")}</dt><dd>¥ {cnyBalance.granted}</dd></div>
        </dl>}
        {!loading && !error && cnyBalance && <p className={`workspace-usage-availability ${data.isAvailable ? 'is-available' : 'is-unavailable'}`} role="status">{data.isAvailable ? t("当前用量可正常使用") : t("当前用量不足，暂不可使用")}</p>}
        <div className="workspace-usage-actions">
          <button type="button" onClick={loadBalance} disabled={loading} aria-label={t("刷新用量")}><RefreshCw size={14} className={loading ? 'workspace-usage-spinner' : ''} aria-hidden="true" /><span>{loading ? t("查询中…") : t("刷新")}</span></button>
          <a href="https://platform.deepseek.com/" target="_blank" rel="noreferrer">{t("充值用量")}<ExternalLink size={14} aria-hidden="true" /></a>
        </div>
      </div>
    </details>
  )
}
