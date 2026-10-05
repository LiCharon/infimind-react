// Reduce persisted events without rendering each historical stage on refresh.
export function reduceLaborProgress(report, event, data = {}) {
  if (!['review.round', 'analysis.delta', 'review.delta', 'rewrite.result', 'analysis.section'].includes(event)
    && !(event === 'stage.complete' && data.stage === 'review')) return report
  const next = { ...report }
  if (event === 'review.round') {
    if (data.phase === 'start') next.activeReviewRound = Number(data.round) || 1
    if (data.phase === 'end') {
      next.activeReviewRound = null
      if (Number(data.newCount) === 0) next.reviewStoppedEarly = true
      const snapshot = { round: Number(data.round) || 0, newCount: Number(data.newCount) || 0, newFindings: Array.isArray(data.newFindings) ? data.newFindings : [] }
      next.reviewRounds = [...(next.reviewRounds || []).filter((item) => item.round !== snapshot.round), snapshot]
    }
  }
  if (event === 'stage.complete' && data.stage === 'review') next.reviewFinished = true
  if (event === 'analysis.delta' && typeof data.content === 'string') next.analysisOverview = data.replace ? data.content : `${next.analysisOverview || ''}${data.content}`
  if (event === 'review.delta' && typeof data.content === 'string') next.reviewReport = data.content
  if (event === 'rewrite.result') {
    next.revisions = Array.isArray(data.revisions) ? data.revisions : []
    next.revisionStats = data.stats || {}
  }
  if (event === 'analysis.section' && data.section && data.item !== undefined) {
    const { section, item } = data
    if (section === 'contractInfo' || section === 'agreementInfo') next[section] = { ...(next[section] || {}), ...item }
    else if (section === 'warnings') next.warnings = Array.isArray(item) ? item : []
    else {
      const list = Array.isArray(next[section]) ? next[section] : []
      const keyOf = (value) => value?.id || `${value?.topic || ''}|${value?.title || ''}|${value?.item || value?.title || value}`
      if (!list.some((value) => keyOf(value) === keyOf(item))) next[section] = [...list, item]
    }
  }
  return next
}
