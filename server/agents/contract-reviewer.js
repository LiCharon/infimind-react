import { streamChat, getProModel } from '../services/llm-client.js'
import { AGENT_2_SYSTEM_PROMPT, buildReviewUserMessage } from '../prompts/agent-2-review.js'

/**
 * Agent 2: 法律合规审查
 * 获取结构化审查结果。原始模型输出只在服务端校验后才会被渲染给前端，
 * 避免未完成的 JSON 或模型 Markdown 变体成为另一套批注事实来源。
 *
 * 支持多轮审查：第 2 轮起把前几轮已发现的问题摘要（previousFindings）注入提示词，
 * 引导模型补充遗漏的新问题，而非重复已有问题。
 *
 * @param {object} params
 * @param {string} params.contractText - 原始合同文本
 * @param {string} params.analysisReport - Agent 1 的分析报告
 * @param {Array} params.evidence - 知识库检索到的条款与风险证据
 * @param {object} params.reviewPlan - 受控审查检索计划
 * @param {string} params.userInstruction - 用户额外关注点
 * @param {number} params.round - 当前审查轮次（1 起始）
 * @param {Array} params.previousFindings - 前几轮已发现问题的摘要 [{ level, title, location }]
 * @returns {Promise<string>} 模型返回的完整 JSON 文本
 */
export async function reviewContract({ contractText, analysisReport, evidence, reviewPlan, userInstruction, round = 1, previousFindings = [] }, model = getProModel()) {
  const userMessage = buildReviewUserMessage({
    contractText,
    analysisReport,
    evidence,
    reviewPlan,
    userInstruction,
    round,
    previousFindings
  })

  let fullReport = ''

  for await (const chunk of streamChat(AGENT_2_SYSTEM_PROMPT, userMessage, {
    model,
    temperature: 0.3,
    maxTokens: 12288
  })) {
    if (chunk.content) {
      fullReport += chunk.content
    }
  }

  return fullReport
}
