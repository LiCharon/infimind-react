import { createBusinessDatabase } from './business-db.js'
import { createTaskFileStore } from './task-file-store.js'
import { createTaskProcessor } from './task-processor.js'
import { createTaskQueue } from './task-queue.js'
import { createTaskService } from './task-service.js'

export function createTaskRuntime({ database = null, workerEnabled = process.env.TASK_RUN_WORKER !== 'false' } = {}) {
  const businessDatabase = database || createBusinessDatabase()
  const taskService = createTaskService(businessDatabase)
  const taskFileStore = createTaskFileStore()
  const taskProcessor = createTaskProcessor({ taskService, fileStore: taskFileStore })
  const taskQueue = createTaskQueue({ taskService, processTask: taskProcessor.processTask, workerEnabled })
  return { businessDatabase, taskService, taskFileStore, taskProcessor, taskQueue }
}
