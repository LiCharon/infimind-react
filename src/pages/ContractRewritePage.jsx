import React, { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  CircleEllipsis,
  Copy,
  Download,
  FileText,
  FolderOpen,
  History,
  Loader2,
  Menu,
  MessageCircle,
  Paperclip,
  PenLine,
  Plus,
  Send,
  Sparkles,
  Upload,
  X
} from 'lucide-react'
import './ContractRewritePage.css'

const ENDPOINT = '/api/contract-rewrite'
const ACCEPTED = '.pdf,.doc,.docx,.png,.jpg,.jpeg,.webp'
const MAX_FILE_SIZE = 80 * 1024 * 1024

const HISTORY = ['商业合同审查与批注', '采购合同付款风险', '劳动合同条款检查', '品牌合作协议', '房屋租赁合同审查']

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

function ContractDocument({ text, comments }) {
  const blocks = []
  const lines = text.split('\n')
  let index = 0
  let commentIndex = 0
  while (index < lines.length) {
    const line = lines[index].trim()
    if (!line) { index += 1; continue }
    const heading = line.match(/^(#{1,2})\s+(.+)$/)
    if (heading) {
      const Tag = heading[1].length === 1 ? 'h1' : 'h2'
      blocks.push(<Tag key={`heading-${index}`}>{heading[2]}</Tag>)
      index += 1
      continue
    }
    const note = comments ? [1, 6, 9].includes(commentIndex) : false
    commentIndex += 1
    blocks.push(<p className={note ? 'marked-clause' : ''} key={`paragraph-${index}`}>{inline(line)}</p>)
    index += 1
  }
  return <article className="contract-document">{blocks}</article>
}

function ContractRewritePage() {
  const inputRef = useRef(null)
  const threadEndRef = useRef(null)
  const [files, setFiles] = useState([])
  const [instruction, setInstruction] = useState('')
  const [analysis, setAnalysis] = useState('')
  const [review, setReview] = useState('')
  const [rewrite, setRewrite] = useState('')
  const [loading, setLoading] = useState(false)
  const [stage, setStage] = useState('')
  const [error, setError] = useState('')
  const [documentOpen, setDocumentOpen] = useState(false)
  const [showComments, setShowComments] = useState(false)
  const [currentHistory, setCurrentHistory] = useState(0)

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ block: 'end' })
  }, [analysis, review, loading])

  const documentText = rewrite || DEMO_DOCUMENT
  const uploadFiles = (incoming) => {
    const next = incoming.filter(isSupported).slice(0, 6)
    if (next.length !== incoming.length) setError('仅支持 PDF、Word、PNG、JPG、WebP，且单个文件不超过 80MB。')
    else setError('')
    setFiles(next)
  }

  const handleSSE = async (response) => {
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
        if (event === 'stage.start') setStage(data.stage || '')
        if (event === 'analysis.delta') setAnalysis((value) => value + (data.content || ''))
        if (event === 'review.delta') setReview((value) => value + (data.content || ''))
        if (event === 'rewrite.delta') setRewrite((value) => value + (data.content || ''))
        if (event === 'done') { setStage(''); setDocumentOpen(false) }
        if (event === 'error') throw new Error(data.message || '审查未完成，请稍后重试。')
      }
    }
  }

  const startReview = async () => {
    if (!files.length || loading) return
    setLoading(true); setError(''); setAnalysis(''); setReview(''); setRewrite(''); setStage('parsing')
    try {
      const form = new FormData()
      form.append('message', instruction.trim() || '请根据合同类型匹配知识库中的优秀模板和已批注风险案例，完成合规审查并生成带修改说明的合同稿。')
      files.forEach((file) => form.append('files', file))
      const response = await fetch(ENDPOINT, { method: 'POST', headers: { Accept: 'text/event-stream' }, body: form })
      if (!response.ok || !response.body) throw new Error(await response.text() || '审查服务暂不可用。')
      await handleSSE(response)
    } catch (requestError) {
      setError(requestError.message || '审查未完成，请稍后重试。')
    } finally { setLoading(false) }
  }

  const exportWord = () => {
    const name = files[0]?.name?.replace(/\.[^.]+$/, '') || '商业合同审查稿'
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:SimSun,serif;margin:48px;color:#111;line-height:1.85}h1{text-align:center;font-size:22pt}h2{margin-top:24px;font-size:15pt}p{font-size:12pt}</style></head><body>${documentText.split('\n').map((line) => line.startsWith('# ') ? `<h1>${line.slice(2)}</h1>` : line.startsWith('## ') ? `<h2>${line.slice(3)}</h2>` : line ? `<p>${line}</p>` : '').join('')}</body></html>`
    const url = URL.createObjectURL(new Blob([html], { type: 'application/msword' }))
    const anchor = document.createElement('a')
    anchor.href = url; anchor.download = `${name}-审查批注稿.doc`; anchor.click(); URL.revokeObjectURL(url)
  }

  const assistantText = review || analysis || rewrite
  const status = stage === 'parsing' ? '正在读取合同文件…' : stage === 'analysis' ? '正在识别合同结构…' : stage === 'knowledge' ? '正在匹配参考资料…' : stage === 'review' ? '正在审查风险条款…' : '正在生成批注稿…'

  return <main className={`contract-chat ${documentOpen ? 'document-expanded' : ''}`}>
    {!documentOpen && <aside className="chat-sidebar">
      <div className="sidebar-search"><History size={17} /><span>搜索历史对话</span><kbd>⌘ K</kbd></div>
      <div className="sidebar-brand"><span className="brand-orb"><Sparkles size={15} /></span><strong>法飞飞</strong></div>
      <button className="sidebar-action" onClick={() => { setFiles([]); setInstruction(''); setAnalysis(''); setReview(''); setRewrite(''); setError('') }}><PenLine size={20} />新对话</button>
      <button className="sidebar-action"><FolderOpen size={20} />新审查任务</button>
      <p className="history-label">历史对话</p>
      <nav className="history-list">{HISTORY.map((item, index) => <button className={index === currentHistory ? 'selected' : ''} key={item} onClick={() => setCurrentHistory(index)}><MessageCircle size={16} />{item}</button>)}</nav>
      <div className="sidebar-footer"><span className="footer-avatar">法</span><span>法飞飞合同助手</span></div>
    </aside>}

    <section className="chat-column">
      <header className="chat-header">
        {documentOpen ? <button className="icon-button" aria-label="返回对话" onClick={() => setDocumentOpen(false)}><ChevronLeft size={21} /></button> : <Link className="icon-button" aria-label="返回首页" to="/"><ArrowLeft size={20} /></Link>}
        <div className="chat-title"><strong>商业合同审查助手</strong><small>AI 生成内容仅供参考，请结合实际情况判断</small></div>
        <div className="header-tools"><button className="icon-button" aria-label="更多操作"><CircleEllipsis size={21} /></button></div>
      </header>

      <div className="conversation">
        <div className="conversation-inner">
          <div className="assistant-turn welcome-turn"><div><p>你好，我是法飞飞合同审查助手。上传合同后，我会结合对应合同类型的优质模板和风险案例，帮你梳理风险、生成修改建议，并输出一份可继续编辑的批注稿。</p></div></div>
          {files.length > 0 && <div className="user-turn"><p>请审查我上传的合同{instruction ? `，重点关注：${instruction}` : ''}</p>{files.map((file) => <div className="attached-file" key={file.name}><FileText size={18} /><span>{file.name}</span><small>{Math.ceil(file.size / 1024)} KB</small><button onClick={() => setFiles((items) => items.filter((item) => item !== file))}><X size={14} /></button></div>)}</div>}
          {loading && <div className="assistant-turn loading-turn"><div><p>{status}</p></div></div>}
          {assistantText && <div className="assistant-turn result-turn"><div><strong>{review ? '合同审查结论' : rewrite ? '合同批注稿已生成' : '合同结构分析'}</strong><p>{assistantText}</p>{rewrite && <button className="open-document-card" onClick={() => setDocumentOpen(true)}><FileText size={25} /><span><strong>商业合同审查批注稿</strong><small>已生成 · 点击展开文档</small></span></button>}</div></div>}
          {error && <p className="chat-error">{error}</p>}
          {!files.length && !assistantText && <div className="starter-prompts"><button onClick={() => setInstruction('请从甲方视角重点审查付款、验收和违约责任。')}>从甲方视角审查付款与违约责任 <span>→</span></button><button onClick={() => setInstruction('请检查合同是否缺少核心条款。')}>检查是否缺少核心条款 <span>→</span></button></div>}
          <div ref={threadEndRef} />
        </div>
      </div>

      <div className="composer-wrap"><div className="composer">
        <textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="上传合同或输入你特别关注的审查重点…" disabled={loading} />
        <div className="composer-bottom"><div className="composer-tools"><button onClick={() => inputRef.current?.click()} title="上传合同"><Plus size={24} /></button><i /><button className="tool-text" onClick={() => setInstruction('请快速审查合同中的高风险条款。')}><Sparkles size={18} />快速审查</button><button className="tool-text" onClick={() => setInstruction('请对以下合同条款进行专业审查并给出可替换文本。')}><PenLine size={18} />帮我写作</button><button className="tool-text mobile-hide"><Menu size={18} />更多</button></div><button className="voice-send" onClick={startReview} disabled={!files.length || loading} aria-label="开始审查">{loading ? <Loader2 size={20} className="spinner" /> : <Send size={19} />}</button></div>
        <input ref={inputRef} hidden type="file" multiple accept={ACCEPTED} onChange={(event) => { uploadFiles([...event.target.files]); event.target.value = '' }} />
      </div></div>
    </section>

    {documentOpen && <section className="document-column">
      <header className="document-header"><span>修改于刚刚</span><div><button title="复制合同" onClick={() => navigator.clipboard?.writeText(documentText)}><Copy size={18} />复制</button><button title="下载 Word" onClick={exportWord}><Download size={18} />下载</button><button className={showComments ? 'comments-active' : ''} onClick={() => setShowComments((value) => !value)}><MessageCircle size={18} />批注</button><button className="close-document" aria-label="关闭文档" onClick={() => setDocumentOpen(false)}><X size={21} /></button></div></header>
      <div className="document-scroll"><ContractDocument text={documentText} comments={showComments} />{showComments && <aside className="document-comments"><p><b>3</b> 处待确认</p><div>补全付款节点和开票要求。</div><div>明确验收标准及不合格处理方式。</div><div>结合交易金额填写违约金比例。</div></aside>}</div>
    </section>}
  </main>
}

export default ContractRewritePage
