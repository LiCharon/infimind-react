import { Router } from 'express'
import multer from 'multer'
import { extractText } from '../services/file-parser.js'
import { getKnowledgeBaseStatus, listTemplates, searchEvidence } from '../services/knowledge-base.js'
import { buildReviewPlan } from '../services/review-plan.js'
import { buildReviewResult, renderReviewReport } from '../services/annotation-locator.js'
import { createReviewSession, getReviewSession, publicReviewSession } from '../services/review-session-store.js'
import { analyzeContract } from '../agents/contract-analyzer.js'
import { reviewContract } from '../agents/contract-reviewer.js'
import { rewriteContract } from '../agents/contract-rewriter.js'
import { streamChat, getFlashModel, getProModel } from '../services/llm-client.js'

const router = Router()

const upload = multer({
  storage: multer.memoryStorage(),
  // 浏览器 FormData 以 UTF-8 写入中文 filename；Busboy 默认 Latin-1 会造成文件名乱码。
  defParamCharset: 'utf8',
  limits: { fileSize: 80 * 1024 * 1024 } // 80MB
})

// 两个阶段共享同一份合同原文，避免因不同截断长度造成审查、确认和改写结果错位。
const MAX_CONTRACT_TEXT = 60000

const ACCEPTED_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/png',
  'image/jpeg',
  'image/webp'
]

// 供审查工作台展示当前可参与比对的知识库资料。只返回元数据，合同正文不会暴露到浏览器。
router.get('/knowledge-base/templates', (req, res) => {
  try {
    res.json({ templates: listTemplates() })
  } catch (error) {
    res.status(503).json({ error: '知识库暂不可用', detail: error.message })
  }
})

router.get('/knowledge-base/status', (req, res) => {
  try {
    res.json(getKnowledgeBaseStatus())
  } catch (error) {
    res.status(503).json({ error: '知识库暂不可用', detail: error.message })
  }
})

const MODELS = {
  fast: () => ({ model: getFlashModel(), thinking: { type: 'disabled' }, maxTokens: 2048 }),
  thinking: () => ({ model: getProModel(), thinking: { type: 'enabled' }, reasoningEffort: 'high', maxTokens: 4096 })
}

const resolveModel = (mode) => (MODELS[mode] || MODELS.thinking)()

/**
 * POST /api/contract-finalize
 * 阶段2：用户确认（可勾选采纳）批注后，基于原合同 + 选中的批注，调用 Agent 3 生成修订稿。
 * Body: { mode, reviewSessionId, selectedFindingIds: string[] }
 */
router.post('/contract-finalize', async (req, res) => {
  try {
    const mode = req.body?.mode === 'fast' ? 'fast' : 'thinking'
    const reviewSession = getReviewSession(req.body?.reviewSessionId)
    const selectedFindingIds = Array.isArray(req.body?.selectedFindingIds)
      ? req.body.selectedFindingIds.filter((id) => typeof id === 'string')
      : []
    if (!reviewSession) return res.status(410).json({ error: '本次审查会话已失效，请重新审查后再生成修订稿。' })
    if (!selectedFindingIds.length) return res.status(400).json({ error: '请至少选择一条已定位批注' })

    const selectedIdSet = new Set(selectedFindingIds)
    const acceptedFindings = reviewSession.findings.filter((finding) => selectedIdSet.has(finding.id))
    if (!acceptedFindings.length) return res.status(400).json({ error: '所选批注不存在或未通过原文定位校验' })
    const contractText = reviewSession.contractText
    const analysisReport = reviewSession.analysisReport

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive'
    })
    const writeSSE = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

    const modelProfile = resolveModel(mode)
    writeSSE('stage.start', { stage: 'rewrite', label: '正在依据已确认批注生成修订稿' })

    // Agent 3 只收到服务端会话中用户选中的 finding，前端文本无法伪造、重排或混入旧批注。
    const acceptedReview = `# 用户已确认采纳的审查批注（共 ${acceptedFindings.length} 条）\n\n${acceptedFindings.map((finding, index) => `${index + 1}. 【${finding.level}】${finding.title}\n定位：${finding.anchor}\n位置：${finding.location || '相关条款'}\n原文：${finding.originalText}\n风险：${finding.risk}\n建议：${finding.advice}${finding.replacement ? `\n建议替换文本：${finding.replacement}` : ''}`).join('\n\n')}`

    let finalContract = ''
    try {
      finalContract = await rewriteContract({
        contractText,
        analysisReport,
        reviewReport: acceptedReview,
        onlyAccepted: true
      }, (chunk) => {
        writeSSE('rewrite.delta', { content: chunk })
      }, modelProfile.model)
    } catch (error) {
      console.error('[contract-finalize] Agent 3 error:', error.message)
      writeSSE('error', { message: `合同改写失败: ${error.message}`, stage: 'rewrite' })
      writeSSE('done', {})
      return res.end()
    }

    writeSSE('stage.complete', { stage: 'rewrite', summary: '合同改写完成', contractLength: finalContract.length })
    writeSSE('done', {})
    return res.end()
  } catch (error) {
    console.error('[contract-finalize] error:', error)
    if (!res.headersSent) return res.status(500).json({ error: error.message || '处理失败' })
    try {
      res.write(`event: error\ndata: ${JSON.stringify({ message: error.message || '处理失败' })}\n\n`)
      res.write('event: done\ndata: {}\n\n')
      res.end()
    } catch { /* 连接已断开 */ }
  }
})

/** 普通追问对话：无需上传合同，沿用当前选择的 DeepSeek 模型。 */
router.post('/contract-chat', async (req, res) => {
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : ''
  const mode = req.body?.mode === 'fast' ? 'fast' : 'thinking'
  const history = Array.isArray(req.body?.history) ? req.body.history : []
  if (!message) return res.status(400).json({ error: '请输入问题' })

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive'
  })
  const writeSSE = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  try {
    const modelProfile = resolveModel(mode)
    writeSSE('chat.start', { mode, model: modelProfile.model })
    const systemPrompt = '你是法飞飞商业合同审查助手。仅就合同审查、合同条款、风险识别、修改建议等提供专业、清晰、审慎的中文回答。涉及正式签署或重大法律风险时，提示用户结合交易背景咨询专业人士。'
    for await (const chunk of streamChat(systemPrompt, message, {
      model: modelProfile.model,
      temperature: 0.35,
      maxTokens: modelProfile.maxTokens,
      history,
      thinking: modelProfile.thinking,
      reasoningEffort: modelProfile.reasoningEffort
    })) {
      if (chunk.content) writeSSE('chat.delta', { content: chunk.content })
    }
    writeSSE('done', {})
  } catch (error) {
    writeSSE('error', { message: error.message || '对话请求失败' })
    writeSSE('done', {})
  } finally {
    res.end()
  }
})

/**
 * POST /api/contract-rewrite
 * 多 Agent 合同改写流水线
 */
router.post('/contract-rewrite', upload.array('files', 6), async (req, res) => {
  const startTime = Date.now()

  try {
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : ''
    const mode = req.body?.mode === 'fast' ? 'fast' : 'thinking'
    const modelProfile = resolveModel(mode)
    const attachments = req.files || []

    if (attachments.length === 0) {
      return res.status(400).json({ error: '请至少上传一个合同文件' })
    }

    // 验证文件类型
    for (const file of attachments) {
      const isValid = ACCEPTED_TYPES.includes(file.mimetype) ||
        /\.(pdf|doc|docx|png|jpg|jpeg|webp)$/i.test(file.originalname || '')
      if (!isValid) {
        return res.status(400).json({ error: `${file.originalname} 文件类型暂不支持` })
      }
    }

    // 设置 SSE 响应头
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive'
    })

    const writeSSE = (event, data) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }

    // ==========================================
    // Step 0: 文件解析
    // ==========================================
    writeSSE('stage.start', { stage: 'parsing', label: '正在解析上传的合同文件' })

    let parsedText = ''
    const parseErrors = []

    for (const file of attachments) {
      try {
        writeSSE('stage.progress', { stage: 'parsing', message: `正在解析: ${file.originalname}` })
        const result = await extractText(file)
        if (result.text.trim()) {
          // 原文确认面板只展示合同内容，不展示上传文件名，避免文件名编码影响文档预览。
          parsedText += `${parsedText ? '\n\n' : ''}${result.text}`
        } else {
          parseErrors.push(`${file.originalname}: 未提取到文本内容`)
        }
      } catch (error) {
        parseErrors.push(`${file.originalname}: ${error.message}`)
        console.error(`[contract-rewrite] Parse error for ${file.originalname}:`, error.message)
      }
    }

    if (!parsedText.trim()) {
      writeSSE('error', { message: `文件解析失败：${parseErrors.join('；')}`, stage: 'parsing' })
      writeSSE('done', {})
      return res.end()
    }

    if (parsedText.length > MAX_CONTRACT_TEXT) {
      writeSSE('error', { message: `合同正文超过 ${MAX_CONTRACT_TEXT} 字符，暂不支持一次性审查；请拆分文件后重试。`, stage: 'parsing' })
      writeSSE('done', {})
      return res.end()
    }

    if (parseErrors.length > 0) {
      writeSSE('stage.progress', { stage: 'parsing', message: `部分文件解析异常: ${parseErrors.join('；')}` })
    }

    writeSSE('stage.complete', {
      stage: 'parsing',
      summary: `文件解析完成，共提取 ${parsedText.length} 个字符`,
      textLength: parsedText.length
    })

    // ==========================================
    // Step 1: Agent 1 - 合同分析
    // ==========================================
    writeSSE('stage.start', { stage: 'analysis', label: '正在分析合同结构与要素完整性' })

    let analysisReport = ''

    try {
      analysisReport = await analyzeContract(parsedText, (chunk) => {
        writeSSE('analysis.delta', { content: chunk })
      }, modelProfile.model)
    } catch (error) {
      console.error('[contract-rewrite] Agent 1 error:', error.message)
      writeSSE('error', { message: `合同分析失败: ${error.message}`, stage: 'analysis' })
      writeSSE('done', {})
      return res.end()
    }

    writeSSE('stage.complete', {
      stage: 'analysis',
      summary: '合同结构分析完成',
      reportLength: analysisReport.length
    })

    // 审查、批注定位、确认页和阶段2改写均使用同一份完整原文，绝不各自截断。
    const reviewContractText = parsedText
    const reviewAnalysis = analysisReport

    // ==========================================
    // Step 2: 知识库检索
    // ==========================================
    writeSSE('stage.start', { stage: 'knowledge', label: '正在检索合同条款与风险证据' })

    let evidence = []
    let reviewPlan = null
    try {
      reviewPlan = buildReviewPlan({ analysisReport, contractText: reviewContractText, userInstruction: message })
      writeSSE('stage.progress', {
        stage: 'knowledge',
        message: `审查计划：${reviewPlan.contractType}｜${reviewPlan.topics.map((topic) => topic.label).join('、')}`
      })

      evidence = await searchEvidence(reviewPlan, { limit: 12 })
      writeSSE('templates.found', {
        count: evidence.length,
        names: [...new Set(evidence.map((item) => item.sourceName))],
        references: evidence.map((item) => ({
          evidenceId: item.evidenceId,
          name: item.sourceName,
          contractType: item.contractType,
          role: item.referenceRole || 'reference',
          kind: item.kind,
          clauseNo: item.clauseNo,
          category: item.category
        }))
      })
    } catch (error) {
      console.warn('[contract-rewrite] Knowledge base search failed:', error.message)
      writeSSE('stage.progress', { stage: 'knowledge', message: '知识库检索暂时不可用，将继续进行审查' })
    }

    writeSSE('stage.complete', {
      stage: 'knowledge',
      summary: `匹配到 ${evidence.length} 条可追溯知识证据`
    })

    // ==========================================
    // Step 3: Agent 2 - 合同审查
    // 使用完整原文，确保审查结论与风险批注确认页的条款范围完全一致。
    // ==========================================
    console.log(
      `[contract-rewrite] Agent 2 input sizes: contract=${reviewContractText.length}, analysis=${reviewAnalysis.length}, evidence=${evidence.length}`
    )

    writeSSE('stage.start', { stage: 'review', label: '正在进行合同合规与履约风险审查' })

    let rawReviewOutput = ''

    try {
      rawReviewOutput = await reviewContract({
        contractText: reviewContractText,
        analysisReport: reviewAnalysis,
        evidence,
        reviewPlan,
        userInstruction: message
      }, modelProfile.model)
    } catch (error) {
      console.error('[contract-rewrite] Agent 2 error:', error.message)
      writeSSE('error', { message: `合同审查失败: ${error.message}`, stage: 'review' })
      writeSSE('done', {})
      return res.end()
    }

    let reviewResult
    try {
      reviewResult = buildReviewResult({ contractText: reviewContractText, modelOutput: rawReviewOutput })
    } catch (error) {
      console.error('[contract-rewrite] Invalid review result:', error.message)
      writeSSE('error', { message: `审查结果未能通过结构化校验：${error.message}。请重新发起审查。`, stage: 'review' })
      writeSSE('done', {})
      return res.end()
    }

    // 快速模型偶尔会返回空 findings（或整段格式失真）。这时在同一审核阶段做一次受控重试，
    // 仍以同一份完整原文为输入；最终报告和确认页只使用重试后经校验的唯一 ReviewSession。
    if (reviewResult.stats.confirmed === 0) {
      writeSSE('stage.progress', { stage: 'review', message: '首轮未得到可定位批注，正在进行一次格式与定位复核' })
      try {
        const recoveryOutput = await reviewContract({
          contractText: reviewContractText,
          analysisReport: reviewAnalysis,
          evidence,
          reviewPlan,
          userInstruction: `${message || '无'}\n\n【系统复核】上一轮未生成可确认的风险批注。请重新逐条审查合同，必须输出完整 JSON；只要存在风险或需完善事项，就必须给出条款位置、尽量逐字的 quote、风险和建议。不要输出行号，定位由程序完成。`
        }, modelProfile.model)
        const recoveryResult = buildReviewResult({ contractText: reviewContractText, modelOutput: recoveryOutput })
        if (recoveryResult.stats.confirmed > 0 || recoveryResult.stats.generated > reviewResult.stats.generated) {
          reviewResult = recoveryResult
          rawReviewOutput = recoveryOutput
        }
      } catch (error) {
        console.warn('[contract-rewrite] Review recovery failed:', error.message)
      }
    }

    const reviewReport = renderReviewReport(reviewResult)
    const reviewSession = createReviewSession({
      contractText: reviewContractText,
      analysisReport: reviewAnalysis,
      reviewReport,
      reviewResult
    })
    // 对话报告和确认页均由同一份 reviewResult 派生，不再把模型原始输出或原文标记当作补充来源。
    writeSSE('review.delta', { content: reviewReport })
    if (reviewResult.stats.unresolved > 0) {
      console.warn(`[contract-rewrite] ${reviewResult.stats.unresolved} finding(s) require manual re-review; they were not made selectable`)
    }

    writeSSE('stage.complete', {
      stage: 'review',
      summary: `法律合规审查完成，${reviewResult.stats.confirmed} 条批注已定位到原文${reviewResult.stats.unresolved ? `，${reviewResult.stats.unresolved} 条待核查` : ''}`,
      reportLength: reviewReport.length,
      annotationCount: reviewResult.stats.confirmed,
      reviewStats: reviewResult.stats
    })

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log(`[contract-rewrite] Stage 1 completed in ${elapsed}s`)

    // ==========================================
    // 阶段1完成：回传合同原文，供前端内联展示批注、等待用户确认。
    // 改写（Agent 3）推迟到 /contract-finalize，用户确认批注后再触发。
    // ==========================================
    writeSSE('review.original', { text: parsedText, reviewSession: publicReviewSession(reviewSession) })

    writeSSE('done', {
      elapsed,
      mode,
      model: modelProfile.model,
      reportLength: reviewReport.length,
      stages: ['parsing', 'analysis', 'knowledge', 'review']
    })

    return res.end()

  } catch (error) {
    console.error('[contract-rewrite] Pipeline error:', error)
    if (!res.headersSent) {
      return res.status(500).json({ error: error.message || '处理失败' })
    }
    try {
      res.write(`event: error\ndata: ${JSON.stringify({ message: error.message || '处理失败' })}\n\n`)
      res.write('event: done\ndata: {}\n\n')
      res.end()
    } catch {
      // 连接已断开
    }
  }
})

export default router
