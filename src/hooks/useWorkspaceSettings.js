import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'

export const DEFAULT_SHORTCUTS = { search: 'k', newChat: 'n', history: 'b', settings: ',' }
export const DEFAULT_SETTINGS = { language: 'zh-CN', appearance: 'system', fontSize: 16, steps: 'standard', analysisPanel: true, sendKey: 'enter', shortcuts: DEFAULT_SHORTCUTS, links: 'new-tab', busySend: 'interrupt' }
const enumValue = (value, allowed, fallback) => allowed.includes(value) ? value : fallback
export function normalizeSettings(value = {}) {
  value = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const shortcuts = { ...DEFAULT_SHORTCUTS }
  for (const action of Object.keys(shortcuts)) shortcuts[action] = enumValue(value.shortcuts?.[action], ['k', 'n', 'b', ',', 'j', 'h', 's', 'disabled'], shortcuts[action])
  const used = new Set()
  for (const action of Object.keys(shortcuts)) {
    if (shortcuts[action] !== 'disabled' && used.has(shortcuts[action])) shortcuts[action] = 'disabled'
    used.add(shortcuts[action])
  }
  return {
    language: enumValue(value.language, ['zh-CN', 'en'], DEFAULT_SETTINGS.language),
    appearance: enumValue(value.appearance, ['light', 'dark', 'system'], DEFAULT_SETTINGS.appearance),
    fontSize: Number.isFinite(value.fontSize) ? Math.round(Math.min(24, Math.max(12, value.fontSize))) : DEFAULT_SETTINGS.fontSize,
    steps: enumValue(value.steps, ['compact', 'standard', 'detailed'], DEFAULT_SETTINGS.steps),
    analysisPanel: typeof value.analysisPanel === 'boolean' ? value.analysisPanel : DEFAULT_SETTINGS.analysisPanel,
    sendKey: enumValue(value.sendKey, ['enter', 'command-enter'], DEFAULT_SETTINGS.sendKey),
    shortcuts, links: enumValue(value.links, ['new-tab', 'current-tab'], DEFAULT_SETTINGS.links),
    busySend: enumValue(value.busySend, ['interrupt', 'queue'], DEFAULT_SETTINGS.busySend)
  }
}
function ownerWindow() {
  try { if (window.parent.location.origin === window.location.origin) return window.parent } catch { /* Other origins keep separate preferences. */ }
  return window
}
const symbol = Symbol.for('fafee.workspace.settings')
function getStore(userId) {
  const owner = ownerWindow()
  const stores = owner[symbol] || (owner[symbol] = new Map())
  const key = `fafee-workspace-settings-v1:${userId}`
  if (!stores.has(key)) {
    const read = () => { try { return normalizeSettings(JSON.parse(owner.localStorage.getItem(key) || '{}')) } catch { return normalizeSettings() } }
    let snapshot = read()
    const listeners = new Set()
    const emit = () => listeners.forEach((listener) => listener())
    owner.addEventListener('storage', (event) => { if (event.key === key || event.key === null) { snapshot = read(); emit() } })
    stores.set(key, {
      getSnapshot: () => snapshot,
      subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
      update: (patch) => {
        snapshot = normalizeSettings({ ...snapshot, ...patch })
        try { owner.localStorage.setItem(key, JSON.stringify(snapshot)) } catch { /* Still works during this session. */ }
        emit()
      }
    })
  }
  return stores.get(key)
}
export function useWorkspaceSettings(userId) {
  const store = getStore(userId)
  const settings = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const sync = () => setSystemDark(media.matches)
    media.addEventListener('change', sync)
    sync()
    return () => media.removeEventListener('change', sync)
  }, [])
  const updateSettings = useCallback((patch) => store.update(patch), [store])
  return { settings, updateSettings, theme: settings.appearance === 'system' ? (systemDark ? 'dark' : 'light') : settings.appearance }
}
