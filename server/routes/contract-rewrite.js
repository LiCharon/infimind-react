import { Router } from 'express'
import multer from 'multer'
import { extractText } from '../services/file-parser.js'
import { search, extractSearchKeywords, listTemplates } from '../services/knowledge-base.js'
import { analyzeContract } from '../agents/contract-analyzer.js'
import { reviewContract } from '../agents/contract-reviewer.js'
import { rewriteContract } from '../agents/contract-rewriter.js'
import { streamChat, getFlashModel, getProModel } from '../services/llm-client.js'

const router = Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 80 * 1024 * 1024 } // 80MB
})

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

const MODELS = {
  fast: () => getFlashModel(),
  thinking: () => getProModel()
}

const resolveModel = (mode) => (MODELS[mode] || MODELS.thinking)()

/** 普通追问对话：无需上传合同，沿用当前选择的 DeepSeek 模型。 */
router.post('/contract-chat', async (req, res) => {
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : ''
  const mode = req.body?.mode === 'fast' ? 'fast' : 'thinking'
  if (!message) return res.status(400).json({ error: '请输入问题' })

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive'
  })
  const writeSSE = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  try {
    writeSSE('chat.start', { mode, model: resolveModel(mode) })
    const systemPrompt = '你是法飞飞商业合同审查助手。仅就合同审查、合同条款、风险识别、修改建议等提供专业、清晰、审慎的中文回答。涉及正式签署或重大法律风险时，提示用户结合交易背景咨询专业人士。'
    for await (const chunk of streamChat(systemPrompt, message, {
      model: resolveModel(mode),
      temperature: 0.35,
      maxTokens: mode === 'fast' ? 2048 : 4096
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
    const model = resolveModel(mode)
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
      'Content-Type': 'text/event-stream',
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
          parsedText += `\n\n=== 文件: ${file.originalname} ===\n\n${result.text}`
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
      }, model)
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

    // ==========================================
    // Step 2: 知识库检索
    // ==========================================
    writeSSE('stage.start', { stage: 'knowledge', label: '正在检索优质合同模版' })

    let templates = []
    try {
      const keywords = extractSearchKeywords(analysisReport)
      writeSSE('stage.progress', { stage: 'knowledge', message: `检索关键词: ${keywords}` })

      templates = search(keywords, { limit: 5 })
      writeSSE('templates.found', {
        count: templates.length,
        names: templates.map((t) => t.name),
        references: templates.map((t) => ({
          name: t.name,
          contractType: t.contract_type,
          role: t.reference_role || 'reference'
        }))
      })
    } catch (error) {
      console.warn('[contract-rewrite] Knowledge base search failed:', error.message)
      writeSSE('stage.progress', { stage: 'knowledge', message: '知识库检索暂时不可用，将继续进行审查' })
    }

    writeSSE('stage.complete', {
      stage: 'knowledge',
      summary: `匹配到 ${templates.length} 个相关模版`
    })

    // ==========================================
    // Step 3: Agent 2 - 合同审查
    // 限制输入大小避免超出 API 上下文限制
    // ==========================================
    const reviewContractText = parsedText.slice(0, 30000)
    const reviewAnalysis = analysisReport.slice(0, 20000)
    console.log(
      `[contract-rewrite] Agent 2 input sizes: contract=${reviewContractText.length}, analysis=${reviewAnalysis.length}, templates=${templates.length}`
    )

    writeSSE('stage.start', { stage: 'review', label: '正在进行法律合规审查（买方视角）' })

    let reviewReport = ''

    try {
      reviewReport = await reviewContract({
        contractText: reviewContractText,
        analysisReport: reviewAnalysis,
        templates,
        userInstruction: message
      }, (chunk) => {
        writeSSE('review.delta', { content: chunk })
      }, model)
    } catch (error) {
      console.error('[contract-rewrite] Agent 2 error:', error.message)
      writeSSE('error', { message: `合同审查失败: ${error.message}`, stage: 'review' })
      writeSSE('done', {})
      return res.end()
    }

    writeSSE('stage.complete', {
      stage: 'review',
      summary: '法律合规审查完成',
      reportLength: reviewReport.length
    })

    // ==========================================
    // Step 4: Agent 3 - 合同改写
    // ==========================================
    const rewriteContractText = parsedText.slice(0, 25000)
    const rewriteReview = reviewReport.slice(0, 15000)
    console.log(
      `[contract-rewrite] Agent 3 input sizes: contract=${rewriteContractText.length}, analysis=${reviewAnalysis.length}, review=${rewriteReview.length}`
    )

    writeSSE('stage.start', { stage: 'rewrite', label: '正在生成标准合规合同文本' })

    let finalContract = ''

    try {
      finalContract = await rewriteContract({
        contractText: rewriteContractText,
        analysisReport: reviewAnalysis,
        reviewReport: rewriteReview
      }, (chunk) => {
        writeSSE('rewrite.delta', { content: chunk })
      }, model)
    } catch (error) {
      console.error('[contract-rewrite] Agent 3 error:', error.message)
      writeSSE('error', { message: `合同改写失败: ${error.message}`, stage: 'rewrite' })
      writeSSE('done', {})
      return res.end()
    }

    writeSSE('stage.complete', {
      stage: 'rewrite',
      summary: '合同改写完成',
      contractLength: finalContract.length
    })

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log(`[contract-rewrite] Pipeline completed in ${elapsed}s`)

    // ==========================================
    // 完成
    // ==========================================
    writeSSE('done', {
      elapsed,
      mode,
      model,
      reportLength: finalContract.length,
      stages: ['parsing', 'analysis', 'knowledge', 'review', 'rewrite']
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
