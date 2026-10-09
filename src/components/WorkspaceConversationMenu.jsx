import { useWorkspaceText } from './WorkspaceContext'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Archive, MessageCirclePlus, MoreHorizontal, Pencil, Pin, PinOff, X } from 'lucide-react'
import gsap from 'gsap'

export default function WorkspaceConversationMenu({ actions, contextRequest, onCreateSide }) {
  const t = useWorkspaceText()
  const [open, setOpen] = useState(false)
  const [contextTarget, setContextTarget] = useState(null)
  const [renaming, setRenaming] = useState(null)
  const [title, setTitle] = useState('')
  const rootRef = useRef(null)
  const buttonRef = useRef(null)
  const menuRef = useRef(null)
  const inputRef = useRef(null)
  const dialogRef = useRef(null)
  const previousId = useRef(actions?.id)
  const menuActions = contextTarget?.actions || actions
  const closeMenu = useCallback(() => { setOpen(false); setContextTarget(null) }, [])
  const focusTrigger = () => (contextTarget?.trigger || buttonRef.current)?.focus({ preventScroll: true })

  useEffect(() => {
    if (!contextRequest) return
    setContextTarget(contextRequest)
    setOpen(true)
    setRenaming(null)
  }, [contextRequest])

  useLayoutEffect(() => {
    if (!open || !contextTarget || !menuRef.current) return
    const menu = menuRef.current
    const margin = 8
    menu.style.left = `${Math.max(margin, Math.min(contextTarget.x, window.innerWidth - menu.offsetWidth - margin))}px`
    menu.style.top = `${Math.max(margin, Math.min(contextTarget.y, window.innerHeight - menu.offsetHeight - margin))}px`
  }, [open, contextTarget])

  useEffect(() => {
    if (previousId.current !== actions?.id) {
      closeMenu()
      setRenaming(null)
      previousId.current = actions?.id
    }
  }, [actions?.id, closeMenu])

  useEffect(() => {
    if (!open) return
    const menu = menuRef.current
    const tween = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? null : gsap.fromTo(menu, { opacity: 0, y: -4 }, { opacity: 1, y: 0, duration: 0.14, ease: 'power2.out' })
    menu.querySelector('button:not(:disabled)')?.focus({ preventScroll: true })
    const close = (event) => {
      if (event.type === 'pointerdown' && !rootRef.current?.contains(event.target)) closeMenu()
      if (event.key === 'Escape') { closeMenu(); (contextTarget?.trigger || buttonRef.current)?.focus({ preventScroll: true }) }
      if (event.type === 'resize' || (event.type === 'scroll' && !menu.contains(event.target))) closeMenu()
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', close)
    window.addEventListener('resize', close)
    document.addEventListener('scroll', close, true)
    return () => {
      tween?.kill()
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', close)
      window.removeEventListener('resize', close)
      document.removeEventListener('scroll', close, true)
    }
  }, [open, contextTarget, closeMenu])

  useEffect(() => {
    if (renaming) { inputRef.current?.focus(); inputRef.current?.select() }
  }, [renaming])

  const run = (action) => { closeMenu(); action?.(); focusTrigger() }
  const moveFocus = (event) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const items = [...menuRef.current.querySelectorAll('button:not(:disabled)')]
    const current = items.indexOf(document.activeElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[next]?.focus()
  }
  const closeRename = () => { setRenaming(null); (renaming?.trigger || buttonRef.current)?.focus({ preventScroll: true }) }
  const dialogKeys = (event) => {
    if (event.key === 'Escape') { event.preventDefault(); closeRename() }
    if (event.key === 'Tab') {
      const controls = [...dialogRef.current.querySelectorAll('button:not(:disabled), input')]
      const first = controls[0], last = controls.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
  }

  return (
    <div className="workspace-conversation-menu" ref={rootRef}>
      <button ref={buttonRef} type="button" className={`app-workspace-icon workspace-more-button${open && !contextTarget ? ' is-open' : ''}`} aria-label={t("会话选项")} aria-haspopup="menu" aria-expanded={open && !contextTarget} aria-controls={open && !contextTarget ? 'workspace-conversation-menu' : undefined} onClick={() => { setContextTarget(null); setOpen(!open || Boolean(contextTarget)) }}>
        <MoreHorizontal size={21} strokeWidth={1.8} aria-hidden="true" />
      </button>
      {open && <div ref={menuRef} id="workspace-conversation-menu" className={`workspace-menu-panel${contextTarget ? ' workspace-history-menu' : ''}`} style={contextTarget ? { left: contextTarget.x, top: contextTarget.y } : undefined} role="menu" aria-label={t("会话选项")} onKeyDown={moveFocus} onBlur={(event) => { if (!rootRef.current?.contains(event.relatedTarget)) closeMenu() }}>
        <button type="button" role="menuitem" disabled={!menuActions?.id} onClick={() => run(() => { setTitle(menuActions.title); setRenaming({ actions: menuActions, trigger: contextTarget?.trigger || buttonRef.current }) })}><Pencil size={18} aria-hidden="true" /><span>{t("重命名")}</span></button>
        <button type="button" role="menuitem" disabled={!menuActions?.id} onClick={() => run(menuActions?.togglePin)}>{menuActions?.pinned ? <PinOff size={18} aria-hidden="true" /> : <Pin size={18} aria-hidden="true" />}<span>{menuActions?.pinned ? t("取消置顶") : t("置顶")}</span></button>
        <div className="workspace-menu-rule" role="separator" />
        <button type="button" role="menuitem" onClick={() => run(onCreateSide)}><MessageCirclePlus size={18} aria-hidden="true" /><span>{t("新建侧边聊天")}</span></button>
        <div className="workspace-menu-rule" role="separator" />
        <button type="button" role="menuitem" disabled={!menuActions?.id} onClick={() => run(menuActions?.toggleArchive)}><Archive size={18} aria-hidden="true" /><span>{menuActions?.archived ? t("取消归档") : t("归档")}</span></button>
      </div>}
      {renaming && <div className="workspace-dialog-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) closeRename() }}>
        <form ref={dialogRef} className="workspace-rename-dialog" role="dialog" aria-modal="true" aria-labelledby="workspace-rename-title" onKeyDown={dialogKeys} onSubmit={(event) => { event.preventDefault(); if (title.trim()) { renaming.actions.rename(title.trim()); closeRename() } }}>
          <div className="workspace-dialog-heading"><h2 id="workspace-rename-title">{t("重命名会话")}</h2><button type="button" aria-label={t("关闭重命名")} onClick={closeRename}><X size={19} /></button></div>
          <label htmlFor="workspace-conversation-name">{t("会话名称")}</label>
          <input ref={inputRef} id="workspace-conversation-name" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} autoComplete="off" />
          <div className="workspace-dialog-actions"><button type="button" onClick={closeRename}>{t("取消")}</button><button type="submit" disabled={!title.trim()}>{t("保存")}</button></div>
        </form>
      </div>}
    </div>
  )
}
