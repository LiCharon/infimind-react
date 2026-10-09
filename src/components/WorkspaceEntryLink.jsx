import { useRef } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight } from 'lucide-react'
import { gsap } from 'gsap'
import { useGSAP } from '@gsap/react'

gsap.registerPlugin(useGSAP)

export default function WorkspaceEntryLink({ onClick }) {
  const linkRef = useRef(null)

  useGSAP(() => {
    const media = gsap.matchMedia()
    media.add('(prefers-reduced-motion: no-preference)', () => {
      const link = linkRef.current
      const arrow = link.querySelector('.workspace-launch-arrow')
      const hover = gsap.to(arrow, { x: 2, y: -2, duration: 0.24, ease: 'power2.out', paused: true })
      let hovered = false
      let focused = false
      const updateHover = () => hovered || focused ? hover.play() : hover.reverse()
      const enter = (event) => {
        if (event.pointerType === 'touch') return
        hovered = true
        updateHover()
      }
      const leave = () => {
        hovered = false
        updateHover()
      }
      const focus = () => { focused = true; updateHover() }
      const blur = () => { focused = false; updateHover() }
      const listeners = { pointerenter: enter, pointerleave: leave, focus, blur, pointercancel: leave }
      Object.entries(listeners).forEach(([event, handler]) => link.addEventListener(event, handler))
      return () => {
        Object.entries(listeners).forEach(([event, handler]) => link.removeEventListener(event, handler))
        gsap.set(arrow, { clearProps: 'transform' })
      }
    })
    return () => media.revert()
  }, { scope: linkRef })

  return (
    <Link ref={linkRef} className="workspace-launch-link" to="/labor-consult" onClick={onClick}>
      <span className="workspace-launch-label">试用法飞飞</span>
      <span className="workspace-launch-arrow" aria-hidden="true"><ArrowUpRight size={16} strokeWidth={1.8} /></span>
    </Link>
  )
}
