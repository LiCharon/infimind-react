import { useWorkspaceText } from './WorkspaceContext'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import gsap from 'gsap'

const movedPaths = (paths, from, to) => {
  const next = [...paths]
  next.splice(to, 0, next.splice(from, 1)[0])
  return next
}

export default function WorkspaceToolRail({ tools, pathname, onReorder, onNavigate }) {
  const t = useWorkspaceText()
  const navRef = useRef(null)
  const gesture = useRef(null)
  const previousPositions = useRef(null)
  const suppressClickUntil = useRef(0)
  const [dragging, setDragging] = useState(null)
  const [announcement, setAnnouncement] = useState('')
  const duration = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 0.16
  const getItems = () => [...navRef.current.querySelectorAll('[data-tool-path]')]

  // Preserve each icon's visible position when the new DOM order is committed.
  useLayoutEffect(() => {
    const items = getItems()
    gsap.killTweensOf(items)
    gsap.set(items, { x: 0, y: 0 })
    if (previousPositions.current) {
      items.forEach((item) => {
        const previous = previousPositions.current.get(item.dataset.toolPath)
        if (previous !== undefined) gsap.fromTo(item, { y: previous - item.getBoundingClientRect().top }, { y: 0, duration: duration(), ease: 'power2.out' })
      })
      previousPositions.current = null
    }
  }, [tools])

  const finish = useCallback((commit) => {
    const current = gesture.current
    if (!current) return
    gesture.current = null
    if (current.active) {
      suppressClickUntil.current = Date.now() + 500
      if (commit && current.to !== current.from) {
        previousPositions.current = new Map(current.items.map((item) => [item.dataset.toolPath, item.getBoundingClientRect().top]))
        onReorder(movedPaths(current.paths, current.from, current.to))
        setAnnouncement(`${current.label}已移至第 ${current.to + 1} 位`)
      } else {
        gsap.to(current.items, { x: 0, y: 0, duration: duration(), ease: 'power2.out', overwrite: true })
        setAnnouncement(commit ? '顺序未改变' : '已取消排序')
      }
      setDragging(null)
    }
    if (current.target.hasPointerCapture(current.pointerId)) current.target.releasePointerCapture(current.pointerId)
  }, [onReorder])

  useEffect(() => {
    const cancel = (event) => {
      if (event.type === 'blur' || event.key === 'Escape') finish(false)
    }
    window.addEventListener('keydown', cancel)
    window.addEventListener('blur', cancel)
    const nav = navRef.current
    return () => {
      window.removeEventListener('keydown', cancel)
      window.removeEventListener('blur', cancel)
      gesture.current = null
      gsap.killTweensOf(nav.querySelectorAll('[data-tool-path]'))
    }
  }, [finish])

  const start = (event, tool) => {
    if (!event.isPrimary || event.button !== 0 || tools.length < 2 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
    suppressClickUntil.current = 0
    const items = getItems()
    gsap.killTweensOf(items)
    gsap.set(items, { x: 0, y: 0 })
    const paths = tools.map((item) => item.path)
    const from = paths.indexOf(tool.path)
    gesture.current = {
      items, paths, from, to: from, label: tool.label, active: false,
      rects: items.map((item) => item.getBoundingClientRect()),
      x: event.clientX, y: event.clientY, pointerId: event.pointerId, target: event.currentTarget
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const move = (event) => {
    const current = gesture.current
    if (!current || current.pointerId !== event.pointerId) return
    const dy = event.clientY - current.y
    const dx = event.clientX - current.x
    if (!current.active) {
      if (Math.hypot(dx, dy) < 6) return
      current.active = true
      setDragging(current.paths[current.from])
      setAnnouncement(`正在移动${current.label}，按 Escape 取消`)
    }
    event.preventDefault()
    const original = current.rects[current.from]
    const y = Math.max(current.rects[0].top - original.top, Math.min(current.rects.at(-1).top - original.top, dy))
    const center = original.top + original.height / 2 + y
    const to = current.rects.reduce((nearest, rect, index, rects) => Math.abs(rect.top + rect.height / 2 - center) < Math.abs(rects[nearest].top + rects[nearest].height / 2 - center) ? index : nearest, 0)
    if (to !== current.to) {
      current.to = to
      const next = movedPaths(current.paths, current.from, to)
      current.items.forEach((item, index) => {
        if (index !== current.from) gsap.to(item, { y: current.rects[next.indexOf(item.dataset.toolPath)].top - current.rects[index].top, duration: duration(), ease: 'power2.out', overwrite: true })
      })
    }
    gsap.set(current.target, { y, x: Math.max(-4, Math.min(4, dx)) })
  }

  const keyboardMove = (event, tool) => {
    if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault()
    if (gesture.current) return
    const paths = tools.map((item) => item.path)
    const from = paths.indexOf(tool.path)
    const to = Math.max(0, Math.min(paths.length - 1, from + (event.key === 'ArrowUp' ? -1 : 1)))
    if (from === to) return
    previousPositions.current = new Map(getItems().map((item) => [item.dataset.toolPath, item.getBoundingClientRect().top]))
    onReorder(movedPaths(paths, from, to))
    setAnnouncement(`${tool.label}已移至第 ${to + 1} 位`)
  }

  return (
    <nav ref={navRef} className={`app-workspace-tools${dragging ? ' is-sorting' : ''}`} aria-label={t("功能导航")}>
      <span id="workspace-tool-sort-help" className="workspace-sort-sr-only">{t("拖动图标调整顺序，也可按住 Alt 加上下方向键移动，拖动时按 Escape 取消。")}</span>
      {tools.map((tool) => {
        const { label, icon: Icon, path, aliases } = tool
        const active = pathname === path || aliases.includes(pathname)
        return (
          <Link key={path} to={path} data-tool-path={path} draggable={false}
            className={`app-workspace-icon workspace-sortable-tool${active ? ' is-active' : ''}${dragging === path ? ' is-dragging' : ''}`}
            aria-label={label} aria-current={active ? 'page' : undefined} aria-describedby="workspace-tool-sort-help"
            onPointerDown={(event) => start(event, tool)} onPointerMove={move}
            onPointerUp={(event) => { if (gesture.current?.pointerId === event.pointerId) finish(true) }}
            onPointerCancel={() => finish(false)} onLostPointerCapture={() => finish(false)}
            onKeyDown={(event) => keyboardMove(event, tool)}
            onClick={(event) => {
              if (Date.now() < suppressClickUntil.current) { event.preventDefault(); return }
              onNavigate()
            }}>
            <Icon size={21} strokeWidth={1.7} aria-hidden="true" />
            <span className="app-workspace-tooltip" aria-hidden="true">{label}<small>{t("拖动排序")}</small></span>
          </Link>
        )
      })}
      <span className="workspace-sort-sr-only" role="status" aria-live="polite" aria-atomic="true">{t(announcement)}</span>
    </nav>
  )
}
