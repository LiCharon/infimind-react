import { streamChat, getProModel } from '../services/llm-client.js'
import { AGENT_1_SYSTEM_PROMPT, buildAnalysisUserMessage } from '../prompts/agent-1-analysis.js'

/**
 * Agent 1: 合同结构分析
 * 流式输出分析报告
 *
 * @param {string} contractText - 文件解析出的合同纯文本
 * @param {function} onChunk - 每收到一个 token 时的回调
 * @returns {Promise<string>} 完整的分析报告文本
 */
export async function analyzeContract(contractText, onChunk, model = getProModel()) {
  const userMessage = buildAnalysisUserMessage(contractText)

  let fullReport = ''

  for await (const chunk of streamChat(AGENT_1_SYSTEM_PROMPT, userMessage, {
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
