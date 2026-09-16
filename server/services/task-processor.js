import { TaskCancelledError, runContractReview } from '../workflows/contract-review.js'

const transientPatterns = [
  /timeout/i,
  /timed out/i,
  /temporar/i,
  /rate.?limit/i,
  /too many requests/i,
  /network/i,
  /econnreset/i,
  /eai_again/i,
  /503/,
  /502/,
  /504/
]

const isTransient = (error) => Boolean(error?.retryable || transientPatterns.some((pattern) => pattern.test(String(error?.message || error))))

export function createTaskProcessor({ taskService, fileStore, fakeLlm = String(process.env.TASK_FAKE_LLM || '').toLowerCase() === 'true' } = {}) {
  if (!taskService || !fileStore) throw new Error('task processor requires taskService and fileStore')

  const processTask = async (taskId) => {
    let task = taskService.getTaskInternal(taskId, false)
    if (!task || taskService.isTerminal(task.status)) return task
    if (task.status === 'queued' || task.status === 'retry_waiting') task = taskService.claimTask(taskId)
    if (!task) return taskService.getTaskInternal(taskId, false)
    if (task.status === 'cancel_requested' || task.status === 'cancelled') return taskService.markCancelled(taskId)

    const emit = (event, payload = {}) => taskService.appendEvent(taskId, event, payload, payload.stage || null)
    const checkpoint = (stage, result) => taskService.saveCheckpoint(taskId, stage, result)
    const getCheckpoint = (stage) => taskService.getCheckpoint(taskId, stage)
    const isCancellationRequested = () => taskService.isCancellationRequested(taskId)

    try {
      const files = await fileStore.readFiles(taskService.getFiles(taskId))
      const result = await runContractReview({
        task,
        files,
        emit,
        checkpoint,
        getCheckpoint,
        isCancellationRequested,
        updateFileParseStatus: (fileId, status) => taskService.updateFileParseStatus(fileId, status),
        fakeLlm
      })
      if (isCancellationRequested()) return taskService.markCancelled(taskId)
      return taskService.completeTask(taskId, result)
    } catch (error) {
      if (error instanceof TaskCancelledError || error?.code === 'TASK_CANCELLED' || isCancellationRequested()) {
        return taskService.markCancelled(taskId, 'user_requested')
      }
      const current = taskService.getTaskInternal(taskId, false)
      if (isTransient(error) && current && current.attemptCount < current.maxAttempts) {
        const delay = 1000 * (2 ** Math.max(0, current.attemptCount - 1))
        return taskService.retryTask(taskId, error, delay)
      }
      return taskService.failTask(taskId, error, { code: isTransient(error) ? 'retry_exhausted' : (error.code || 'task_failed') })
    }
  }

  return { processTask }
}

export { isTransient }
