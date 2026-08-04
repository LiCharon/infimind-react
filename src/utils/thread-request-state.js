export const EMPTY_THREAD_REQUEST = Object.freeze({
  loading: false,
  stage: '',
  error: '',
  mode: 'thinking'
})

export function getThreadRequestState(requests, threadId) {
  if (!threadId || !requests || typeof requests !== 'object') return EMPTY_THREAD_REQUEST
  return requests[threadId] || EMPTY_THREAD_REQUEST
}

export function patchThreadRequestState(requests, threadId, patch) {
  if (!threadId) return requests
  const current = getThreadRequestState(requests, threadId)
  const nextPatch = typeof patch === 'function' ? patch(current) : patch
  return {
    ...requests,
    [threadId]: { ...current, ...(nextPatch || {}) }
  }
}

export function isThreadRequestRunning(requests, threadId) {
  return Boolean(getThreadRequestState(requests, threadId).loading)
}
