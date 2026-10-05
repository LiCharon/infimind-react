import { TaskCancelledError, runContractReview } from '../workflows/contract-review.js'
import { runContractDraft } from '../workflows/contract-draft.js'
import { runLaborConsult } from '../workflows/labor-consult.js'
import { runLaborContractAnalysis, runLaborContractFollowup } from '../workflows/labor-contract-analysis.js'
import { runLaborDispatchAnalysis, runLaborDispatchFollowup } from '../workflows/labor-dispatch-analysis.js'
import { runLaborArbitration } from '../workflows/labor-arbitration.js'
import { formatArbitrationResult } from '../../src/utils/arbitration-result.js'

const transientPatterns = [
  /timeout/i,
  /timed out/i,
  /temporar/i,
  /rate.?limit/i,
  /too many requests/i,
  /network/i,
  /econnreset/i,
  /eai_again/i,
  /fetch failed/i,
  /\b429\b/,
  /\b5\d{2}\b/,
  /503/,
  /502/,
  /504/
]

const isTransient = (error) => {
  if (error?.unitRetryExhausted) return false
  if (['arbitration_result_invalid', 'arbitration_draft_missing', 'arbitration_output_truncated',
    'arbitration_result_inconsistent', 'arbitration_source_unavailable', 'arbitration_documents_unreadable',
    'unsupported_product_id'].includes(error?.code)) return false
  const errorText = `${error?.code || ''} ${error?.message || error || ''}`
  return Boolean(error?.retryable || transientPatterns.some((pattern) => pattern.test(errorText)))
}

export function createTaskProcessor({
  taskService,
  fileStore,
  fakeLlm = String(process.env.TASK_FAKE_LLM || '').toLowerCase() === 'true',
  reviewWorkflow = runContractReview,
  draftWorkflow = runContractDraft,
  laborWorkflow = runLaborConsult,
  laborContractAnalysisWorkflow = runLaborContractAnalysis,
  laborContractFollowupWorkflow = runLaborContractFollowup,
  laborDispatchAnalysisWorkflow = runLaborDispatchAnalysis,
  laborDispatchFollowupWorkflow = runLaborDispatchFollowup,
  laborArbitrationWorkflow = runLaborArbitration
} = {}) {
  if (!taskService || !fileStore) throw new Error('task processor requires taskService and fileStore')

  const processTask = async (taskId, { assumedClaimed = false } = {}) => {
    let task = taskService.getTaskInternal(taskId, false)
    if (!task || taskService.isTerminal(task.status)) return task
    let claimedNow = false
    if (task.status === 'queued' || task.status === 'retry_waiting') {
      task = taskService.claimTask(taskId)
      claimedNow = Boolean(task)
    }
    // BullMQ 可能在恢复期间重新投递同一个任务。只有成功原子领取的
    // 执行流程才能继续；否则第二个 Job 只能安全结束，不能重复调用模型。
    if (task?.status === 'running' && !assumedClaimed && !claimedNow) return task
    if (!task) return taskService.getTaskInternal(taskId, false)
    if (task.status === 'cancel_requested' || task.status === 'cancelled') return taskService.markCancelled(taskId)

    const emit = (event, payload = {}) => taskService.appendEvent(taskId, event, payload, payload.stage || null)
    const checkpoint = (stage, result) => {
      if (task.productId === 'labor-arbitration' && stage === 'source_document') {
        const source = taskService.getTaskInternal(result?.document?.sourceTaskId, false)
        if (!source || source.userId !== task.userId || source.productId !== task.productId || source.threadId !== task.threadId) throw new Error('案件材料不存在或无权访问。')
        const existing = taskService.getLaborSourceDocuments?.(source.id) || []
        const documents = [...existing.filter((document) => document.fileId !== result.document.fileId), result.document]
        return taskService.saveCheckpoint(source.id, 'source', { documents })
      }
      if (task.productId === 'labor-contract-analysis' && stage === 'parsing' && result?.documents?.length) {
        taskService.saveCheckpoint(taskId, 'source', { documents: result.documents })
      }
      return taskService.saveCheckpoint(taskId, stage, result)
    }
    const getCheckpoint = (stage) => taskService.getCheckpoint(taskId, stage)
    const isCancellationRequested = () => taskService.isCancellationRequested(taskId)
    const abortController = new AbortController()
    const syncCancellation = () => { if (isCancellationRequested()) abortController.abort() }
    syncCancellation()
    const cancellationTimer = setInterval(syncCancellation, 200)
    cancellationTimer.unref?.()

    try {
      let files = await fileStore.readFiles(taskService.getFiles(taskId))
      let input = taskService.getTaskInput?.(taskId) || {}
      let sourceDocuments = []
      let report = null
      let history = []
      let privacyAliases = []
      if (task.productId === 'labor-arbitration' && task.threadId) {
        // 只复用当前用户、当前产品、当前案件的材料；取消首轮后仍可继续使用原上传。
        const priorTasks = (taskService.listAllThreadTasks?.(task.userId, task.productId, task.threadId)
          || taskService.listThreadTasks(task.userId, task.productId, task.threadId, 200))
          .filter((prior) => prior.id !== task.id && new Date(prior.createdAt).getTime() <= new Date(task.createdAt).getTime())
        const materials = taskService.getThreadMaterials?.(task.userId, task.productId, task.threadId) || []
        const excluded = new Set(materials.filter((file) => !file.enabled).map((file) => file.id))
        const missing = []
        for (const prior of priorTasks) {
          if (prior.userId !== task.userId || prior.productId !== task.productId || prior.threadId !== task.threadId) {
            throw new Error('案件材料不存在或无权访问。')
          }
          // 创建时队列失败的上传已被路由回滚，不能阻塞用户重新提交。
          if (prior.status === 'failed' && prior.errorCode === 'queue_unavailable') continue
          const priorInput = taskService.getTaskInput?.(prior.id) || {}
          if (!priorInput.fileRefs?.length) continue
          const refs = priorInput.fileRefs.filter((ref) => !excluded.has(ref.id))
          const saved = taskService.getLaborSourceDocuments?.(prior.id)
            || taskService.getCheckpoint(prior.id, 'source')?.result?.documents
            || taskService.getCheckpoint(prior.id, 'parsing')?.result?.documents || []
          const cached = saved.filter((document) => refs.some((ref) => ref.id === document.fileId) && document.text?.trim())
          sourceDocuments.push(...cached.map((document) => ({ ...document, sourceTaskId: prior.id })))
          const missingRefs = refs.filter((ref) => !cached.some((document) => document.fileId === ref.id))
          const originalFiles = taskService.getFiles(prior.id).filter((file) => missingRefs.some((ref) => ref.id === file.id) && new Date(file.cleanupAt).getTime() > Date.now())
          missing.push(...missingRefs.filter((ref) => !originalFiles.some((file) => file.id === ref.id)).map((ref) => ref.originalName || '历史材料'))
          if (originalFiles.length) {
            try {
              files.push(...(await fileStore.readFiles(originalFiles)).map((file) => ({ ...file, sourceTaskId: prior.id })))
            } catch {
              missing.push(...originalFiles.map((file) => file.originalName || '历史材料'))
            }
          }
        }
        if (missing.length && !files.length && !sourceDocuments.length) {
          const error = new Error('历史材料已清理且未保留可读取正文，请在本案件重新上传材料后继续。')
          error.code = 'arbitration_source_unavailable'
          throw error
        }
        input.materialWarnings = [...missing.map((name) => `${name}无法读取，请重新上传；不能依据其旧分析确认事实。`),
          ...materials.filter((file) => !file.enabled).map((file) => `${file.name}已停止使用，其旧结论不再作为本轮事实依据。`)]
        if (task.workflowVersion === 'labor-arbitration-v2' || input.schemaVersion === 2) {
          const validPrior = priorTasks.filter((prior) => !(prior.status === 'failed' && prior.errorCode === 'queue_unavailable'))
          input.userMessages = validPrior.filter((prior) => prior.prompt).map((prior) => ({ taskId: prior.id, content: prior.prompt }))
          input.excludedFileIds = [...excluded]
          // Read only records owned by this user/product/thread. Browser history
          // and earlier assistant prose never become the source of case facts.
          input.previousAnalysis = [...validPrior].reverse().map((prior) =>
            prior.status === 'succeeded' && prior.result?.analysisVersion && prior.result?.claims?.length ? prior.result
              : taskService.getCheckpoint(prior.id, 'arbitration_validated_analysis')?.result?.result)
            .find((result) => result?.caseRecord?.schemaVersion === 2) || null
          input.previousCaseRecord = input.previousAnalysis?.caseRecord || null
          input.history = []
        }
        if (priorTasks.length && task.workflowVersion !== 'labor-arbitration-v2' && input.schemaVersion !== 2) input.history = priorTasks.filter((prior) => !(prior.status === 'failed' && prior.errorCode === 'queue_unavailable')).flatMap((prior) => [
          ...(prior.prompt ? [{ role: 'user', content: prior.prompt }] : []),
          ...(prior.status === 'succeeded' && prior.result ? [{ role: 'assistant', content: formatArbitrationResult(prior.result) }] : [])
        ])
      }
      if (task.productId === 'labor-contract-analysis' && ['followup', 'reanalyze', 'restart-analysis'].includes(input.action)) {
        const source = taskService.getTaskInternal(input.sourceTaskId, true)
        const expectedThread = source?.threadId || source?.id
        if (!source || source.userId !== task.userId || source.productId !== task.productId || expectedThread !== task.threadId) {
          throw new Error('原合同任务不存在或无权访问。')
        }
        const sourceInput = taskService.getTaskInput?.(source.id) || {}
        input = {
          ...input,
          analysisType: input.analysisType || sourceInput.analysisType || source.result?.analysisType || 'ordinary_labor_contract',
          reviewPerspective: input.reviewPerspective || sourceInput.reviewPerspective || source.result?.reviewPerspective || '',
          fileRoles: Array.isArray(input.fileRoles) && input.fileRoles.length ? input.fileRoles : (sourceInput.fileRoles || []),
          fileRefs: Array.isArray(input.fileRefs) && input.fileRefs.length ? input.fileRefs : (sourceInput.fileRefs || [])
        }
        privacyAliases = taskService.getCheckpoint(source.id, 'privacy')?.result?.aliases || []
        const originalFiles = taskService.getFiles(source.id)
        sourceDocuments = taskService.getLaborSourceDocuments(source.id)
        if (input.action === 'restart-analysis' && !sourceDocuments.length && originalFiles.length
          && originalFiles.every((file) => new Date(file.cleanupAt).getTime() > Date.now())) {
          files = await fileStore.readFiles(originalFiles)
        }
        if (input.action !== 'restart-analysis') {
          const reportTask = taskService.getTaskInternal(input.reportTaskId, true)
          if (!reportTask || reportTask.userId !== task.userId || reportTask.productId !== task.productId
            || (reportTask.threadId || reportTask.id) !== task.threadId
            || reportTask.result?.analysisStatus !== 'completed'
            || (reportTask.result?.sourceTaskId || reportTask.id) !== source.id) {
            throw new Error('分析报告不存在或无权访问。')
          }
          report = reportTask.result
          const reportPrivacyAliases = taskService.getCheckpoint(reportTask.id, 'privacy')?.result?.aliases || []
          privacyAliases = [...privacyAliases, ...reportPrivacyAliases]
        }
        if (input.action === 'reanalyze' && !sourceDocuments.length) {
          throw new Error('这段历史没有保存可继续分析的原文，请重新上传合同。')
        }
        history = taskService.listThreadTasks(task.userId, task.productId, task.threadId, 100)
          .filter((item) => item.id !== task.id && item.result?.kind === 'followup' && item.status === 'succeeded')
          .slice(-6)
          .map((item) => ({ question: item.prompt, answer: item.result.answer }))
      }
      const workflow = task.productId === 'contract-draft'
        ? draftWorkflow
        : task.productId === 'labor-consult' ? laborWorkflow
        : task.productId === 'labor-contract-analysis'
          ? input.action === 'followup'
            ? input.analysisType === 'labor_dispatch_agreement' ? laborDispatchFollowupWorkflow : laborContractFollowupWorkflow
            : input.analysisType === 'labor_dispatch_agreement' ? laborDispatchAnalysisWorkflow : laborContractAnalysisWorkflow
          : task.productId === 'labor-arbitration' ? laborArbitrationWorkflow
            : task.productId === 'contract-review' ? reviewWorkflow : null
      if (!workflow) {
        const error = new Error('该产品尚未注册任务处理流程。')
        error.code = 'unsupported_product_id'
        throw error
      }
      const result = await workflow({
        task,
        input,
        files,
        sourceDocuments,
        report,
        history,
        privacyAliases,
        emit,
        checkpoint,
        getCheckpoint,
        isCancellationRequested,
        updateFileParseStatus: (fileId, status) => taskService.updateFileParseStatus(fileId, status),
        signal: abortController.signal,
        fakeLlm
      })
      if (isCancellationRequested()) return taskService.markCancelled(taskId)
      const completed = taskService.completeTask(taskId, result)
      if (task.productId === 'labor-arbitration' && completed?.status === 'succeeded' && result.conversationTitle) {
        const firstTitle = (taskService.listAllThreadTasks?.(task.userId, task.productId, task.threadId)
          || taskService.listThreadTasks(task.userId, task.productId, task.threadId, 200))
          .find((prior) => prior.id !== task.id && prior.status === 'succeeded' && prior.result?.conversationTitle)?.result.conversationTitle
        taskService.updateThreadTitle?.(task.userId, task.productId, task.threadId, firstTitle || result.conversationTitle)
      }
      if (task.productId === 'contract-draft') {
        if (completed?.status === 'cancel_requested') return taskService.markCancelled(taskId, 'user_requested')
        if (completed?.status === 'succeeded') {
          taskService.appendEvent(taskId, 'done', { status: 'succeeded', resultAvailable: true, productId: task.productId })
        }
      }
      return completed
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
    } finally {
      clearInterval(cancellationTimer)
    }
  }

  return { processTask }
}

export { isTransient }
