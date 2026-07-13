import { streamChat, getProModel } from '../services/llm-client.js'
import { AGENT_3_SYSTEM_PROMPT, buildRewriteUserMessage } from '../prompts/agent-3-rewrite.js'

/**
 * Agent 3: 合同改写
 * 流式输出改写后的合同
 *
 * @param {object} params
 * @param {string} params.contractText - 原始合同文本
 * @param {string} params.analysisReport - Agent 1 分析报告
 * @param {string} params.reviewReport - Agent 2 审查报告
 * @param {function} onChunk - 每收到一个 token 时的回调
 * @returns {Promise<string>} 完整的改写合同文本
 */
export async function rewriteContract({ contractText, analysisReport, reviewReport }, onChunk, model = getProModel()) {
  const userMessage = buildRewriteUserMessage({
    contractText,
    analysisReport,
    reviewReport
  })

  let fullContract = ''

  for await (const chunk of streamChat(AGENT_3_SYSTEM_PROMPT, userMessage, {
    model,
    temperature: 0.3,
    maxTokens: 8192
  })) {
    if (chunk.content) {
      fullContract += chunk.content
      if (onChunk) onChunk(chunk.content)
    }
  }

  return fullContract
}
