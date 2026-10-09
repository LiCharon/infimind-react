import { useWorkspaceText } from './WorkspaceContext'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { MoreHorizontal, Pin } from 'lucide-react'
import gsap from 'gsap'

export default function WorkspaceToolsMenu({ tools, pinnedPaths, pathname, onTogglePin, onNavigate }) {
  const t = useWorkspaceText()
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const buttonRef = useRef(null)
  const menuRef = useRef(null)
  const activeInMenu = tools.some((tool) => !pinnedPaths.includes(tool.path) && (tool.path === pathname || tool.aliases.includes(pathname)))

  useLayoutEffect(() => {
    if (!open) return
    const position = () => {
      const menu = menuRef.current
      const anchor = rootRef.current.getBoundingClientRect()
      const height = menu.getBoundingClientRect().height
      menu.style.top = `${Math.max(8, Math.min(anchor.top, innerHeight - height - 8)) - anchor.top}px`
    }
    position()
    window.addEventListener('resize', position)
    return () => window.removeEventListener('resize', position)
  }, [open, pinnedPaths.length])

  useEffect(() => {
    if (!open) return
    const menu = menuRef.current
    const tween = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? null : gsap.fromTo(menu, { opacity: 0, x: -3 }, { opacity: 1, x: 0, duration: 0.14, ease: 'power2.out' })
    menu.querySelector('[role="menuitem"]')?.focus()
    const dismiss = (event) => {
      if (event.key === 'Escape') { setOpen(false); buttonRef.current?.focus() }
      else if (event.type === 'pointerdown' && !rootRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', dismiss)
    return () => {
      tween?.kill()
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', dismiss)
    }
  }, [open])

  const menuKeys = (event) => {
    const row = document.activeElement.closest('.workspace-tools-menu-row')
    if (event.key === 'ArrowRight') { event.preventDefault(); row?.querySelector('button')?.focus(); return }
    if (event.key === 'ArrowLeft') { event.preventDefault(); row?.querySelector('a')?.focus(); return }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const items = [...menuRef.current.querySelectorAll('[role="menuitem"]')]
    const current = items.indexOf(row?.querySelector('a'))
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[next]?.focus()
  }

  return (
    <div className={`workspace-tools-more${open ? ' is-open' : ''}`} ref={rootRef}>
      <button ref={buttonRef} type="button" className={`app-workspace-icon${activeInMenu ? ' is-active' : ''}`} aria-label={t("更多功能")} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? 'workspace-tools-menu' : undefined} onClick={() => setOpen((value) => !value)}>
        <MoreHorizontal size={20} strokeWidth={1.8} aria-hidden="true" />
        <span className="app-workspace-tooltip" aria-hidden="true">{t("更多功能")}</span>
      </button>
      {open && <div ref={menuRef} id="workspace-tools-menu" className="workspace-tools-menu" role="menu" aria-label={t("更多功能")} onKeyDown={menuKeys} onBlur={(event) => { if (!rootRef.current?.contains(event.relatedTarget)) setOpen(false) }}>
        {tools.map(({ label, path, icon: Icon, aliases }) => {
          const pinned = pinnedPaths.includes(path)
          const active = path === pathname || aliases.includes(pathname)
          return <div className={`workspace-tools-menu-row${active ? ' is-current' : ''}`} key={path}>
            <Link to={path} role="menuitem" aria-current={active ? 'page' : undefined} onClick={() => { setOpen(false); onNavigate() }}><Icon size={18} strokeWidth={1.7} aria-hidden="true" /><span>{label}</span></Link>
            <button type="button" role="menuitemcheckbox" aria-checked={pinned} aria-label={`${pinned ? t("取消固定") : t("固定到侧栏")}：${label}`} title={pinned ? t("取消固定到侧栏") : t("固定到侧栏")} onClick={() => onTogglePin(path)}><Pin size={14} fill={pinned ? 'currentColor' : 'none'} aria-hidden="true" /></button>
          </div>
        })}
      </div>}
    </div>
  )
}
