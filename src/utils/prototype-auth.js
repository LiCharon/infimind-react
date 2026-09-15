export const PROTOTYPE_AUTH_KEY = 'fafee-prototype-user-v1'

export function getPrototypeUser() {
  try {
    return JSON.parse(window.localStorage.getItem(PROTOTYPE_AUTH_KEY) || 'null')
  } catch {
    return null
  }
}

export function savePrototypeUser(user) {
  window.localStorage.setItem(PROTOTYPE_AUTH_KEY, JSON.stringify(user))
  window.dispatchEvent(new Event('fafee-auth-change'))
}

export function clearPrototypeUser() {
  window.localStorage.removeItem(PROTOTYPE_AUTH_KEY)
  window.dispatchEvent(new Event('fafee-auth-change'))
}

export function toolEntryPath(path) {
  if (getPrototypeUser()) return path
  return `/auth?mode=login&redirect=${encodeURIComponent(path)}`
}
