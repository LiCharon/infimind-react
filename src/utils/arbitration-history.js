// Server tasks are authoritative; local ids are retained only for UI continuity.
export function resolveArbitrationAction(messages = [], explicitAction = '') {
  if (explicitAction) return explicitAction
  // A cancelled accepted turn still has material and user context on the server.
  // Its replacement is a follow-up, even when the first analysis never finished.
  return messages.some((message) => message.type === 'assistant'
    && (message.result || (message.stopped && message.taskId))) ? 'followup' : 'analyze'
}

export function isArbitrationDraftStale(result, latestRecord, materials = []) {
  if (!result?.defenseDraft) return false
  if (result.draftBasis && latestRecord && (result.draftBasis.caseVersion !== latestRecord.version
    || result.draftBasis.materialSignature !== latestRecord.materialSignature)) return true
  if (result.caseRecord && materials.length) {
    const before = (result.caseRecord.sources || []).filter((source) => source.kind === 'document').map((source) => source.fileId).filter(Boolean).sort()
    const current = materials.filter((material) => material.enabled && material.available).map((material) => material.id).sort()
    if (JSON.stringify(before) !== JSON.stringify(current)) return true
  }
  return Boolean(!result.draftBasis && latestRecord)
}

export function restoreArbitrationConversation(conversation, tasks, materials = []) {
  const local = conversation.messages || []
  const messages = []
  let version = 0
  for (const task of tasks) {
    const assistant = local.find((message) => message.type === 'assistant' && message.taskId === task.id)
    const result = task.status === 'succeeded' ? task.result : null
    const files = materials.filter((material) => material.sourceTaskId === task.id)
    messages.push({ id: `user-${task.id}`, type: 'user', taskId: task.id, content: task.prompt || '请分析上传材料。', files: files.length ? files.map((file) => ({ name: file.name, size: file.size || 0 })) : (task.files || []).map((file) => ({ name: file.originalName, size: file.size })) })
    messages.push({ ...assistant, id: assistant?.id || `assistant-${task.id}`, type: 'assistant', taskId: task.id, result,
      version: result?.defenseDraft ? ++version : undefined,
      status: ['succeeded', 'failed', 'cancelled'].includes(task.status) ? '' : '正在恢复任务进度…',
      recoverable: false, stopped: task.status === 'cancelled', failed: task.status === 'failed',
      error: task.status === 'failed' ? task.errorSummary || '本次任务未完成。' : '' })
  }
  // Keep explicitly failed local submissions; uncertain submissions are reconciled to server tasks.
  for (const message of local.filter((item) => item.type === 'assistant' && item.failed && !item.taskId)) {
    const user = local.find((item) => item.id === message.userMessageId) || local[local.indexOf(message) - 1]
    if (user?.type === 'user') messages.push(user)
    messages.push(message)
  }
  const latest = tasks.at(-1)
  const title = tasks.find((task) => task.result?.conversationTitle)?.result?.conversationTitle
  return { ...conversation, messages, materials, title: title || latest?.title || conversation.title,
    titleGenerated: Boolean(title || conversation.titleGenerated), resultExpiresAt: latest?.resultExpiresAt ?? null,
    retentionPolicy: latest?.retentionPolicy, updatedAt: latest ? new Date(latest.createdAt).getTime() : conversation.updatedAt }
}
