import { randomUUID } from 'node:crypto'

const TTL_MS = 2 * 60 * 60 * 1000
const MAX_SESSIONS = 100
const sessions = new Map()

const prune = () => {
  const expiresBefore = Date.now() - TTL_MS
  for (const [id, session] of sessions) if (session.createdAt < expiresBefore) sessions.delete(id)
  while (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value)
}

export function createReviewSession({ contractText, analysisReport, reviewReport, reviewResult }) {
  prune()
  const id = randomUUID()
  const session = {
    id,
    createdAt: Date.now(),
    contractText,
    analysisReport,
    reviewReport,
    documentHash: reviewResult.documentHash,
    findings: reviewResult.findings,
    unresolved: reviewResult.unresolved,
    stats: reviewResult.stats
  }
  sessions.set(id, session)
  return session
}

export function getReviewSession(id) {
  prune()
  return typeof id === 'string' ? sessions.get(id) || null : null
}

export function publicReviewSession(session) {
  return {
    id: session.id,
    documentHash: session.documentHash,
    findings: session.findings,
    unresolved: session.unresolved,
    stats: session.stats
  }
}
