import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  ArrowLeft,
  Brain,
  ChevronLeft,
  Copy,
  Download,
  FileText,
  FolderOpen,
  History,
  Loader2,
  Menu,
  MessageCircle,
  PanelLeft,
  PenLine,
  Plus,
  Send,
  Sparkles,
  Trash2,
  X,
  Zap
} from 'lucide-react'
import './ContractRewritePage.css'

const REVIEW_ENDPOINT = '/api/contract-rewrite'
const FINALIZE_ENDPOINT = '/api/contract-finalize'
const CHAT_ENDPOINT = '/api/contract-chat'
const ACCEPTED = '.pdf,.doc,.docx,.png,.jpg,.jpeg,.webp'
const MAX_FILE_SIZE = 80 * 1024 * 1024
const THREAD_STORAGE_KEY = 'fafee-contract-threads-v1'
const TASK_STORAGE_KEY = 'fafee-contract-tasks-v1'
const DEMO_DOCUMENT = `# 商业合作协议（审查修订稿）

甲方：__________

乙方：__________

根据《中华人民共和国民法典》及相关法律法规，甲、乙双方在平等、自愿、诚实信用的基础上，就合作事宜达成如下协议。

## 第一条 合作内容

1.1 乙方应按照双方确认的《项目需求说明书》完成服务。该说明书应明确约定交付成果、质量要求、完成期限和验收标准，并作为本协议附件。

## 第二条 交付与验收

2.1 乙方应于约定交付日前不少于五个工作日书面通知甲方。甲方在收到全部交付物后十个工作日内完成验收；如发现不符合约定的情形，有权要求乙方在合理期限内免费修复、补交或重新交付。

2.2 未经甲方书面验收合格，不视为甲方放弃对交付物的质量、性能或隐蔽瑕疵提出异议的权利。

## 第三条 费用与支付

3.1 本协议含税总价为人民币【    】元。乙方应在甲方付款前开具合法有效的增值税专用发票。

3.2 甲方在验收合格并收到前款发票后【    】个工作日内支付相应款项。任何付款不构成对乙方履约质量的最终确认。

## 第四条 违约责任

4.1 乙方逾期交付的，每逾期一日，应按逾期未交付部分对应价款的万分之【    】向甲方支付违约金；逾期超过【    】日的，甲方有权解除协议并要求乙方赔偿损失。

4.2 因乙方交付不符合约定导致甲方损失的，乙方应赔偿甲方因此遭受的全部直接损失及合理维权费用。

## 第五条 争议解决

5.1 因本协议引起的或与本协议有关的争议，双方应先友好协商；协商不成的，任一方可向【    】有管辖权的人民法院提起诉讼。`

const getExtension = (name = '') => name.toLowerCase().match(/\.[^.]+$/)?.[0] || ''
const isSupported = (file) => ACCEPTED.includes(getExtension(file.name)) && file.size <= MAX_FILE_SIZE
const inline = (text) => text.split(/(\*\*[^*]+\*\*)/g).map((part, index) => part.startsWith('**') ? <strong key={index}>{part.slice(2, -2)}</strong> : <React.Fragment key={index}>{part}</React.Fragment>)
const createId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const stripLegacyFileMarkers = (text = '') => text
  .split('\n')
  .filter((line) => !/^===\s*文件\s*[：:]/.test(line.trim()))
  .join('\n')
const normalizeDraftPlaceholders = (text = '') => text
  .replace(/【\s*待填写[^】]*】/g, '____')
  .replace(/\[\s*待填写[^\]]*\]/g, '____')
const createThread = (title = '新对话', taskId = null) => ({ id: createId('thread'), title, taskId, createdAt: Date.now(), updatedAt: Date.now(), messages: [] })
const readStorage = (key, fallback) => {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) || '')
    return Array.isArray(value) ? value : fallback
  } catch { return fallback }
}
const displayTitle = (content, fallback = '新对话') => content.trim().replace(/\s+/g, ' ').slice(0, 22) || fallback

// 识别「【批注】…」「【风险批注】…」标记行
const ANNOTATION_RE = /^【\s*(?:风险批注|批注)\s*】\s*(.*)$/
const isAnnotationLine = (line) => ANNOTATION_RE.test((line || '').trim())

// 将合同修订稿拆分为标题、摘要、正文三段。按已知章节名切分，避免与「## 第X条」条款标题冲突。
function parseContractDocument(text) {
  const lines = text.split('\n')
  let title = ''
  const summaryLines = []
  const bodyLines = []
  let section = 'body' // 默认按正文处理，兼容没有摘要段的纯合同
  for (const raw of lines) {
    const line = raw.trim()
    if (!title && /^#\s+/.test(line)) { title = line.replace(/^#\s+/, '').trim(); continue }
    if (/^##\s*修订与待确认摘要/.test(line)) { section = 'summary'; continue }
    if (/^##\s*合同正文/.test(line)) { section = 'body'; continue }
    if (/^##\s*签署页/.test(line)) { section = 'body'; bodyLines.push('## 签署页'); continue }
    if (section === 'summary') summaryLines.push(raw)
    else bodyLines.push(raw)
  }
  return { title, summaryText: summaryLines.join('\n').trim(), bodyLines }
}

// 从全文中提取所有「【风险批注】/【批注】」内容，供侧栏汇总展示。
function extractAnnotations(text) {
  const out = []
  for (const raw of (text || '').split('\n')) {
    const m = (raw || '').trim().match(ANNOTATION_RE)
    if (m) out.push(m[1].trim())
  }
  return out
}

// 风险确认页只能使用服务端 ReviewSession 返回的 findings。这里不解析 Markdown、
// 不扫描原文中的历史【风险批注】标记，也不按标题或关键词重新猜测位置。
const messageAnnotations = (message) => Array.isArray(message?.annotations) ? message.annotations : []

const LEVEL_META = {
  高: { key: 'high', label: '高风险', cls: 'level-high' },
  中: { key: 'mid', label: '中风险', cls: 'level-mid' },
  低: { key: 'low', label: '低风险', cls: 'level-low' }
}
const levelMeta = (level) => LEVEL_META[level] || LEVEL_META.中

// 将正文逐行解析为结构化块；同时回溯标记「被批注」的上一条条款。
function parseBodyBlocks(lines) {
  const trimmed = lines.map((line) => (line || '').trim())
  const annotationIdx = new Set()
  for (let i = 0; i < trimmed.length; i += 1) if (isAnnotationLine(trimmed[i])) annotationIdx.add(i)
  const annotatedIdx = new Set()
  annotationIdx.forEach((i) => {
    for (let j = i - 1; j >= 0; j -= 1) {
      if (trimmed[j]) { annotatedIdx.add(j); break }
    }
  })
  const blocks = []
  let listBuffer = []
  const flushList = (key) => {
    if (listBuffer.length) { blocks.push({ type: 'list', items: listBuffer, key }); listBuffer = [] }
  }
  lines.forEach((raw, i) => {
    const line = trimmed[i]
    if (annotationIdx.has(i)) { flushList(`list-${i}`); blocks.push({ type: 'annotation', text: line.replace(ANNOTATION_RE, '$1').trim(), key: `anno-${i}` }); return }
    if (!line) { flushList(`list-${i}`); return }
    const heading = line.match(/^(#{2,4})\s+(.+)$/)
    if (heading) { flushList(`list-${i}`); blocks.push({ type: 'heading', level: heading[1].length, text: heading[2], key: `h-${i}` }); return }
    const item = line.match(/^[-*+]\s+(.+)$/)
    if (item) { listBuffer.push(item[1]); return }
    blocks.push({ type: 'clause', text: line, annotated: annotatedIdx.has(i), key: `p-${i}` })
  })
  flushList('list-final')
  return blocks
}

function ContractDocument({ text, comments: showAnnotations = true }) {
  const { title, summaryText, bodyLines } = useMemo(() => parseContractDocument(text), [text])
  const bodyBlocks = useMemo(() => parseBodyBlocks(bodyLines), [bodyLines])
  const visible = showAnnotations !== false
  return (
    <article className="contract-document">
      {title && <h1 className="contract-title">{title}</h1>}
      {summaryText && (
        <section className="contract-summary">
          <div className="summary-head"><Sparkles size={15} /><span>修订与待确认摘要</span></div>
          <div className="summary-body"><ReactMarkdown remarkPlugins={[remarkGfm]}>{summaryText}</ReactMarkdown></div>
        </section>
      )}
      {bodyBlocks.length > 0 && (
        <section className="contract-body">
          {bodyBlocks.map((block) => {
            if (block.type === 'heading') {
              const Tag = `h${Math.min(block.level + 1, 4)}`
              return <Tag className="clause-heading" key={block.key}>{block.text}</Tag>
            }
            if (block.type === 'list') {
              return <ul className="clause-list" key={block.key}>{block.items.map((item, idx) => <li key={idx}>{inline(item)}</li>)}</ul>
            }
            if (block.type === 'annotation') {
              if (!visible) return null
              return (
                <div className="risk-annotation" key={block.key}>
                  <span className="risk-badge">【风险批注】</span>
                  <span className="risk-text">{inline(block.text)}</span>
                </div>
              )
            }
            return <p className={`clause-text ${block.annotated && visible ? 'clause-flagged' : ''}`} key={block.key}>{inline(block.text)}</p>
          })}
        </section>
      )}
    </article>
  )
}

// 阶段1文档：原文 + 内联批注（可勾选采纳）。只负责渲染滚动内容，工具栏/确认栏由外层文档面板渲染。
function ReviewDocument({ originalText, annotations, selectedIds, onToggle }) {
  const lines = useMemo(() => stripLegacyFileMarkers(originalText).split('\n'), [originalText])
  // 服务端已验证每条批注的行号和逐字原文摘录；前端只按该定位结果渲染，不再猜测位置。
  const { byLine, flaggedLines } = useMemo(() => {
    const map = new Map()
    const flagged = new Set()
    annotations.forEach((anno) => {
      const start = Number.isInteger(anno.lineStart) ? anno.lineStart : -1
      const end = Number.isInteger(anno.lineEnd) ? anno.lineEnd : start
      if (start < 0 || end < start || end >= lines.length) return
      for (let line = start; line <= end; line += 1) flagged.add(line)
      if (!map.has(end)) map.set(end, [])
      map.get(end).push(anno)
    })
    return { byLine: map, flaggedLines: flagged }
  }, [annotations, lines.length])
  return (
    <article className="contract-document review-document">
      <section className="contract-body">
        {lines.map((raw, i) => {
          const line = raw.trim()
          const annos = byLine.get(i) || []
          const flagged = flaggedLines.has(i)
          if (!line) return annos.length ? <div className="inline-annotations" key={`gap-${i}`}>{annos.map((a) => <AnnotationCard key={a.id} anno={a} selected={selectedIds.includes(a.id)} onToggle={onToggle} />)}</div> : null
          const heading = line.match(/^(#{1,4})\s+(.+)$/)
          if (heading) {
            const Tag = `h${Math.min(heading[1].length + 1, 4)}`
            return <React.Fragment key={`l-${i}`}>
              <Tag className={`clause-heading ${flagged ? 'clause-flagged' : ''}`}>{heading[2]}</Tag>
              {annos.length > 0 && <div className="inline-annotations">{annos.map((a) => <AnnotationCard key={a.id} anno={a} selected={selectedIds.includes(a.id)} onToggle={onToggle} />)}</div>}
            </React.Fragment>
          }
          return <React.Fragment key={`l-${i}`}>
            <p className={`clause-text ${flagged ? 'clause-flagged' : ''}`}>{inline(line)}</p>
            {annos.length > 0 && <div className="inline-annotations">{annos.map((a) => <AnnotationCard key={a.id} anno={a} selected={selectedIds.includes(a.id)} onToggle={onToggle} />)}</div>}
          </React.Fragment>
        })}
      </section>
    </article>
  )
}

function AnnotationCard({ anno, selected, onToggle }) {
  const meta = levelMeta(anno.level)
  return (
    <div className={`annotation-card ${meta.cls} ${selected ? 'selected' : ''}`}>
      <label className="annotation-check">
        <input type="checkbox" checked={selected} onChange={(e) => onToggle(anno.id)} />
      </label>
      <div className="annotation-body">
        <div className="annotation-head">
          <span className={`risk-level-tag ${meta.cls}`}>{meta.label}</span>
          <strong>{anno.title}</strong>
        </div>
        {anno.anchor && <p className="annotation-field"><i>原文定位</i>{anno.anchor}</p>}
        {anno.location && <p className="annotation-field"><i>位置</i>{anno.location}</p>}
        {anno.risk && <p className="annotation-field"><i>风险</i>{anno.risk}</p>}
        {anno.advice && <p className="annotation-field"><i>建议</i>{anno.advice}</p>}
      </div>
    </div>
  )
}

function ContractRewritePage() {
  const inputRef = useRef(null)
  const searchRef = useRef(null)
  const threadEndRef = useRef(null)
  const conversationRef = useRef(null)
  // 用户是否贴近底部：用于流式输出时决定是否自动跟随滚动
  const stickToBottomRef = useRef(true)
  const [threads, setThreads] = useState(() => {
    const saved = readStorage(THREAD_STORAGE_KEY, [])
    return saved.length ? saved : [createThread('商业合同审查与批注')]
  })
  const [tasks, setTasks] = useState(() => readStorage(TASK_STORAGE_KEY, []))
  const [activeThreadId, setActiveThreadId] = useState(() => readStorage(THREAD_STORAGE_KEY, [])[0]?.id || '')
  const [files, setFiles] = useState([])
  const [instruction, setInstruction] = useState('')
  const [mode, setMode] = useState('thinking')
  const [loading, setLoading] = useState(false)
  const [stage, setStage] = useState('')
  const [error, setError] = useState('')
  const [documentOpen, setDocumentOpen] = useState(false)
  const [documentMessageId, setDocumentMessageId] = useState('')
  const [showComments, setShowComments] = useState(false)
  const [historyQuery, setHistoryQuery] = useState('')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [taskModalOpen, setTaskModalOpen] = useState(false)
  const [taskTitle, setTaskTitle] = useState('')
  const [taskPrompt, setTaskPrompt] = useState('')
  const [confirming, setConfirming] = useState(false)
  // 批注勾选状态：按 message.id 维护，值为被选中的 annotation.id 数组
  const [selectedAnnotations, setSelectedAnnotations] = useState({})

  const activeThread = threads.find((thread) => thread.id === activeThreadId) || threads[0]
  const activeMessages = activeThread?.messages || []
  const selectedDocument = activeMessages.find((message) => message.id === documentMessageId)
  const documentText = normalizeDraftPlaceholders(selectedDocument?.rewrite || DEMO_DOCUMENT)
  const matchingThreads = useMemo(() => [...threads]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .filter((thread) => thread.title.toLowerCase().includes(historyQuery.trim().toLowerCase())), [historyQuery, threads])

  useEffect(() => {
    if (threads.length && !threads.some((thread) => thread.id === activeThreadId)) setActiveThreadId(threads[0].id)
  }, [activeThreadId, threads])

  useEffect(() => { window.localStorage.setItem(THREAD_STORAGE_KEY, JSON.stringify(threads)) }, [threads])
  useEffect(() => { window.localStorage.setItem(TASK_STORAGE_KEY, JSON.stringify(tasks)) }, [tasks])

  // 仅在用户已贴近底部时跟随滚动；流式增量更新时用 instant 避免动画抢夺滚动控制
  useEffect(() => {
    if (!stickToBottomRef.current) return
    const node = conversationRef.current
    if (!node) return
    node.scrollTop = node.scrollHeight
  }, [activeMessages, loading])

  // 监听对话区滚动：用户主动上滑时停止跟随，回到底部附近时恢复跟随
  useEffect(() => {
    const node = conversationRef.current
    if (!node) return
    const onScroll = () => {
      const threshold = 80
      stickToBottomRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < threshold
    }
    node.addEventListener('scroll', onScroll, { passive: true })
    return () => node.removeEventListener('scroll', onScroll)
  }, [documentOpen])
  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const updateThread = (threadId, updater) => setThreads((items) => items.map((thread) => thread.id === threadId ? { ...updater(thread), updatedAt: Date.now() } : thread))
  const appendMessage = (threadId, message) => updateThread(threadId, (thread) => ({ ...thread, title: thread.messages.length === 0 && message.role === 'user' ? displayTitle(message.content, thread.title) : thread.title, messages: [...thread.messages, message] }))
  const updateMessage = (threadId, messageId, patch) => updateThread(threadId, (thread) => ({ ...thread, messages: thread.messages.map((message) => message.id === messageId ? { ...message, ...patch } : message) }))

  const resetComposer = () => { setFiles([]); setInstruction(''); setError(''); setStage('') }
  const createConversation = (title = '新对话', taskId = null) => {
    const next = createThread(title, taskId)
    setThreads((items) => [next, ...items])
    setActiveThreadId(next.id)
    setDocumentOpen(false)
    resetComposer()
    return next
  }
  const deleteConversation = (event, threadId) => {
    event.stopPropagation()
    if (loading && threadId === activeThreadId) return
    setThreads((items) => {
      const remaining = items.filter((thread) => thread.id !== threadId)
      return remaining.length ? remaining : [createThread('新对话')]
    })
    setTasks((items) => items.filter((task) => task.threadId !== threadId))
    setDocumentOpen(false)
  }
  const selectConversation = (threadId) => {
    setActiveThreadId(threadId)
    setDocumentOpen(false)
    resetComposer()
    stickToBottomRef.current = true
  }
  const uploadFiles = (incoming) => {
    const next = incoming.filter(isSupported).slice(0, 6)
    if (next.length !== incoming.length) setError('仅支持 PDF、Word、PNG、JPG、WebP，且单个文件不超过 80MB。')
    else setError('')
    setFiles(next)
  }

  const readSSE = async (response, onEvent) => {
    const reader = response.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const packets = buffer.split('\n\n')
      buffer = packets.pop() || ''
      for (const packet of packets) {
        const event = packet.match(/^event:\s*(.+)$/m)?.[1]?.trim()
        const dataText = [...packet.matchAll(/^data:\s*(.+)$/gm)].map((match) => match[1]).join('\n')
        if (!event || !dataText) continue
        let data
        try { data = JSON.parse(dataText) } catch { data = { content: dataText } }
        onEvent(event, data)
      }
    }
  }

  const sendMessage = async () => {
    if (loading || (!files.length && !instruction.trim()) || !activeThread) return
    const threadId = activeThread.id
    const content = instruction.trim() || '请根据合同类型匹配知识库中的优秀模板和已批注风险案例，完成合规审查并生成带修改说明的合同稿。'
    const uploadedFiles = files.map((file) => ({ name: file.name, size: file.size }))
    const userMessage = { id: createId('message'), role: 'user', content, files: uploadedFiles, createdAt: Date.now() }
    const assistantId = createId('message')
    appendMessage(threadId, userMessage)
    appendMessage(threadId, { id: assistantId, role: 'assistant', content: '', mode, createdAt: Date.now(), status: files.length ? '正在读取合同文件…' : '正在思考…' })
    setInstruction('')
    setFiles([])
    setLoading(true)
    setError('')
    setStage(files.length ? 'parsing' : 'chat')
    let analysis = ''
    let review = ''
    let originalText = ''
    let reviewAnnotations = []
    try {
      if (uploadedFiles.length) {
        const form = new FormData()
        form.append('message', content)
        form.append('mode', mode)
        files.forEach((file) => form.append('files', file))
        const response = await fetch(REVIEW_ENDPOINT, { method: 'POST', headers: { Accept: 'text/event-stream' }, body: form })
        if (!response.ok || !response.body) throw new Error(await response.text() || '审查服务暂不可用。')
        await readSSE(response, (event, data) => {
          if (event === 'stage.start') {
            setStage(data.stage || '')
            updateMessage(threadId, assistantId, { status: data.label || '正在处理…' })
          }
          if (event === 'analysis.delta') { analysis += data.content || ''; updateMessage(threadId, assistantId, { content: analysis, analysis, status: '正在分析合同结构…' }) }
          if (event === 'review.delta') {
            review += data.content || ''
            // 拼接展示：分析报告 + 审查报告，而不是用审查覆盖分析
            const combined = analysis ? `${analysis}\n\n---\n\n${review}` : review
            updateMessage(threadId, assistantId, { content: combined, analysis, review, status: '正在审查风险条款…' })
          }
          if (event === 'review.original') {
            originalText = data.text || ''
            const reviewSession = data.reviewSession || {}
            reviewAnnotations = Array.isArray(reviewSession.findings) ? reviewSession.findings : []
            updateMessage(threadId, assistantId, {
              originalText,
              annotations: reviewAnnotations,
              reviewSessionId: reviewSession.id || '',
              reviewStats: reviewSession.stats || null,
              unresolvedAnnotations: Array.isArray(reviewSession.unresolved) ? reviewSession.unresolved : [],
              analysis,
              review,
              phase: 'review',
              status: '审查完成，请在右侧确认批注'
            })
          }
          if (event === 'error') throw new Error(data.message || '审查未完成，请稍后重试。')
        })
        const finalContent = analysis ? (review ? `${analysis}\n\n---\n\n${review}` : analysis) : (review || '合同审查已完成。')
        updateMessage(threadId, assistantId, { content: finalContent, annotations: reviewAnnotations, analysis, review, originalText, phase: 'review', status: '', completed: true })
        // 默认勾选全部已由服务端验证并定位的批注。
        const annos = reviewAnnotations
        if (annos.length) setSelectedAnnotations((prev) => ({ ...prev, [assistantId]: annos.map((a) => a.id) }))
      } else {
        const history = activeMessages.slice(-10).map((message) => ({ role: message.role, content: message.content })).filter((message) => message.content)
        const response = await fetch(CHAT_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify({ message: content, mode, history }) })
        if (!response.ok || !response.body) throw new Error(await response.text() || '对话服务暂不可用。')
        let answer = ''
        await readSSE(response, (event, data) => {
          if (event === 'chat.start') updateMessage(threadId, assistantId, { model: data.model, status: mode === 'thinking' ? '正在深度思考…' : '正在快速回复…' })
          if (event === 'chat.delta') { answer += data.content || ''; updateMessage(threadId, assistantId, { content: answer, status: '' }) }
          if (event === 'error') throw new Error(data.message || '对话未完成，请稍后重试。')
        })
        updateMessage(threadId, assistantId, { status: '', completed: true })
      }
    } catch (requestError) {
      updateMessage(threadId, assistantId, { content: '本次处理未完成。', status: '', failed: true })
      setError(requestError.message || '请求未完成，请稍后重试。')
    } finally {
      setLoading(false)
      setStage('')
    }
  }

  const createTask = (event) => {
    event.preventDefault()
    const title = taskTitle.trim() || '新审查任务'
    const thread = createConversation(title)
    const task = { id: createId('task'), title, prompt: taskPrompt.trim(), mode, threadId: thread.id, createdAt: Date.now() }
    setTasks((items) => [task, ...items])
    setInstruction(task.prompt)
    setTaskTitle('')
    setTaskPrompt('')
    setTaskModalOpen(false)
  }
  const openTask = (task) => { selectConversation(task.threadId); setInstruction(task.prompt || ''); setMode(task.mode || 'thinking') }
  const deleteTask = (event, taskId) => { event.stopPropagation(); setTasks((items) => items.filter((task) => task.id !== taskId)) }
  const openDocument = (messageId) => { setDocumentMessageId(messageId); setDocumentOpen(true); setShowComments(false) }

  // 批注勾选：target 可以是 'all' / 'none' / 具体 annotation.id
  const toggleAnnotation = (messageId) => (target) => {
    setSelectedAnnotations((prev) => {
      const message = activeMessages.find((m) => m.id === messageId)
      const annos = messageAnnotations(message)
      const current = prev[messageId] || []
      if (target === 'all') return { ...prev, [messageId]: annos.map((a) => a.id) }
      if (target === 'none') return { ...prev, [messageId]: [] }
      return { ...prev, [messageId]: current.includes(target) ? current.filter((id) => id !== target) : [...current, target] }
    })
  }

  // 阶段2：基于用户确认采纳的批注，调用 Agent 3 生成修订稿。
  const finalizeRewrite = async (messageId) => {
    const message = activeMessages.find((m) => m.id === messageId)
    if (!message || !message.originalText) return
    const annotations = messageAnnotations(message)
    const selectedIds = selectedAnnotations[messageId] || annotations.map((a) => a.id)
    const selectedFindingIds = annotations.filter((a) => selectedIds.includes(a.id)).map((a) => a.id)
    if (!message.reviewSessionId) { setError('本次审查缺少有效会话，请重新审查后再生成修订稿。'); return }
    if (!selectedFindingIds.length) { setError('请至少选择一条批注后再生成修订稿。'); return }
    setConfirming(true)
    setError('')
    const assistantId = createId('message')
    appendMessage(activeThread.id, { id: assistantId, role: 'assistant', content: '', mode, createdAt: Date.now(), status: '正在依据已确认批注生成修订稿…', phase: 'rewrite' })
    let rewrite = ''
    try {
      const response = await fetch(FINALIZE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({
          mode,
          reviewSessionId: message.reviewSessionId,
          selectedFindingIds
        })
      })
      if (!response.ok || !response.body) throw new Error(await response.text() || '改写服务暂不可用。')
      await readSSE(response, (event, data) => {
        if (event === 'stage.start') updateMessage(activeThread.id, assistantId, { status: data.label || '正在生成修订稿…' })
        if (event === 'rewrite.delta') { rewrite += data.content || ''; updateMessage(activeThread.id, assistantId, { content: '正在生成修订稿…', rewrite, status: '正在生成修订稿…' }) }
        if (event === 'error') throw new Error(data.message || '改写未完成，请稍后重试。')
      })
      updateMessage(activeThread.id, assistantId, { content: '已根据您确认的批注生成修订稿。', rewrite: normalizeDraftPlaceholders(rewrite), status: '', phase: 'rewrite', completed: true })
      setDocumentMessageId(assistantId)
    } catch (requestError) {
      updateMessage(activeThread.id, assistantId, { content: '本次改写未完成。', status: '', failed: true })
      setError(requestError.message || '改写未完成，请稍后重试。')
    } finally {
      setConfirming(false)
    }
  }
  const exportWord = () => {
    const name = activeThread?.title || '商业合同审查稿'
    const renderInline = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/【\s*([^】]+)\s*】/g, '【$1】')
    const htmlBody = documentText.split('\n').map((raw) => {
      const line = raw.trim()
      if (!line) return ''
      if (/^#\s+/.test(line)) return `<h1>${renderInline(line.replace(/^#\s+/, ''))}</h1>`
      if (/^##\s+/.test(line)) return `<h2>${renderInline(line.replace(/^##\s+/, ''))}</h2>`
      if (isAnnotationLine(line)) return `<p class="anno">${renderInline('【风险批注】' + line.replace(ANNOTATION_RE, '$1'))}</p>`
      if (/^[-*+]\s+/.test(line)) return `<p class="li">${renderInline(line.replace(/^[-*+]\s+/, ''))}</p>`
      return `<p>${renderInline(line)}</p>`
    }).join('')
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:SimSun,serif;margin:48px;color:#111;line-height:1.85}h1{text-align:center;font-size:22pt}h2{margin-top:24px;font-size:15pt}p{font-size:12pt}p.anno{color:#c0392b;border-left:3px solid #c0392b;padding-left:10px;background:#fdf0ee}p.li{margin-left:24px;text-indent:-12pt}</style></head><body>${htmlBody}</body></html>`
    const url = URL.createObjectURL(new Blob([html], { type: 'application/msword' }))
    const anchor = document.createElement('a')
    anchor.href = url; anchor.download = `${name}-审查批注稿.doc`; anchor.click(); URL.revokeObjectURL(url)
  }

  const status = stage === 'parsing' ? '正在读取合同文件…' : stage === 'analysis' ? '正在识别合同结构…' : stage === 'knowledge' ? '正在匹配参考资料…' : stage === 'review' ? '正在审查风险条款…' : stage === 'rewrite' ? '正在生成批注稿…' : mode === 'thinking' ? '正在深度思考…' : '正在快速回复…'

  return <main className={`contract-chat ${documentOpen ? 'document-expanded' : ''} ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
    {!documentOpen && <aside className="chat-sidebar">
      <label className="sidebar-search"><History size={17} /><input ref={searchRef} value={historyQuery} onChange={(event) => setHistoryQuery(event.target.value)} placeholder="搜索历史对话" /><kbd>⌘ K</kbd></label>
      <div className="sidebar-brand"><span className="brand-orb"><Sparkles size={15} /></span><strong>法飞飞</strong></div>
      <button className="sidebar-action" onClick={() => createConversation()}><PenLine size={20} />新对话</button>
      <button className="sidebar-action" onClick={() => setTaskModalOpen(true)}><FolderOpen size={20} />新审查任务</button>
      <p className="history-label">历史对话</p>
      <nav className="history-list">{matchingThreads.map((thread) => <button className={thread.id === activeThread?.id ? 'selected' : ''} key={thread.id} onClick={() => selectConversation(thread.id)}><MessageCircle size={16} /><span>{thread.title}</span><i className="history-delete" title="删除对话" onClick={(event) => deleteConversation(event, thread.id)}><Trash2 size={14} /></i></button>)}</nav>
      {tasks.length > 0 && <><p className="history-label task-label">审查任务</p><nav className="history-list task-list">{tasks.map((task) => <button key={task.id} className={task.threadId === activeThread?.id ? 'selected' : ''} onClick={() => openTask(task)}><FolderOpen size={16} /><span>{task.title}</span><i className="history-delete" title="删除任务" onClick={(event) => deleteTask(event, task.id)}><Trash2 size={14} /></i></button>)}</nav></>}
      <div className="sidebar-footer"><span className="footer-avatar">法</span><span>法飞飞合同助手</span></div>
    </aside>}

    <section className="chat-column">
      <header className="chat-header">
        <div className="header-left">{documentOpen ? <button className="icon-button" aria-label="返回对话" onClick={() => setDocumentOpen(false)}><ChevronLeft size={21} /></button> : <><button className="icon-button sidebar-toggle" aria-label={sidebarCollapsed ? '展开历史对话栏' : '折叠历史对话栏'} title={sidebarCollapsed ? '展开历史对话栏' : '折叠历史对话栏'} onClick={() => setSidebarCollapsed((value) => !value)}><PanelLeft size={21} /></button><Link className="icon-button" aria-label="返回首页" to="/"><ArrowLeft size={20} /></Link></>}</div>
        <div className="chat-title"><strong>{activeThread?.title || '商业合同审查助手'}</strong><small>AI 生成内容仅供参考，请结合实际情况判断</small></div>
        <div className="header-tools" />
      </header>

      <div className="conversation" ref={conversationRef}>
        <div className="conversation-inner">
          {activeMessages.length === 0 && <div className="assistant-turn welcome-turn"><div><p>你好，我是法飞飞合同审查助手。上传合同后，我会结合对应合同类型的优质模板和风险案例，帮你梳理风险、生成修改建议，并输出一份可继续编辑的批注稿。</p></div></div>}
          {activeMessages.map((message) => message.role === 'user'
            ? <div className="user-turn" key={message.id}><p>{message.content}</p>{message.files?.map((file) => <div className="attached-file" key={`${message.id}-${file.name}`}><FileText size={18} /><span>{file.name}</span><small>{Math.ceil(file.size / 1024)} KB</small></div>)}</div>
            : <div className="assistant-turn result-turn" key={message.id}><div>{message.status && !message.content ? <p className="assistant-status"><Loader2 size={15} className="spinner" />{message.status}</p> : <>{message.content && <div className="assistant-content"><ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown></div>}{message.failed && <small className="message-failed">请检查服务配置后重新发送。</small>}{message.phase === 'review' && message.originalText && <button className="open-document-card review-card" onClick={() => openDocument(message.id)}><FileText size={25} /><span><strong>风险批注待确认</strong><small>点击右侧勾选批注，确认后生成修订稿</small></span></button>}{message.phase === 'rewrite' && message.rewrite && <button className="open-document-card" onClick={() => openDocument(message.id)}><FileText size={25} /><span><strong>商业合同审查批注稿</strong><small>已生成 · 点击展开文档</small></span></button>}</>}</div></div>)}
          {loading && <div className="assistant-turn loading-turn"><div><p>{status}</p></div></div>}
          {error && <p className="chat-error">{error}</p>}
          {!activeMessages.length && <div className="starter-prompts"><button onClick={() => setInstruction('请从甲方视角重点审查付款、验收和违约责任。')}>从甲方视角审查付款与违约责任 <span>→</span></button><button onClick={() => setInstruction('请检查合同是否缺少核心条款。')}>检查是否缺少核心条款 <span>→</span></button></div>}
        </div>
      </div>

      <div className="composer-wrap"><div className="composer">
        <textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); sendMessage() } }} placeholder="上传合同或输入你特别关注的审查重点…" disabled={loading} />
        {files.length > 0 && <div className="pending-files">{files.map((file) => <span key={file.name}><FileText size={14} />{file.name}<button aria-label={`移除 ${file.name}`} onClick={() => setFiles((items) => items.filter((item) => item !== file))}><X size={13} /></button></span>)}</div>}
        <div className="composer-bottom"><div className="composer-tools"><button onClick={() => inputRef.current?.click()} title="上传合同"><Plus size={24} /></button><i /><div className="mode-switch" aria-label="模型模式"><button className={mode === 'fast' ? 'active' : ''} onClick={() => setMode('fast')} title="使用 DeepSeek-v4-flash"><Zap size={16} />快速</button><button className={mode === 'thinking' ? 'active' : ''} onClick={() => setMode('thinking')} title="使用 DeepSeek-v4-pro"><Brain size={16} />深度思考</button></div><button className="tool-text mobile-hide" onClick={() => setTaskModalOpen(true)}><Menu size={18} />更多</button></div><button className="voice-send" onClick={sendMessage} disabled={loading || (!files.length && !instruction.trim())} aria-label="发送消息">{loading ? <Loader2 size={20} className="spinner" /> : <Send size={19} />}</button></div>
        <input ref={inputRef} hidden type="file" multiple accept={ACCEPTED} onChange={(event) => { uploadFiles([...event.target.files]); event.target.value = '' }} />
      </div></div>
    </section>

    {documentOpen && selectedDocument && <section className="document-column">
      <header className="document-header"><span>{selectedDocument.phase === 'review' ? '风险批注待确认' : '修订稿'}</span><div>{selectedDocument.phase === 'rewrite' && <><button title="复制合同" onClick={() => navigator.clipboard?.writeText(documentText)}><Copy size={18} />复制</button><button title="下载 Word" onClick={exportWord}><Download size={18} />下载</button><button className={showComments ? 'comments-active' : ''} onClick={() => setShowComments((value) => !value)}><MessageCircle size={18} />批注</button></>}<button className="close-document" aria-label="关闭文档" onClick={() => setDocumentOpen(false)}><X size={21} /></button></div></header>
      {selectedDocument.phase === 'review' ? (() => {
        const annotations = messageAnnotations(selectedDocument)
        const selectedIds = selectedAnnotations[selectedDocument.id] || annotations.map((a) => a.id)
        const allSelected = annotations.length > 0 && annotations.every((a) => selectedIds.includes(a.id))
        const selectedCount = annotations.filter((a) => selectedIds.includes(a.id)).length
        const unresolved = selectedDocument.unresolvedAnnotations || []
        return <>
          <div className="review-toolbar">
            <span className="review-toolbar-title">共 {annotations.length} 条批注，已选择 {selectedCount} 条</span>
            <label className="review-select-all">
              <input type="checkbox" checked={allSelected} onChange={(e) => toggleAnnotation(selectedDocument.id)(e.target.checked ? 'all' : 'none')} />
              <span>全选</span>
            </label>
          </div>
          <div className="document-scroll">
            <ReviewDocument
              originalText={selectedDocument.originalText || ''}
              annotations={annotations}
              selectedIds={selectedIds}
              onToggle={toggleAnnotation(selectedDocument.id)}
            />
            {unresolved.length > 0 && <aside className="review-unresolved">
              <strong>待核查定位项</strong>
              <p>以下模型结论未能唯一对应到原文，因此没有加入本轮可确认批注，也不会被带入修订稿。</p>
              <ul>{unresolved.map((item) => <li key={`${item.sourceIndex}-${item.title}`}><b>{item.title}</b>：{item.reason}{item.declaredAnchor ? `（模型定位 ${item.declaredAnchor}）` : ''}</li>)}</ul>
            </aside>}
          </div>
          <div className="review-confirm-bar">
            <span>已选择 <b>{selectedCount}</b> / {annotations.length} 条批注</span>
            <button className="confirm-rewrite-btn" onClick={() => finalizeRewrite(selectedDocument.id)} disabled={confirming || selectedCount === 0}>
              {confirming ? <Loader2 size={16} className="spinner" /> : <PenLine size={16} />}
              {confirming ? '正在生成修订稿…' : '确认批注，生成修订稿'}
            </button>
          </div>
        </>
      })() : (
        <div className="document-scroll"><ContractDocument text={documentText} comments={showComments} />{showComments && (() => { const annos = extractAnnotations(documentText); return annos.length > 0 ? <aside className="document-comments"><p><b>{annos.length}</b> 处风险批注</p>{annos.map((a, idx) => <div key={idx}>{inline(a)}</div>)}</aside> : null })()}</div>
      )}
    </section>}

    {taskModalOpen && <div className="task-modal-backdrop" role="presentation" onMouseDown={() => setTaskModalOpen(false)}><form className="task-modal" onSubmit={createTask} onMouseDown={(event) => event.stopPropagation()}><div><strong>新审查任务</strong><button type="button" aria-label="关闭" onClick={() => setTaskModalOpen(false)}><X size={19} /></button></div><label>任务名称<input value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} placeholder="例如：供应商年度采购合同" autoFocus /></label><label>审查要求<textarea value={taskPrompt} onChange={(event) => setTaskPrompt(event.target.value)} placeholder="可填写审查视角、关注条款或交付要求" /></label><p>创建后会打开独立对话，可上传合同后开始审查。</p><footer><button type="button" onClick={() => setTaskModalOpen(false)}>取消</button><button className="task-primary" type="submit">创建任务</button></footer></form></div>}
  </main>
}

export default ContractRewritePage
