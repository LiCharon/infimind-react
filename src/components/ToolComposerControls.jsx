import { useWorkspaceText } from './WorkspaceContext'
import React, { useEffect, useRef, useState } from 'react'
import { Brain, Plus } from 'lucide-react'
import { CONTEXT_WINDOW_TOKENS, estimateTokens } from '../utils/context-budget.js'
import './ToolComposerControls.css'

export function ContextUsage({ messages = [], question = '', hasPendingFiles = false }) {
  const t = useWorkspaceText()
  const [open, setOpen] = useState(false)
  const root = useRef(null)
  const latest = [...messages].reverse().find((message) => message.result?.contextUsage || message.result?.usage || message.usage)
  const usage = latest?.result?.usage || latest?.usage
  const promptTokens = latest?.result?.contextUsage ? latest.result.contextUsage.promptTokens : usage?.prompt_tokens
  const estimated = 3000 + estimateTokens(question) + messages.filter((message) => !message.failed)
    .reduce((sum, message) => sum + estimateTokens(message.content || message.result?.reviewReport || message.result?.answer || '') + 16, 0)
  // Context measures input, not total_tokens (which also contains generated output).
  const actual = !question.trim() && !hasPendingFiles && Number.isFinite(promptTokens)
  const tokens = actual ? promptTokens : estimated
  const fraction = tokens / CONTEXT_WINDOW_TOKENS * 100
  const percent = fraction < 1 ? '<1%' : `${Math.min(100, Math.ceil(fraction))}%`
  const compact = (count) => count >= 1000 ? `${(count / 1000).toFixed(count >= 10000 ? 0 : 1).replace(/\.0$/, '')}K` : String(count)
  useEffect(() => {
    if (!open) return undefined
    const dismiss = (event) => { if (!root.current?.contains(event.target)) setOpen(false) }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [open])
  return <div ref={root} className="tool-context" onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false) }}>
    <button type="button" className="tool-context-trigger" aria-label={(t("上下文占比 ") + (percent))} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <span className="tool-context-ring" style={{ '--context-progress': `${Math.min(100, fraction)}%` }} />{percent}
    </button>
    {open && <div className="tool-context-popover" role="status">
      <div className="tool-context-heading"><span>{t("上下文已用")}<strong>{percent}</strong></span><small>{actual ? '' : '~'}{compact(tokens)} / 1M</small></div>
      <div className="tool-context-track"><span style={{ width: `${Math.min(100, fraction)}%` }} /></div>
      <p>{actual ? t("最近一次调用的实际输入用量。") : t("发送前预估，尚未计入本轮附件和检索资料；回复后按实际输入用量校正。")}</p>
    </div>}
  </div>
}

export default function ToolComposerControls({ onUpload, uploadLabel = '上传材料', disabled = false, modeDisabled = disabled, mode, onModeChange, messages, question, hasPendingFiles, children }) {
  const t = useWorkspaceText()
  return <div className="composer-tools tool-composer-controls">
    {onUpload && <button type="button" aria-label={uploadLabel} title={uploadLabel} onClick={onUpload} disabled={disabled}><Plus size={20} /></button>}
    {onModeChange && <button type="button" className={`tool-thinking-toggle${mode === 'thinking' ? ' active' : ''}`} aria-pressed={mode === 'thinking'} title={mode === 'thinking' ? t("深度思考已开启，点击关闭") : t("点击开启深度思考")} onClick={() => onModeChange(mode === 'thinking' ? 'fast' : 'thinking')} disabled={modeDisabled}><Brain size={16} />{t("深度思考")}</button>}
    <ContextUsage messages={messages} question={question} hasPendingFiles={hasPendingFiles} />
    {children}
  </div>
}
