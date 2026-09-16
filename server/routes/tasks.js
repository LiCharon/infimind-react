import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import multer from 'multer'
import { ACCEPTED_TYPES, isValidAttachment } from '../workflows/contract-review.js'

const MAX_FILES = 6
const MAX_FILE_SIZE = 80 * 1024 * 1024
const MAX_MESSAGE_LENGTH = 16000

const upload = multer({
  storage: multer.memoryStorage(),
  defParamCharset: 'utf8',
  limits: { files: MAX_FILES, fileSize: MAX_FILE_SIZE }
})

const jsonError = (res, status, message, code = 'bad_request') => res.status(status).json({ error: message, code })

const normalizeMode = (value) => value === 'fast' ? 'fast' : 'thinking'

export function createTaskRouter({ taskService, taskQueue, fileStore } = {}) {
  if (!taskService || !taskQueue || !fileStore) throw new Error('task router requires taskService, taskQueue and fileStore')
  const router = Router()

  router.post('/tasks/contract-review', upload.array('files', MAX_FILES), async (req, res) => {
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : ''
    const mode = normalizeMode(req.body?.mode)
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : ''
    const files = Array.isArray(req.files) ? req.files : []
    if (!files.length) return jsonError(res, 400, '请至少上传一个合同文件')
    if (message.length > MAX_MESSAGE_LENGTH) return jsonError(res, 400, `审查要求超过 ${MAX_MESSAGE_LENGTH} 个字符，请精简后重试`)
    for (const file of files) {
      if (!isValidAttachment(file)) return jsonError(res, 400, `${file.originalname || '文件'} 文件类型暂不支持`)
    }

    const taskId = randomUUID()
    let storedFiles = []
    let createdTask = null
    try {
      storedFiles = await fileStore.saveIncomingFiles(taskId, files)
      createdTask = taskService.createTask({
        id: taskId,
        userId: req.user.id,
        productId: 'contract-review',
        title: title || files[0].originalname || '商业合同审查',
        prompt: message,
        mode,
        files: storedFiles
      })
      await taskQueue.enqueue(taskId)
      return res.status(202).json({
        taskId,
        status: createdTask.status,
        productId: createdTask.productId,
        eventsUrl: `/api/tasks/${taskId}/events?after=0`,
        task: createdTask
      })
    } catch (error) {
      const currentTask = createdTask ? taskService.getTaskInternal(taskId, false) : null
      if (currentTask && !taskService.isTerminal(currentTask.status)) taskService.failTask(taskId, new Error('任务队列暂不可用'), { code: 'queue_unavailable' })
      await fileStore.removeTaskFiles(taskId).catch(() => {})
      console.error('[tasks] create contract-review task failed:', error.message)
      return jsonError(res, 503, '任务暂时无法创建，请稍后重试', 'task_unavailable')
    }
  })

  router.get('/tasks', (req, res) => {
    const limit = Number(req.query.limit) || 20
    res.json({ tasks: taskService.listTasks(req.user.id, limit) })
  })

  router.get('/tasks/:taskId', (req, res) => {
    const task = taskService.getTask(req.params.taskId, req.user.id, true)
    if (!task) return jsonError(res, 404, '任务不存在或无权访问', 'task_not_found')
    return res.json({ task })
  })

  router.get('/tasks/:taskId/events', (req, res) => {
    const task = taskService.getTask(req.params.taskId, req.user.id, false)
    if (!task) return jsonError(res, 404, '任务不存在或无权访问', 'task_not_found')
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    })
    const startedAt = Date.now()
    let after = Math.max(0, Number(req.query.after) || 0)
    let closed = false
    let pollTimer = null
    let keepAliveTimer = null
    const close = () => {
      if (closed) return
      closed = true
      if (pollTimer) clearTimeout(pollTimer)
      if (keepAliveTimer) clearInterval(keepAliveTimer)
      if (!res.writableEnded) res.end()
    }
    const writeEvents = () => {
      if (closed) return
      const events = taskService.getEvents(req.params.taskId, req.user.id, after, 500)
      if (events === null) return close()
      for (const item of events) {
        after = item.seq
        res.write(`id: ${item.seq}\nevent: ${item.event}\ndata: ${JSON.stringify({ ...item.data, _seq: item.seq })}\n\n`)
      }
      const current = taskService.getTask(req.params.taskId, req.user.id, false)
      if (!current || (taskService.isTerminal(current.status) && events.length === 0)) return close()
      if (Date.now() - startedAt > 30 * 60 * 1000) return close()
      pollTimer = setTimeout(writeEvents, 300)
    }
    keepAliveTimer = setInterval(() => { if (!closed) res.write(': keep-alive\n\n') }, 15000)
    keepAliveTimer.unref?.()
    req.on('close', close)
    writeEvents()
  })

  router.post('/tasks/:taskId/cancel', (req, res) => {
    const task = taskService.requestCancel(req.params.taskId, req.user.id)
    if (!task) return jsonError(res, 404, '任务不存在或无权访问', 'task_not_found')
    return res.json({ task })
  })

  return router
}

export { ACCEPTED_TYPES, MAX_FILE_SIZE }
