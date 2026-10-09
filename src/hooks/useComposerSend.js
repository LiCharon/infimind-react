import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { useWorkspaceLayout } from '../components/WorkspaceContext'
import { useAuth } from '../components/AuthProvider'

const queuesSymbol = Symbol.for('fafee.workspace.send-queues')
const empty = []
function queueStore(key) {
  let owner = window
  try { if (window.parent.location.origin === window.location.origin) owner = window.parent } catch { /* Cross-origin isolation. */ }
  const queues = owner[queuesSymbol] || (owner[queuesSymbol] = new Map())
  if (!queues.has(key)) {
    let items = empty
    const listeners = new Set()
    queues.set(key, { getSnapshot: () => items, subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener) }, set: (update) => { items = update(items); listeners.forEach((listener) => listener()) } })
  }
  return queues.get(key)
}
// Drafts and File objects stay in memory, including while another tool is selected.
// A queue is never serialized into conversation history or browser storage.
export function useComposerSend({ tool, conversationId, busy, blocked = false, capture, clear, onSend, onStop }) {
  const { settings, isSideChat, initialConversationId, t } = useWorkspaceLayout()
  const { user } = useAuth()
  const store = queueStore(`${user.id}:${tool}:${isSideChat ? initialConversationId : 'main'}:${conversationId || 'new'}`)
  const queued = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const latest = useRef(null)
  useLayoutEffect(() => { latest.current = { busy, blocked, onSend } })
  useEffect(() => {
    if (busy || blocked || store.draining || !queued.length) return
    // Restored background requests register before an automatic send is attempted.
    const timer = setTimeout(() => {
      if (latest.current.busy || latest.current.blocked || store.draining) return
      store.draining = true
      const next = store.getSnapshot()[0]
      if (!next) { store.draining = false; return }
      store.set((items) => items.filter((item) => item.id !== next.id))
      Promise.resolve(latest.current.onSend(next.snapshot)).catch(() => {}).finally(() => { store.draining = false; store.set((items) => [...items]) })
    }, 0)
    return () => clearTimeout(timer)
  }, [busy, blocked, queued, store])
  const send = () => {
    if (blocked) return
    const snapshot = capture()
    if (!snapshot.text.trim() && !snapshot.files.length) { if (busy) Promise.resolve(onStop?.()).catch(() => {}); return }
    if (busy || store.draining || queued.length) {
      store.set((items) => [...items, { id: crypto.randomUUID(), snapshot }])
      clear()
      if (busy && settings.busySend === 'interrupt') Promise.resolve(onStop?.()).catch(() => {})
    } else Promise.resolve(onSend()).catch(() => {})
  }
  return { send, queued, remove: (id) => store.set((items) => items.filter((item) => item.id !== id)), label: busy && (capture().text.trim() || capture().files.length) ? t(settings.busySend === 'queue' ? '排队发送' : '插话发送') : '', t }
}
