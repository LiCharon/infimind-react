import { Router } from 'express'
import multer from 'multer'
import { extractText } from '../services/file-parser.js'
import { getKnowledgeBaseStatus, listTemplates, searchEvidence } from '../services/knowledge-base.js'
import { buildReviewPlan } from '../services/review-plan.js'
import { buildReviewResult, renderReviewReport, extractReviewPayload, findingSimilarity } from '../services/annotation-locator.js'
import { mergeRevisions, coalesceAdjacentAdds } from '../services/revision-merger.js'
import { createReviewSession, getReviewSession, publicReviewSession } from '../services/review-session-store.js'
import { analyzeContract } from '../agents/contract-analyzer.js'
import { reviewContract } from '../agents/contract-reviewer.js'
import { rewriteContract } from '../agents/contract-rewriter.js'
import { streamChat, getFlashModel, getProModel, getUserBalance } from '../services/llm-client.js'

const router = Router()

const upload = multer({
  storage: multer.memoryStorage(),
  // 浏览器 FormData 以 UTF-8 写入中文 filename；Busboy 默认 Latin-1 会造成文件名乱码。
  defParamCharset: 'utf8',
  limits: { fileSize: 80 * 1024 * 1024 } // 80MB
})

// 两个阶段共享同一份合同原文，避免因不同截断长度造成审查、确认和改写结果错位。
const MAX_CONTRACT_TEXT = 60000

// 三轮审核：每轮在上一轮基础上补充遗漏问题，减少单轮遗漏；最终合并去重后再统一改写。
const REVIEW_ROUNDS = 3

// 合并多轮原始 findings 时的去重键：标题 + 原文摘录都相同才视为重复。
const dedupeKey = (item) => {
  const title = String(item?.title || '').replace(/\s+/g, '').trim()
  const quote = String(item?.quote || '').replace(/\s+/g, '').trim()
  return `${title}::${quote}`
}

const ACCEPTED_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/png',
  'image/jpeg',
  'image/webp'
]

// 用量只通过本地服务端读取，避免将密钥发送到浏览器。
router.get('/account/balance', async (req, res) => {
  try {
    const balance = await getUserBalance()
    res.set('Cache-Control', 'no-store')
    res.json(balance)
  } catch (error) {
    console.warn('[contract-rewrite] Balance lookup failed:', error.message)
    res.status(503).json({ error: '暂时无法读取剩余用量，请检查服务配置或稍后重试。' })
  }
})

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
    // Step 3: Agent 2 - 合同审查（三轮循环）
    // 每轮在上一轮基础上补充遗漏问题；三轮原始 findings 合并去重后，
    // 一次性交给 buildReviewResult 做代码定位与结构化校验。
    // ==========================================
    console.log(
      `[contract-rewrite] Agent 2 input sizes: contract=${reviewContractText.length}, analysis=${reviewAnalysis.length}, evidence=${evidence.length}`
    )

    writeSSE('stage.start', { stage: 'review', label: `正在进行三轮合同合规与履约风险审查` })

    const combinedFindings = []     // 三轮合并的原始 candidates（模型 quote，未定位）
    const accumulatedSummary = []   // 累计已发现问题摘要，供下一轮提示
    const seenKeys = new Set()
    let lastReviewOutput = ''
    let totalRoundsExecuted = 0
    // 逐轮发现快照：供前端实时展示「第X轮发现/新增了哪些问题」
    const roundSnapshots = []

    for (let round = 1; round <= REVIEW_ROUNDS; round += 1) {
      writeSSE('review.round', {
        round,
        total: REVIEW_ROUNDS,
        phase: 'start',
        accumulated: combinedFindings.length,
        message: `正在进行第 ${round} 轮审查（共 ${REVIEW_ROUNDS} 轮）${round > 1 ? `，前 ${round - 1} 轮已发现 ${combinedFindings.length} 条问题` : ''}`
      })
      let roundOutput = ''
      try {
        roundOutput = await reviewContract({
          contractText: reviewContractText,
          analysisReport: reviewAnalysis,
          evidence,
          reviewPlan,
          userInstruction: message,
          round,
          previousFindings: accumulatedSummary
        }, modelProfile.model)
      } catch (error) {
        console.error(`[contract-rewrite] Agent 2 round ${round} error:`, error.message)
        writeSSE('error', { message: `第 ${round} 轮合同审查失败: ${error.message}`, stage: 'review' })
        writeSSE('done', {})
        return res.end()
      }
      lastReviewOutput = roundOutput
      totalRoundsExecuted = round

      // 解析本轮输出，合并去重后追加到 combinedFindings
      let roundPayload
      try {
        roundPayload = extractReviewPayload(roundOutput)
      } catch (error) {
        console.warn(`[contract-rewrite] Agent 2 round ${round} payload parse failed:`, error.message)
        // 本轮解析失败：仍推送一个结束信号，便于前端进度连贯
        writeSSE('review.round', { round, total: REVIEW_ROUNDS, phase: 'end', newFindings: [], newCount: 0, accumulated: combinedFindings.length, message: `第 ${round} 轮审查结果解析异常，已跳过` })
        continue
      }
      const roundFindings = Array.isArray(roundPayload.findings) ? roundPayload.findings : []
      const newFindingsThisRound = []
      let newThisRound = 0
      let droppedThisRound = 0
      roundFindings.forEach((candidate) => {
        const key = dedupeKey(candidate)
        if (seenKeys.has(key)) return
        // 代码级近似去重：提示词只作辅助，换标题/换措辞/拆合表述的同一问题在这里拦下。
        if (combinedFindings.some((existing) => findingSimilarity(candidate, existing).similar)) {
          droppedThisRound += 1
          return
        }
        seenKeys.add(key)
        newThisRound += 1
        combinedFindings.push(candidate)
        accumulatedSummary.push({
          level: String(candidate?.level || '').trim() || '风险',
          title: String(candidate?.title || '').trim() || '未命名问题',
          location: String(candidate?.location || '').trim(),
          quote: String(candidate?.quote || '').replace(/\s+/g, '').slice(0, 80),
          risk: String(candidate?.risk || '').replace(/\s+/g, ' ').slice(0, 80)
        })
        // 快照：仅携带前端展示所需的轻量字段（不含 quote 全文，避免数据量过大）
        newFindingsThisRound.push({
          level: String(candidate?.level || '').trim() || '风险',
          title: String(candidate?.title || '').trim() || '未命名问题',
          location: String(candidate?.location || '').trim(),
          risk: String(candidate?.risk || '').trim().slice(0, 120)
        })
      })

      roundSnapshots.push({ round, newCount: newThisRound, dropped: droppedThisRound, newFindings: newFindingsThisRound })
      console.log(`[contract-rewrite] Round ${round}: ${roundFindings.length} findings (${newThisRound} new), combined total = ${combinedFindings.length}`)

      // 推送本轮结束信号：携带本轮新增问题清单，前端据此实时罗列
      writeSSE('review.round', {
        round,
        total: REVIEW_ROUNDS,
        phase: 'end',
        newFindings: newFindingsThisRound,
        newCount: newThisRound,
        dropped: droppedThisRound,
        accumulated: combinedFindings.length,
        message: `第 ${round} 轮审查完成${newThisRound > 0 ? `，新增 ${newThisRound} 条问题（累计 ${combinedFindings.length} 条）` : '，未发现新问题'}${droppedThisRound > 0 ? `，去重过滤 ${droppedThisRound} 条近似重复` : ''}`
      })

      // 提前终止：本轮没有任何新增问题，说明已无遗漏，无需继续后续轮次
      if (roundFindings.length === 0 || newThisRound === 0) break
    }

    // 合并后的 findings 交给 buildReviewResult 做代码定位与结构化校验
    const mergedModelOutput = JSON.stringify({
      conclusion: '三轮审查合并结果',
      findings: combinedFindings,
      completeness: []
    })

    let reviewResult
    try {
      reviewResult = buildReviewResult({ contractText: reviewContractText, modelOutput: mergedModelOutput })
    } catch (error) {
      console.error('[contract-rewrite] Invalid merged review result:', error.message)
      writeSSE('error', { message: `审查结果未能通过结构化校验：${error.message}。请重新发起审查。`, stage: 'review' })
      writeSSE('done', {})
      return res.end()
    }

    // 若三轮后仍无可定位批注，再补一次格式复核（保留原兜底逻辑，提升快速模式鲁棒性）
    if (reviewResult.stats.confirmed === 0) {
      writeSSE('stage.progress', { stage: 'review', message: '三轮未得到可定位批注，正在进行一次格式与定位复核' })
      try {
        const recoveryOutput = await reviewContract({
          contractText: reviewContractText,
          analysisReport: reviewAnalysis,
          evidence,
          reviewPlan,
          userInstruction: `${message || '无'}\n\n【系统复核】前三轮未生成可确认的风险批注。请重新逐条审查合同，必须输出完整 JSON；只要存在风险或需完善事项，就必须给出条款位置、尽量逐字的 quote、风险和建议。不要输出行号，定位由程序完成。`
        }, modelProfile.model)
        const recoveryResult = buildReviewResult({ contractText: reviewContractText, modelOutput: recoveryOutput })
        if (recoveryResult.stats.confirmed > 0 || recoveryResult.stats.generated > reviewResult.stats.generated) {
          reviewResult = recoveryResult
          lastReviewOutput = recoveryOutput
        }
      } catch (error) {
        console.warn('[contract-rewrite] Review recovery failed:', error.message)
      }
    }

    void lastReviewOutput  // 保留变量便于日志排查

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

    const crossRoundDeduped = roundSnapshots.reduce((sum, item) => sum + (Number(item.dropped) || 0), 0)

    writeSSE('stage.complete', {
      stage: 'review',
      summary: `三轮审查完成（实际执行 ${totalRoundsExecuted} 轮），${reviewResult.stats.confirmed} 条批注已定位到原文${reviewResult.stats.unresolved ? `，${reviewResult.stats.unresolved} 条待核查` : ''}${crossRoundDeduped ? `，跨轮去重 ${crossRoundDeduped} 条` : ''}`,
      reportLength: reviewReport.length,
      annotationCount: reviewResult.stats.confirmed,
      reviewStats: { ...reviewResult.stats, rounds: totalRoundsExecuted, crossRoundDeduped },
      // 逐轮发现快照：前端据此在对话区展示"第X轮发现/新增了哪些问题"
      roundSnapshots
    })

    console.log(`[contract-rewrite] Review stage completed (rounds=${totalRoundsExecuted}, confirmed=${reviewResult.stats.confirmed})`)

    // ==========================================
    // Step 4: Agent 3 - 自动改写（直接基于全部已定位 findings，无需用户确认）
    // 对每条 finding 产出"如何修订"的结构化指令，服务端用 revision-merger 把
    // 可信 finding（原句/行号）与 Agent 3 输出（改写文本/批注）配对。
    // ==========================================
    let rewritePayload = { contractText: reviewContractText, revisions: [], stats: { rounds: totalRoundsExecuted, totalFindings: 0, modify: 0, add: 0, delete: 0 } }

    if (reviewResult.findings.length > 0) {
      // 「最终校验」阶段：明确告知用户进入定稿环节，缓解长时间等待的焦虑
      writeSSE('stage.start', { stage: 'rewrite', label: '正在依据审查结果进行最终校验并生成修订稿' })

      // 首轮：整批调用 Agent 3，一次性产出所有 revisions
      let rewriteOutput = ''
      try {
        rewriteOutput = await rewriteContract({
          contractText: reviewContractText,
          analysisReport: reviewAnalysis,
          findings: reviewResult.findings
        }, (chunk) => {
          // 改写阶段输出的是 JSON，无法逐字展示；保留回调接口用于未来扩展（如进度心跳）。
          void chunk
        }, modelProfile.model)
      } catch (error) {
        console.error('[contract-rewrite] Agent 3 error:', error.message)
        writeSSE('error', { message: `合同改写失败: ${error.message}`, stage: 'rewrite' })
        writeSSE('done', {})
        return res.end()
      }

      let merged = mergeRevisions(reviewResult.findings, rewriteOutput, reviewContractText)
      console.log(`[contract-rewrite] Rewrite pass 1: ${merged.stats.matched}/${merged.revisions.length} matched${merged.recovered ? ' (recovered from truncation)' : ''}`)

      // 分批降级补全：仍有 finding 未拿到改写（被截断或漏配）时，按 6 条一批重调。
      // 这是对 maxTokens 截断的第二道防线——即使容错修复也只抢救到部分，补全确保每条都有改写。
      const REWRITE_BATCH_SIZE = 6
      const REWRITE_MAX_BATCHES = 4
      let batchIndex = 0
      let missingFindings = merged.revisions.filter((rev) => !rev.hasRewrite).map((rev) =>
        reviewResult.findings.find((f) => f.id === rev.findingId)
      ).filter(Boolean)

      while (missingFindings.length > 0 && batchIndex < REWRITE_MAX_BATCHES) {
        batchIndex += 1
        const batch = missingFindings.slice(0, REWRITE_BATCH_SIZE)
        const remaining = missingFindings.slice(REWRITE_BATCH_SIZE)
        writeSSE('stage.progress', { stage: 'rewrite', message: `正在补全第 ${batchIndex} 批未生成的修订（剩余 ${missingFindings.length} 条）` })
        console.log(`[contract-rewrite] Rewrite batch ${batchIndex}: re-generating ${batch.length} missing revisions`)

        let batchOutput = ''
        try {
          batchOutput = await rewriteContract({
            contractText: reviewContractText,
            analysisReport: reviewAnalysis,
            findings: batch
          }, () => {}, modelProfile.model)
        } catch (error) {
          console.warn(`[contract-rewrite] Rewrite batch ${batchIndex} failed:`, error.message)
          break
        }

        const batchMerged = mergeRevisions(batch, batchOutput, reviewContractText)
        // 用补全结果覆盖首批中对应 finding（只覆盖成功拿到改写的）
        const batchById = new Map(batchMerged.revisions.filter((r) => r.hasRewrite).map((r) => [r.findingId, r]))
        merged.revisions = merged.revisions.map((rev) => batchById.has(rev.findingId) ? { ...rev, ...batchById.get(rev.findingId) } : rev)
        console.log(`[contract-rewrite] Rewrite batch ${batchIndex}: recovered ${batchById.size}/${batch.length} revisions`)

        // 重新计算缺失项：本批未补全的 + 剩余未处理的
        const stillMissing = batchMerged.revisions.filter((r) => !r.hasRewrite).map((r) =>
          reviewResult.findings.find((f) => f.id === r.findingId)
        ).filter(Boolean)
        missingFindings = [...remaining, ...stillMissing]
      }

      if (missingFindings.length > 0) {
        console.warn(`[contract-rewrite] ${missingFindings.length} revision(s) still missing after batch recovery; falling back to advice`)
      }

      // 重新统计（补全后部分 action 可能从兜底 modify 变化）。统计口径保持 per-finding，与审查报告一致。
      const finalTally = { modify: 0, add: 0, delete: 0 }
      merged.revisions.forEach((rev) => { finalTally[rev.action] = (finalTally[rev.action] || 0) + 1 })

      // 展示层归并：同一插入位置的连续 add 合并为一个修订块（不改变上面的 per-finding 统计）。
      const displayRevisions = coalesceAdjacentAdds(merged.revisions)
      const mergedAddCount = merged.revisions.length - displayRevisions.length

      rewritePayload = {
        contractText: reviewContractText,
        revisions: displayRevisions,
        stats: { rounds: totalRoundsExecuted, total: merged.revisions.length, matched: merged.revisions.filter((r) => r.hasRewrite).length, blocks: displayRevisions.length, ...finalTally }
      }
      console.log(`[contract-rewrite] Rewrite completed: ${merged.revisions.length} revisions, ${rewritePayload.stats.matched} with rewrite (modify=${finalTally.modify}, add=${finalTally.add}, delete=${finalTally.delete})${mergedAddCount ? `, ${mergedAddCount} add revision(s) coalesced for display` : ''}`)

      writeSSE('stage.complete', {
        stage: 'rewrite',
        summary: `最终校验完成，共生成 ${merged.revisions.length} 处修订${mergedAddCount ? '（同一位置的多条新增已合并展示）' : ''}`,
        revisionCount: merged.revisions.length
      })
    } else {
      writeSSE('stage.start', { stage: 'rewrite', label: '未发现需修订条款' })
      writeSSE('stage.complete', { stage: 'rewrite', summary: '未发现需修订条款', revisionCount: 0 })
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log(`[contract-rewrite] Pipeline completed in ${elapsed}s`)

    // 回传合同原文 + ReviewSession（兼容旧前端的 review.original 事件）
    writeSSE('review.original', { text: parsedText, reviewSession: publicReviewSession(reviewSession) })
    // 新事件：结构化修订结果，前端据此渲染「行内三明治视图」
    writeSSE('rewrite.result', rewritePayload)

    writeSSE('done', {
      elapsed,
      mode,
      model: modelProfile.model,
      reportLength: reviewReport.length,
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
