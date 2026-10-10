import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { useWorkspaceLayout } from '../components/WorkspaceContext'

const storeSymbol = Symbol.for('fafee.workspace.conversations')
let ownerWindow = window
try { if (window.parent.location.origin === window.location.origin) ownerWindow = window.parent } catch { /* An externally embedded app uses its own store. */ }
const stores = ownerWindow[storeSymbol] || (ownerWindow[storeSymbol] = new Map())

// Durable histories are shared across views; temporary chats use separate memory-only stores.
function getStore(key, initialize, serialize, persist = true) {
  if (stores.has(key)) return stores.get(key)
  let value = initialize()
  let lastSaved = null
  if (persist) { try { lastSaved = localStorage.getItem(key) } catch { /* Storage may be unavailable. */ } }
  const listeners = new Set()
  const notify = () => listeners.forEach((listener) => listener())
  const store = {
    getSnapshot: () => value,
    persist() {
      if (!persist) return
      try {
        lastSaved = JSON.stringify(serialize ? serialize(value) : value)
        localStorage.setItem(key, lastSaved)
      } catch { /* Keep the current chat usable. */ }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set(update) {
      // Read the latest persisted version before applying an update from either pane.
      if (persist) try {
        const raw = localStorage.getItem(key)
        if (raw !== lastSaved) {
          const saved = JSON.parse(raw || 'null')
          if (Array.isArray(saved) && saved.length) value = saved
          lastSaved = raw
        }
      } catch { /* Keep the in-memory history when storage is unavailable. */ }
      value = typeof update === 'function' ? update(value) : update
      store.persist()
      notify()
    }
  }
  if (persist) window.addEventListener('storage', (event) => {
    if (event.key !== key || !event.newValue) return
    try {
      const next = JSON.parse(event.newValue)
      if (Array.isArray(next) && next.length) { value = next; lastSaved = event.newValue; notify() }
    } catch { /* Ignore malformed external history. */ }
  })
  stores.set(key, store)
  return store
}

export function useSharedConversations(key, initialize, serialize, createTemporary) {
  const { isSideChat, initialConversationId } = useWorkspaceLayout()
  const storeKey = isSideChat ? `temporary:${key}:${initialConversationId}` : key
  const store = getStore(storeKey, isSideChat ? () => [{ ...createTemporary(), id: initialConversationId, messages: [] }] : initialize, serialize, !isSideChat)
  const value = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const setValue = useCallback((update) => store.set(update), [store])
  useEffect(() => { store.persist() }, [store])
  return [value, setValue]
}

// Loading and cancellation state belongs to the shared history, not an individual pane.
export function useSharedRequestState(historyKey) {
  const { isSideChat, initialConversationId } = useWorkspaceLayout()
  const store = getStore(`requests:${isSideChat ? `temporary:${historyKey}:${initialConversationId}` : historyKey}`, () => ({}), undefined, false)
  const value = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const owner = useRef(null)
  if (!owner.current) owner.current = crypto.randomUUID()
  const setValue = useCallback((update) => store.set((previous) => {
    const next = typeof update === 'function' ? update(previous) : update
    return Object.fromEntries(Object.entries(next).map(([id, request]) => [id, request.loading && !previous[id]?.loading ? { ...request, workspaceOwner: owner.current } : request]))
  }), [store])
  useEffect(() => {
    const release = () => store.set((items) => Object.fromEntries(Object.entries(items).map(([id, request]) => [id, request.workspaceOwner === owner.current ? { ...request, loading: false, cancelPending: false } : request])))
    window.addEventListener('pagehide', release)
    return () => { window.removeEventListener('pagehide', release); release() }
  }, [store])
  return [value, setValue]
}
