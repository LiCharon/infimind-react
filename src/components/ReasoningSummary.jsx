import { useEffect, useId, useRef } from 'react'
import { ChevronDown, PenLine } from 'lucide-react'
import gsap from 'gsap'
import { useWorkspaceText } from './WorkspaceContext'
import './ReasoningSummary.css'

const LIVE_REASONING_WINDOW = 20000

// Only inspect a bounded excerpt on each stream update, even for very long analyses.
function getExcerpt(text, live) {
  const excerpt = live ? text.slice(-320) : text.slice(0, 320)
  const lines = excerpt.split('\n').map(line => line.trim()).filter(Boolean)
  const line = (live ? lines[lines.length - 1] : lines[0]) || ''
  return line.replace(/^#{1,6}\s*/, '').replace(/[*`_]/g, '').replace(/\s+/g, ' ').trim()
}

export default function ReasoningSummary({ text, live, open, onToggle }) {
  const t = useWorkspaceText()
  const bodyId = useId()
  const headRef = useRef(null)
  const iconRef = useRef(null)
  const bodyRef = useRef(null)
  const stickRef = useRef(true)
  const streaming = live && open && text.length > LIVE_REASONING_WINDOW
  const shown = streaming ? text.slice(-LIVE_REASONING_WINDOW) : text
  const excerpt = getExcerpt(text, live)

  useEffect(() => {
    if (!live) return
    const media = gsap.matchMedia()
    media.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.to(iconRef.current, { opacity: 0.65, duration: 0.75, repeat: -1, yoyo: true, ease: 'sine.inOut' })
    })
    return () => media.revert()
  }, [live])

  useEffect(() => {
    if (!open) return
    const media = gsap.matchMedia()
    media.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.fromTo(bodyRef.current, { opacity: 0, y: 3 }, { opacity: 1, y: 0, duration: 0.16, clearProps: 'opacity,transform', ease: 'power2.out' })
    })
    return () => media.revert()
  }, [open])

  useEffect(() => {
    if (!live || !open) return
    const body = bodyRef.current
    const handle = requestAnimationFrame(() => {
      if (body && stickRef.current) body.scrollTop = body.scrollHeight
    })
    return () => cancelAnimationFrame(handle)
  }, [text, live, open])

  const handleScroll = () => {
    const body = bodyRef.current
    if (body) stickRef.current = body.scrollHeight - body.scrollTop - body.clientHeight < 24
  }

  const collapse = () => {
    onToggle()
    headRef.current?.focus()
  }

  return (
    <section className={`labor-reasoning${live ? ' is-live' : ''}${open ? ' is-open' : ''}`}>
      <button type="button" className="labor-reasoning-head" ref={headRef} onClick={onToggle} aria-expanded={open} aria-controls={open ? bodyId : undefined} aria-label={t(open ? '收起分析记录' : '展开分析记录')}>
        <span className="reasoning-icon" ref={iconRef} aria-hidden="true"><PenLine size={17} strokeWidth={1.8} /></span>
        <span className="reasoning-label">{t(live ? '正在分析' : '分析记录')}</span>
        <span className="reasoning-excerpt" aria-hidden="true">{excerpt}</span>
        <ChevronDown size={15} className={`reasoning-chevron${open ? ' open' : ''}`} aria-hidden="true" />
      </button>
      {open && (
        <div className="reasoning-details" id={bodyId}>
          <div className="labor-reasoning-body" ref={bodyRef} onScroll={handleScroll} tabIndex={0} role="region" aria-label={t('分析内容')}>
            {streaming && <p className="reasoning-window-note">{t('…已折叠前')}{text.length - LIVE_REASONING_WINDOW}{t('字，完整思考在结束后可回看')}</p>}
            {shown}
          </div>
          <button type="button" className="reasoning-collapse" onClick={collapse} aria-label={t('收起分析记录')}>{t('收起')}</button>
        </div>
      )}
    </section>
  )
}
