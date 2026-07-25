import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  ArrowLeft,
  Brain,
  ChevronDown,
  ChevronLeft,
  CircleDollarSign,
  Copy,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  History,
  Loader2,
  Menu,
  MessageCircle,
  PanelLeft,
  PenLine,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  X,
  Zap
} from 'lucide-react'
import './ContractRewritePage.css'

const REVIEW_ENDPOINT = '/api/contract-rewrite'
const CHAT_ENDPOINT = '/api/contract-chat'
const BALANCE_ENDPOINT = '/api/account/balance'
const ACCEPTED = '.pdf,.doc,.docx,.png,.jpg,.jpeg,.webp'
const MAX_FILE_SIZE = 80 * 1024 * 1024
const THREAD_STORAGE_KEY = 'fafee-contract-threads-v1'
const TASK_STORAGE_KEY = 'fafee-contract-tasks-v1'

const getExtension = (name = '') => name.toLowerCase().match(/\.[^.]+$/)?.[0] || ''
const isSupported = (file) => ACCEPTED.includes(getExtension(file.name)) && file.size <= MAX_FILE_SIZE
const inline = (text) => text.split(/(\*\*[^*]+\*\*)/g).map((part, index) => part.startsWith('**') ? <strong key={index}>{part.slice(2, -2)}</strong> : <React.Fragment key={index}>{part}</React.Fragment>)
const createId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const stripLegacyFileMarkers = (text = '') => text
  .split('\n')
  .filter((line) => !/^===\s*文件\s*[：:]/.test(line.trim()))
  .join('\n')
const createThread = (title = '新对话', taskId = null) => ({ id: createId('thread'), title, taskId, createdAt: Date.now(), updatedAt: Date.now(), messages: [] })
const asText = (value, fallback = '') => typeof value === 'string' ? value : fallback
const asTimestamp = (value, fallback = Date.now()) => Number.isFinite(Number(value)) ? Number(value) : fallback
const normalizeStoredMessage = (message) => {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return null
  const files = Array.isArray(message.files)
    ? message.files
      .filter((file) => file && typeof file === 'object' && !Array.isArray(file))
      .map((file) => ({
        ...file,
        name: asText(file.name, '合同文件'),
        size: Number.isFinite(Number(file.size)) ? Number(file.size) : 0
      }))
    : []
  return {
    ...message,
    id: asText(message.id, createId('message')),
    role: message.role === 'user' ? 'user' : 'assistant',
    content: asText(message.content),
    status: asText(message.status),
    originalText: asText(message.originalText),
    contractText: asText(message.contractText),
    rewrite: asText(message.rewrite),
    files,
    revisions: Array.isArray(message.revisions)
      ? message.revisions.filter((rev) => rev && typeof rev === 'object' && !Array.isArray(rev))
      : [],
    rewriteStats: message.rewriteStats && typeof message.rewriteStats === 'object' ? message.rewriteStats : null,
    reviewRounds: Array.isArray(message.reviewRounds)
      ? message.reviewRounds.filter((item) => item && typeof item === 'object' && !Array.isArray(item)).map((item) => ({
          round: Number.isFinite(Number(item.round)) ? Number(item.round) : 0,
          newCount: Number.isFinite(Number(item.newCount)) ? Number(item.newCount) : 0,
          newFindings: Array.isArray(item.newFindings) ? item.newFindings.filter((f) => f && typeof f === 'object') : []
        }))
      : [],
    createdAt: asTimestamp(message.createdAt)
  }
}
const normalizeStoredThreads = (value) => {
  if (!Array.isArray(value)) return []
  return value.flatMap((thread) => {
    if (!thread || typeof thread !== 'object' || Array.isArray(thread)) return []
    const messages = Array.isArray(thread.messages)
      ? thread.messages.map(normalizeStoredMessage).filter(Boolean)
      : []
    return [{
      ...thread,
      id: asText(thread.id, createId('thread')),
      title: asText(thread.title, '历史对话'),
      taskId: typeof thread.taskId === 'string' ? thread.taskId : null,
      createdAt: asTimestamp(thread.createdAt),
      updatedAt: asTimestamp(thread.updatedAt, asTimestamp(thread.createdAt)),
      messages
    }]
  })
}
const normalizeStoredTasks = (value) => {
  if (!Array.isArray(value)) return []
  return value.flatMap((task) => {
    if (!task || typeof task !== 'object' || Array.isArray(task)) return []
    const threadId = asText(task.threadId)
    if (!threadId) return []
    return [{
      ...task,
      id: asText(task.id, createId('task')),
      title: asText(task.title, '历史审查任务'),
      prompt: asText(task.prompt),
      mode: task.mode === 'fast' ? 'fast' : 'thinking',
      threadId,
      createdAt: asTimestamp(task.createdAt)
    }]
  })
}
const readStorage = (key, fallback, normalize) => {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) || '')
    return normalize(value)
  } catch { return fallback }
}
const writeStorage = (key, value) => {
  try { window.localStorage.setItem(key, JSON.stringify(value)) } catch { /* 浏览器禁用或存储空间不足时不阻断页面 */ }
}
const displayTitle = (content, fallback = '新对话') => content.trim().replace(/\s+/g, ' ').slice(0, 22) || fallback

const LEVEL_META = {
  高: { key: 'high', label: '高风险', cls: 'level-high' },
  中: { key: 'mid', label: '中风险', cls: 'level-mid' },
  低: { key: 'low', label: '低风险', cls: 'level-low' }
}
const levelMeta = (level) => LEVEL_META[level] || LEVEL_META.中

const ACTION_META = {
  modify: { label: '修订', cls: 'action-modify' },
  add: { label: '新增', cls: 'action-add' },
  delete: { label: '删除', cls: 'action-delete' }
}
const actionMeta = (action) => ACTION_META[action] || ACTION_META.modify

// 修订稿文档：原合同按行渲染，每条修订块以「行内三明治视图」插在对应条款下方。
// 原句、行号、风险等级均来自服务端 buildReviewResult（可信），Agent 3 只产出改写文本与批注说明。
function RevisionDocument({ contractText, revisions }) {
  const lines = useMemo(() => stripLegacyFileMarkers(contractText || '').split('\n'), [contractText])
  const { byLine, flaggedLines } = useMemo(() => {
    const map = new Map()
    const flagged = new Set()
    ;(Array.isArray(revisions) ? revisions : []).forEach((rev) => {
      const start = Number.isInteger(rev.lineStart) ? rev.lineStart : -1
      const end = Number.isInteger(rev.lineEnd) ? rev.lineEnd : start
      if (start < 0 || end < start || end >= lines.length) return
      for (let line = start; line <= end; line += 1) flagged.add(line)
      if (!map.has(end)) map.set(end, [])
      map.get(end).push(rev)
    })
    return { byLine: map, flaggedLines: flagged }
  }, [revisions, lines.length])
  return (
    <article className="contract-document revision-document">
      <section className="contract-body">
        {lines.map((raw, i) => {
          const line = raw.trim()
          const revs = byLine.get(i) || []
          const flagged = flaggedLines.has(i)
          if (!line) return revs.length ? <div className="revision-stack" key={`gap-${i}`}>{revs.map((rev) => <SandwichBlock key={rev.findingId} revision={rev} />)}</div> : null
          const heading = line.match(/^(#{1,4})\s+(.+)$/)
          if (heading) {
            const Tag = `h${Math.min(heading[1].length + 1, 4)}`
            return <React.Fragment key={`l-${i}`}>
              <Tag className={`clause-heading ${flagged ? 'clause-flagged' : ''}`}>{heading[2]}</Tag>
              {revs.length > 0 && <div className="revision-stack">{revs.map((rev) => <SandwichBlock key={rev.findingId} revision={rev} />)}</div>}
            </React.Fragment>
          }
          return <React.Fragment key={`l-${i}`}>
            <p className={`clause-text ${flagged ? 'clause-flagged' : ''}`}>{inline(line)}</p>
            {revs.length > 0 && <div className="revision-stack">{revs.map((rev) => <SandwichBlock key={rev.findingId} revision={rev} />)}</div>}
          </React.Fragment>
        })}
      </section>
    </article>
  )
}

// 三明治视图：原文（删除线）→ 改写句（红色）→ 批注说明（浅红底），垂直堆叠。
function SandwichBlock({ revision: rev }) {
  const meta = levelMeta(rev.level)
  const act = actionMeta(rev.action)
  return (
    <div className={`revision-sandwich ${meta.cls} ${act.cls}`}>
      <div className="revision-row revision-original">
        <span className="revision-label">原文</span>
        <span className="revision-text original-text">{rev.originalText}</span>
      </div>
      {rev.action !== 'delete' && rev.rewrittenText && (
        <div className="revision-row revision-rewritten">
          <span className="revision-label">{act.label}</span>
          <span className="revision-text rewritten-text">{rev.rewrittenText}</span>
        </div>
      )}
      {rev.action !== 'delete' && !rev.rewrittenText && (
        <div className="revision-row revision-rewritten">
          <span className="revision-label">{act.label}</span>
          <span className="revision-text rewritten-text manual-hint">未能自动生成改写，请参考下方批注手动修订</span>
        </div>
      )}
      {rev.action === 'delete' && (
        <div className="revision-row revision-rewritten">
          <span className="revision-label">{act.label}</span>
          <span className="revision-text rewritten-text delete-hint">建议删除该条款</span>
        </div>
      )}
      <div className="revision-row revision-note">
        <span className="revision-label">批注</span>
        <span className="revision-text note-text">{rev.riskNote}</span>
      </div>
    </div>
  )
}

// 审查轮次进度面板：在对话气泡中实时展示「第X轮发现/新增了哪些问题」。
// 每轮一个折叠条目，展开后罗列该轮新增的风险点（等级 + 标题 + 位置 + 风险摘要）。
function ReviewRoundsPanel({ rounds, thinking }) {
  if (!rounds.length && !thinking) return null
  const totalFindings = rounds.reduce((sum, r) => sum + (r.newCount || 0), 0)
  return (
    <div className="review-rounds-panel">
      <div className="rounds-panel-head">
        <span className="rounds-panel-title">三轮审查进度</span>
        <span className="rounds-panel-summary">{rounds.length}/3 轮完成{totalFindings > 0 ? ` · 累计发现 ${totalFindings} 条问题` : ''}</span>
      </div>
      <div className="rounds-panel-body">
        {[1, 2, 3].map((roundNum) => {
          const round = rounds.find((r) => r.round === roundNum)
          const isThinking = thinking && !round && roundNum === (rounds.length + 1)
          const isPending = !round && !isThinking
          return (
            <div key={roundNum} className={`round-item ${round ? 'round-done' : ''} ${isThinking ? 'round-thinking' : ''} ${isPending ? 'round-pending' : ''}`}>
              <div className="round-item-head">
                <span className="round-badge">{roundNum}</span>
                <span className="round-label">{roundNum === 1 ? '首轮审查' : roundNum === 2 ? '二轮复审' : '三轮复审'}</span>
                <span className="round-status">
                  {round ? (round.newCount > 0 ? `新增 ${round.newCount} 条` : '未发现新问题') : isThinking ? <Loader2 size={13} className="spinner" /> : '待开始'}
                </span>
              </div>
              {round && round.newFindings.length > 0 && (
                <ul className="round-findings">
                  {round.newFindings.map((finding, idx) => {
                    const meta = levelMeta(finding.level)
                    return (
                      <li key={idx} className={`round-finding ${meta.cls}`}>
                        <span className={`finding-level-tag ${meta.cls}`}>{meta.label}</span>
                        <span className="finding-title">{finding.title}</span>
                        {finding.location && <span className="finding-location">{finding.location}</span>}
                        {finding.risk && <span className="finding-risk">{finding.risk}</span>}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )
        })}
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
    const saved = readStorage(THREAD_STORAGE_KEY, [], normalizeStoredThreads)
    return saved.length ? saved : [createThread('商业合同审查与批注')]
  })
  const [tasks, setTasks] = useState(() => readStorage(TASK_STORAGE_KEY, [], normalizeStoredTasks))
  const [activeThreadId, setActiveThreadId] = useState('')
  const [files, setFiles] = useState([])
  const [instruction, setInstruction] = useState('')
  const [mode, setMode] = useState('thinking')
  const [loading, setLoading] = useState(false)
  const [stage, setStage] = useState('')
  const [error, setError] = useState('')
  const [documentOpen, setDocumentOpen] = useState(false)
  const [documentMessageId, setDocumentMessageId] = useState('')
  const [historyQuery, setHistoryQuery] = useState('')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [taskModalOpen, setTaskModalOpen] = useState(false)
  const [taskTitle, setTaskTitle] = useState('')
  const [taskPrompt, setTaskPrompt] = useState('')
  const [balanceOpen, setBalanceOpen] = useState(false)
  const [balanceLoading, setBalanceLoading] = useState(false)
  const [balanceError, setBalanceError] = useState('')
  const [balanceData, setBalanceData] = useState(null)

  const activeThread = threads.find((thread) => thread.id === activeThreadId) || threads[0]
  const activeMessages = activeThread?.messages || []
  const selectedDocument = activeMessages.find((message) => message.id === documentMessageId)
  // 修订稿文档数据：合同原文 + 结构化修订块（三明治视图）。两者均来自后端 rewrite.result 事件。
  const documentContractText = selectedDocument?.contractText || selectedDocument?.originalText || ''
  const documentRevisions = selectedDocument?.revisions || []
  const cnyBalance = balanceData?.balances?.find((item) => item.currency === 'CNY') || null
  const matchingThreads = useMemo(() => [...threads]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .filter((thread) => thread.title.toLowerCase().includes(historyQuery.trim().toLowerCase())), [historyQuery, threads])

  useEffect(() => {
    if (threads.length && !threads.some((thread) => thread.id === activeThreadId)) setActiveThreadId(threads[0].id)
  }, [activeThreadId, threads])

  useEffect(() => { writeStorage(THREAD_STORAGE_KEY, threads) }, [threads])
  useEffect(() => { writeStorage(TASK_STORAGE_KEY, tasks) }, [tasks])

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
  const loadBalance = async () => {
    setBalanceLoading(true)
    setBalanceError('')
    try {
      const response = await fetch(BALANCE_ENDPOINT, { headers: { Accept: 'application/json' }, cache: 'no-store' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || '暂时无法读取剩余用量。')
      setBalanceData(payload)
    } catch (requestError) {
      setBalanceError(requestError.message || '暂时无法读取剩余用量。')
    } finally {
      setBalanceLoading(false)
    }
  }
  const toggleBalancePanel = () => {
    const nextOpen = !balanceOpen
    setBalanceOpen(nextOpen)
    if (nextOpen) loadBalance()
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
    let rewriteRevisions = []
    let rewriteStats = null
    let reviewRounds = []
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
          if (event === 'stage.progress') {
            updateMessage(threadId, assistantId, { status: data.message || '正在处理…' })
          }
          if (event === 'review.round') {
            // 三轮审核进度：start 显示当前轮次状态，end 追加本轮新增问题清单
            setStage('review')
            if (data.phase === 'end') {
              // 本轮结束：记录新增问题快照，供对话区实时罗列
              const snapshot = {
                round: Number(data.round) || 0,
                newCount: Number(data.newCount) || 0,
                newFindings: Array.isArray(data.newFindings) ? data.newFindings : []
              }
              reviewRounds = [...reviewRounds.filter((r) => r.round !== snapshot.round), snapshot]
              updateMessage(threadId, assistantId, { reviewRounds, status: data.message || `第 ${data.round}/${data.total} 轮审查完成` })
            } else {
              updateMessage(threadId, assistantId, { status: data.message || `第 ${data.round}/${data.total} 轮审查中…` })
            }
          }
          if (event === 'analysis.delta') { analysis += data.content || ''; updateMessage(threadId, assistantId, { content: analysis, analysis, status: '正在分析合同结构…' }) }
          if (event === 'review.delta') {
            review += data.content || ''
            // 拼接展示：分析报告 + 审查报告，而不是用审查覆盖分析
            const combined = analysis ? `${analysis}\n\n---\n\n${review}` : review
            updateMessage(threadId, assistantId, { content: combined, analysis, review, reviewRounds, status: '正在审查风险条款…' })
          }
          if (event === 'review.original') {
            // 兼容事件：保留原合同文本，供修订稿文档渲染原文
            originalText = data.text || ''
            const reviewSession = data.reviewSession || {}
            updateMessage(threadId, assistantId, {
              originalText,
              reviewSessionId: reviewSession.id || '',
              reviewStats: reviewSession.stats || null,
              analysis,
              review
            })
          }
          if (event === 'rewrite.result') {
            // 结构化修订结果：合同原文 + 修订块数组。前端据此渲染「行内三明治视图」。
            setStage('rewrite')
            rewriteRevisions = Array.isArray(data.revisions) ? data.revisions : []
            rewriteStats = data.stats || null
            originalText = data.contractText || originalText
            updateMessage(threadId, assistantId, {
              contractText: data.contractText || originalText,
              revisions: rewriteRevisions,
              rewriteStats,
              originalText: data.contractText || originalText,
              analysis,
              review,
              status: '正在生成修订稿…'
            })
          }
          if (event === 'error') throw new Error(data.message || '审查未完成，请稍后重试。')
        })
        const finalContent = analysis ? (review ? `${analysis}\n\n---\n\n${review}` : analysis) : (review || '合同审查已完成。')
        updateMessage(threadId, assistantId, {
          content: finalContent,
          analysis,
          review,
          reviewRounds,
          originalText,
          contractText: originalText,
          revisions: rewriteRevisions,
          rewriteStats,
          phase: 'rewrite',
          status: '',
          completed: true
        })
        // 审核改写一体完成后，自动展开修订稿文档供用户查看
        if (rewriteRevisions.length || originalText) {
          setDocumentMessageId(assistantId)
          setDocumentOpen(true)
        }
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
  const openDocument = (messageId) => { setDocumentMessageId(messageId); setDocumentOpen(true) }

  // 导出 Word：基于「合同原文 + 结构化修订块」生成 HTML，三明治样式（原句删除线、改写红色、批注浅红底）。
  const exportWord = () => {
    const name = activeThread?.title || '商业合同审查稿'
    const text = documentContractText || selectedDocument?.rewrite || ''
    const revisions = Array.isArray(documentRevisions) ? documentRevisions : []
    const renderInline = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    // 按行号把修订块分组（与 RevisionDocument 的 byLine 逻辑一致）
    const revByEndLine = new Map()
    revisions.forEach((rev) => {
      const end = Number.isInteger(rev.lineEnd) ? rev.lineEnd : -1
      if (end < 0) return
      if (!revByEndLine.has(end)) revByEndLine.set(end, [])
      revByEndLine.get(end).push(rev)
    })
    const renderRevBlock = (rev) => {
      const original = `<p class="rev-row rev-original"><span class="rev-label">原文</span><span class="rev-text">${renderInline(rev.originalText)}</span></p>`
      const rewritten = rev.action === 'delete'
        ? `<p class="rev-row rev-rewritten"><span class="rev-label">删除</span><span class="rev-text">建议删除该条款</span></p>`
        : (rev.rewrittenText ? `<p class="rev-row rev-rewritten"><span class="rev-label">${rev.action === 'add' ? '新增' : '修订'}</span><span class="rev-text">${renderInline(rev.rewrittenText)}</span></p>` : '')
      const note = `<p class="rev-row rev-note"><span class="rev-label">批注</span><span class="rev-text">${renderInline(rev.riskNote)}</span></p>`
      return `<div class="rev-sandwich">${original}${rewritten}${note}</div>`
    }
    const lines = stripLegacyFileMarkers(text).split('\n')
    const htmlBody = lines.map((raw, i) => {
      const line = raw.trim()
      const revs = revByEndLine.get(i) || []
      const revHtml = revs.map(renderRevBlock).join('')
      if (!line) return revHtml
      if (/^#\s+/.test(line)) return `<h1>${renderInline(line.replace(/^#\s+/, ''))}</h1>${revHtml}`
      if (/^##\s+/.test(line)) return `<h2>${renderInline(line.replace(/^##\s+/, ''))}</h2>${revHtml}`
      if (/^[-*+]\s+/.test(line)) return `<p class="li">${renderInline(line.replace(/^[-*+]\s+/, ''))}</p>${revHtml}`
      return `<p>${renderInline(line)}</p>${revHtml}`
    }).join('')
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:SimSun,serif;margin:48px;color:#111;line-height:1.85}h1{text-align:center;font-size:22pt}h2{margin-top:24px;font-size:15pt}p{font-size:12pt}p.li{margin-left:24px;text-indent:-12pt}.rev-sandwich{margin:8px 0 16px 24px;border-left:3px solid #c0392b;background:#fafafa;overflow:hidden}.rev-row{display:flex;gap:10px;padding:6px 14px;font-size:11pt;margin:0}.rev-label{flex-shrink:0;width:32px;color:#888}.rev-original .rev-text{color:#999;text-decoration:line-through}.rev-rewritten{background:#fef5f5}.rev-rewritten .rev-text{color:#c0392b;font-weight:bold}.rev-note{background:#fdecea;border-top:1px dashed #f5c6cb}.rev-note .rev-text{color:#842029}</style></head><body>${htmlBody}</body></html>`
    const url = URL.createObjectURL(new Blob([html], { type: 'application/msword' }))
    const anchor = document.createElement('a')
    anchor.href = url; anchor.download = `${name}-审查批注稿.doc`; anchor.click(); URL.revokeObjectURL(url)
  }

  const status = stage === 'parsing' ? '正在读取合同文件…' : stage === 'analysis' ? '正在识别合同结构…' : stage === 'knowledge' ? '正在匹配参考资料…' : stage === 'review' ? '正在审查风险条款…' : stage === 'rewrite' ? '正在生成批注稿…' : mode === 'thinking' ? '正在深度思考…' : '正在快速回复…'

  return <main className={`contract-chat ${documentOpen ? 'document-expanded' : ''} ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
    {!documentOpen && <aside className="chat-sidebar">
      <label className="sidebar-search"><History size={17} /><input ref={searchRef} value={historyQuery} onChange={(event) => setHistoryQuery(event.target.value)} placeholder="搜索历史对话" /><kbd>⌘ K</kbd></label>
      <div className="sidebar-brand"><span className="brand-orb"><img src="/logo.png" alt="" /></span><strong>法飞飞</strong></div>
      <button className="sidebar-action" onClick={() => createConversation()}><PenLine size={20} />新对话</button>
      <button className="sidebar-action" onClick={() => setTaskModalOpen(true)}><FolderOpen size={20} />新审查任务</button>
      <p className="history-label">历史对话</p>
      <nav className="history-list">{matchingThreads.map((thread) => <button className={thread.id === activeThread?.id ? 'selected' : ''} key={thread.id} onClick={() => selectConversation(thread.id)}><MessageCircle size={16} /><span>{thread.title}</span><i className="history-delete" title="删除对话" onClick={(event) => deleteConversation(event, thread.id)}><Trash2 size={14} /></i></button>)}</nav>
      {tasks.length > 0 && <><p className="history-label task-label">审查任务</p><nav className="history-list task-list">{tasks.map((task) => <button key={task.id} className={task.threadId === activeThread?.id ? 'selected' : ''} onClick={() => openTask(task)}><FolderOpen size={16} /><span>{task.title}</span><i className="history-delete" title="删除任务" onClick={(event) => deleteTask(event, task.id)}><Trash2 size={14} /></i></button>)}</nav></>}
      <div className="sidebar-footer-wrap">
        {balanceOpen && <section className="balance-popover" role="dialog" aria-label="剩余用量">
          <header><span className="footer-avatar">法</span><strong>法飞飞合同助手</strong><button type="button" aria-label="关闭用量面板" onClick={() => setBalanceOpen(false)}><X size={16} /></button></header>
          <div className="balance-title"><CircleDollarSign size={19} /><strong>剩余用量</strong><button type="button" className="balance-refresh" onClick={loadBalance} disabled={balanceLoading} title="刷新用量"><RefreshCw size={16} className={balanceLoading ? 'spinner' : ''} /></button></div>
          {balanceLoading && !balanceData && <p className="balance-state"><Loader2 size={15} className="spinner" />正在查询剩余用量…</p>}
          {balanceError && <p className="balance-error">{balanceError}</p>}
          {!balanceLoading && !balanceError && balanceData && !cnyBalance && <p className="balance-state">暂未返回人民币用量。</p>}
          {!balanceError && cnyBalance && <section className="balance-summary">
            <div className="balance-summary-head"><span>当前剩余用量</span></div>
            <div className="balance-list">
              <div className="balance-item">
                <div><span>人民币</span><b>¥ {cnyBalance.total}</b></div>
                <p>充值用量 ¥ {cnyBalance.toppedUp} · 赠送用量 ¥ {cnyBalance.granted}</p>
              </div>
            </div>
          </section>}
          {balanceData && <small className={balanceData.isAvailable ? 'balance-available' : 'balance-unavailable'}>{balanceData.isAvailable ? '当前用量可正常使用' : '当前用量不足，暂不可使用'}</small>}
          <a className="balance-top-up" href="https://platform.deepseek.com/" target="_blank" rel="noreferrer">充值用量<ExternalLink size={14} /></a>
        </section>}
        <button className="sidebar-footer account-trigger" type="button" onClick={toggleBalancePanel} aria-expanded={balanceOpen}>
          <span className="footer-avatar">法</span><span>法飞飞合同助手</span><ChevronDown size={17} className={balanceOpen ? 'balance-chevron open' : 'balance-chevron'} />
        </button>
      </div>
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
            : <div className="assistant-turn result-turn" key={message.id}><div>{message.status && !message.content ? <p className="assistant-status"><Loader2 size={15} className="spinner" />{message.status}</p> : <>{message.content && <div className="assistant-content"><ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown></div>}{(message.reviewRounds?.length > 0 || (loading && stage === 'review' && activeMessages[activeMessages.length - 1]?.id === message.id)) && <ReviewRoundsPanel rounds={message.reviewRounds || []} thinking={loading && stage === 'review'} />}{message.failed && <small className="message-failed">请检查服务配置后重新发送。</small>}{message.phase === 'rewrite' && (message.revisions?.length > 0 || message.contractText || message.rewrite) && <button className="open-document-card" onClick={() => openDocument(message.id)}><FileText size={25} /><span><strong>商业合同审查批注稿</strong><small>{message.revisions?.length ? `${message.revisions.length} 处修订 · ` : ''}点击展开文档</small></span></button>}</>}</div></div>)}
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
      <header className="document-header"><span>审查修订稿</span><div><button title="复制原文" onClick={() => navigator.clipboard?.writeText(documentContractText)}><Copy size={18} />复制</button><button title="下载 Word" onClick={exportWord}><Download size={18} />下载</button><button className="close-document" aria-label="关闭文档" onClick={() => setDocumentOpen(false)}><X size={21} /></button></div></header>
      <div className="document-scroll">
        {documentRevisions.length > 0
          ? <RevisionDocument contractText={documentContractText} revisions={documentRevisions} />
          : <div className="document-empty"><FileText size={32} /><p>{selectedDocument?.status || '暂无修订内容'}</p></div>}
        {documentRevisions.length > 0 && <aside className="revision-summary">
          <p><b>{documentRevisions.length}</b> 处修订{selectedDocument?.rewriteStats ? `（修订 ${selectedDocument.rewriteStats.modify || 0} · 新增 ${selectedDocument.rewriteStats.add || 0} · 删除 ${selectedDocument.rewriteStats.delete || 0}）` : ''}</p>
          <p className="revision-summary-tip">红色块为修订建议，灰色删除线为原句，红色为改写句，浅红底为批注说明。</p>
        </aside>}
      </div>
    </section>}

    {taskModalOpen && <div className="task-modal-backdrop" role="presentation" onMouseDown={() => setTaskModalOpen(false)}><form className="task-modal" onSubmit={createTask} onMouseDown={(event) => event.stopPropagation()}><div><strong>新审查任务</strong><button type="button" aria-label="关闭" onClick={() => setTaskModalOpen(false)}><X size={19} /></button></div><label>任务名称<input value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} placeholder="例如：供应商年度采购合同" autoFocus /></label><label>审查要求<textarea value={taskPrompt} onChange={(event) => setTaskPrompt(event.target.value)} placeholder="可填写审查视角、关注条款或交付要求" /></label><p>创建后会打开独立对话，可上传合同后开始审查。</p><footer><button type="button" onClick={() => setTaskModalOpen(false)}>取消</button><button className="task-primary" type="submit">创建任务</button></footer></form></div>}
  </main>
}

export default ContractRewritePage
