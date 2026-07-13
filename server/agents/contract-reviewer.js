import { streamChat, getProModel } from '../services/llm-client.js'
import { AGENT_2_SYSTEM_PROMPT, buildReviewUserMessage } from '../prompts/agent-2-review.js'

/**
 * Agent 2: 法律合规审查
 * 流式输出审查报告
 *
 * @param {object} params
 * @param {string} params.contractText - 原始合同文本
 * @param {string} params.analysisReport - Agent 1 的分析报告
 * @param {Array} params.templates - 知识库检索到的模版
 * @param {string} params.userInstruction - 用户额外关注点
 * @param {function} onChunk - 每收到一个 token 时的回调
 * @returns {Promise<string>} 完整的审查报告文本
 */
export async function reviewContract({ contractText, analysisReport, templates, userInstruction }, onChunk, model = getProModel()) {
  const userMessage = buildReviewUserMessage({
    contractText,
    analysisReport,
    templates,
    userInstruction
  })

  let fullReport = ''

  for await (const chunk of streamChat(AGENT_2_SYSTEM_PROMPT, userMessage, {
    model,
    temperature: 0.3,
    maxTokens: 8192
  })) {
    if (chunk.content) {
      fullReport += chunk.content
      if (onChunk) onChunk(chunk.content)
    }
  }

  return fullReport
}
