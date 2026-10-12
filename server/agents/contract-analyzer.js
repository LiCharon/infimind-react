import { splitDocument, fingerprint } from '../services/document-materials.js'
import { chatDetailed } from '../services/llm-client.js'
import { streamChat, getProModel } from '../services/llm-client.js'
import { buildAnalysisSystemPrompt, buildAnalysisUserMessage } from '../prompts/agent-1-analysis.js'
import { getTypeCatalogForPrompt } from '../services/knowledge-base.js'

/**
 * Agent 1: 合同结构分析
 * 流式输出分析报告
 *
 * 顺手承担「判定合同类型与子类型」——这份判定会成为后续检索的过滤键，
 * 因此把库内真实存在的类型（以及已启用过滤的主类型下的子类型）注入提示词，
 * 让模型在有限选项里挑，而不是自己造一个检索不到的名字。
 * 目录不可用时退化为不带目录的提示词，分析本身不受影响。
 *
 * @param {string} contractText - 文件解析出的合同纯文本
 * @param {function} onChunk - 每收到一个 token 时的回调
 * @returns {Promise<string>} 完整的分析报告文本
 */
export async function analyzeContract(contractText, onChunk, model = getProModel(), options = {}) {
  const blocks = splitDocument(contractText)
  if (blocks.length > 1) {
    const reports = []
    for (const block of blocks) {
      options.signal?.throwIfAborted()
      const key = `commercial-analysis:${block.id}`
      const saved = (await options.getCheckpoint?.(key))?.result
      const report = saved?.report || await analyzeContract(block.text, null, model, options)
      await options.checkpoint?.(key, { report }); reports.push(report)
    }
    let pending = reports
    while (pending.length > 1) {
      const merged = []
      for (let i = 0; i < pending.length; i += 4) {
        options.signal?.throwIfAborted()
        const key = `commercial-analysis-merge:${fingerprint(pending.slice(i, i + 4).join('\n'))}`
        const saved = (await options.getCheckpoint?.(key))?.result
        if (saved?.report) { merged.push(saved.report); continue }
        const response = await chatDetailed('将各内容块的结构分析汇总成一份合同结构概览，保留主体、交易条件、条款引用与冲突线索。不得补造原文；摘要只用于安排审查，不替代原文证据。', pending.slice(i, i + 4).join('\n'), { model, maxTokens: 4096, signal: options.signal })
        if (response.finishReason !== 'stop') throw new Error('合同结构汇总未完整结束')
        await options.checkpoint?.(key, { report: response.content })
        merged.push(response.content)
      }
      pending = merged
    }
    if (onChunk) onChunk(pending[0])
    return pending[0]
  }
  const userMessage = buildAnalysisUserMessage(contractText)

  let systemPrompt
  try {
    const { contractTypes, subTypes } = getTypeCatalogForPrompt()
    systemPrompt = buildAnalysisSystemPrompt({ contractTypes, subTypes })
  } catch (error) {
    console.warn(`[contract-analyzer] 类型目录不可用，Agent 1 将自行判断类型：${error.message}`)
    systemPrompt = buildAnalysisSystemPrompt()
  }

  let fullReport = ''
  let finishReason = null

  for await (const chunk of streamChat(systemPrompt, userMessage, {
    model, signal: options.signal,
    temperature: 0.3,
    maxTokens: 8192
  })) {
    if (chunk.finishReason === 'length') throw new Error('合同结构内容块输出未完成')
    if (typeof chunk.finishReason === 'string') finishReason = chunk.finishReason
    if (chunk.content) {
      fullReport += chunk.content
      if (onChunk) onChunk(chunk.content)
    }
  }

  options.signal?.throwIfAborted()
  if (finishReason !== 'stop') throw new Error('合同结构内容块缺少完成标记，已完成进度保留')
  return fullReport
}
