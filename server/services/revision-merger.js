/**
 * 改写结果配对与校验。
 *
 * 设计纪律（与 annotation-locator.js 一致）：
 * - 原句、行号、风险等级等"可信字段"一律来自服务端 buildReviewResult 产出的 finding；
 *   绝不被 Agent 3 的输出覆盖。
 * - Agent 3 只负责"如何修订"：action(改/增/删)、rewrittenText、riskNote。
 * - 漏配或解析失败的 finding，用 advice/replacement 兜底，保证每条风险都有对应的修订块。
 */

const asText = (value) => (typeof value === 'string' ? value.trim() : '')

/**
 * 从可能被 maxTokens 截断的 JSON 文本中抢救出完整的 revisions 数组。
 *
 * 截断通常发生在某个 revision 的字符串值中间（如 rewrittenText 写到一半），
 * 此时整体 JSON.parse 必然失败。但前面已经完整结束的 `},` 边界可以抢救：
 * 通过字符级扫描，跟踪字符串内外状态与括号深度，找到最后一个"完整的 revision 对象"
 * 的结束位置，截断到那里后补全 `]}` 即可重新解析。
 *
 * @param {string} text - Agent 3 的原始输出（可能含 ```json 围栏）
 * @returns {Array|null} 抢救出的 revisions 数组；无法抢救时返回 null
 */
const recoverTruncatedRevisions = (text = '') => {
  const trimmed = String(text).trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim()
  const candidate = fenced || trimmed

  // 定位 "revisions" 数组的起始 `[`
  const revisionsKey = candidate.match(/"revisions"\s*:\s*\[/)
  if (!revisionsKey) return null
  const arrayStart = revisionsKey.index + revisionsKey[0].length - 1 // 指向 `[`
  if (arrayStart < 0 || arrayStart >= candidate.length) return null

  let inString = false
  let escape = false
  let depth = 0
  let lastCompleteObjEnd = -1 // 最后一个完整 revision 对象结束后的位置（`]` 之前）

  for (let i = arrayStart + 1; i < candidate.length; i += 1) {
    const ch = candidate[i]
    if (inString) {
      if (escape) { escape = false; continue }
      if (ch === '\\') { escape = true; continue }
      if (ch === '"') { inString = false }
      continue
    }
    if (ch === '"') { inString = true; continue }
    if (ch === '{') { depth += 1; continue }
    if (ch === '}') {
      depth -= 1
      // depth 回到数组层（顶层 revision 对象刚结束）：记录这个完整边界
      if (depth === 0) lastCompleteObjEnd = i
      continue
    }
    // 遇到顶层的 `]`（数组结束）或 `}`（对象结束，说明 revisions 已正常关闭）
    if (ch === ']' && depth === 0) {
      // 数组正常结束，无需截断修复，直接尝试整体解析
      break
    }
  }

  if (lastCompleteObjEnd < 0) return null
  // 截断到最后一个完整对象，补全 `]}` 闭合 revisions 数组和外层对象
  const recovered = candidate.slice(0, lastCompleteObjEnd + 1) + ']}'
  try {
    const parsed = JSON.parse(recovered)
    return Array.isArray(parsed?.revisions) ? parsed.revisions : null
  } catch {
    return null
  }
}

const extractRevisionJson = (output = '') => {
  const trimmed = String(output).trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim()
  const candidate = fenced || trimmed
  const first = candidate.indexOf('{')
  const last = candidate.lastIndexOf('}')
  if (first < 0 || last <= first) throw new Error('改写模型没有返回 JSON 对象')
  try {
    return JSON.parse(candidate.slice(first, last + 1))
  } catch {
    throw new Error('改写模型返回的 JSON 格式不完整')
  }
}

const normalizeAction = (value) => {
  const text = String(value || '').trim().toLowerCase()
  if (text === 'add' || text === '新增' || text === '补充' || text === '插入') return 'add'
  if (text === 'delete' || text === '删除' || text === 'remove' || text === '移除') return 'delete'
  return 'modify'
}

/**
 * 把可信的 findings 与 Agent 3 的 revisions 按 findingId（或顺序）配对。
 *
 * @param {Array} findings - 来自 buildReviewResult 的 canonical findings（含可信 originalText/lineStart/lineEnd）
 * @param {string} agentOutput - Agent 3 返回的完整 JSON 文本，形如 { revisions: [{ findingId, action, rewrittenText, riskNote }] }
 * @returns {{ revisions: Array, stats: object, recovered: boolean, matchedIds: string[] }}
 */
export function mergeRevisions(findings = [], agentOutput = '') {
  let payload = { revisions: [] }
  let recovered = false
  try {
    payload = extractRevisionJson(agentOutput)
  } catch (error) {
    // 整体解析失败：尝试从被截断的 JSON 中抢救完整的 revisions
    const salvaged = recoverTruncatedRevisions(agentOutput)
    if (salvaged && salvaged.length) {
      payload = { revisions: salvaged }
      recovered = true
      console.warn(`[revision-merger] Recovered ${salvaged.length} revisions from truncated JSON`)
    } else {
      console.warn('[revision-merger] Agent 3 output parse failed:', error.message)
    }
  }
  const rawRevisions = Array.isArray(payload?.revisions) ? payload.revisions : []

  // 按 findingId 建索引；同时保留原始顺序，用于 findingId 缺失时按位置回退。
  const revisionById = new Map()
  rawRevisions.forEach((rev) => {
    const id = asText(rev?.findingId)
    if (id) revisionById.set(id, rev)
  })

  const revisions = []
  const tally = { modify: 0, add: 0, delete: 0 }
  const matchedIds = []

  findings.forEach((finding, index) => {
    const matched =
      revisionById.get(finding.id) ||
      revisionById.get(`finding-${index + 1}`) ||
      rawRevisions[index]

    const action = matched ? normalizeAction(matched.action) : 'modify'
    const agentRewrittenText = asText(matched?.rewrittenText)
    const rewrittenText = agentRewrittenText || asText(finding.replacement) || ''
    // 批注说明优先用 Agent 3 的 riskNote，兜底用 finding 的 advice / risk。
    const riskNote = asText(matched?.riskNote) || asText(finding.advice) || asText(finding.risk) || ''

    if (matched) matchedIds.push(finding.id)
    tally[action] += 1
    revisions.push({
      findingId: finding.id,
      // 可信字段：来自服务端 finding，强制覆盖
      level: finding.level,
      title: finding.title,
      location: finding.location,
      anchor: finding.anchor,
      lineStart: finding.lineStart,
      lineEnd: finding.lineEnd,
      originalText: finding.originalText,
      risk: finding.risk,
      advice: finding.advice,
      evidence: finding.evidence,
      // Agent 3 产出字段
      action,
      rewrittenText,
      riskNote,
      // 标记本条是否成功匹配到 Agent 3 的改写输出（用于分批补全判断）
      hasRewrite: Boolean(agentRewrittenText)
    })
  })

  return {
    revisions,
    stats: {
      total: revisions.length,
      matched: matchedIds.length,
      modify: tally.modify,
      add: tally.add,
      delete: tally.delete
    },
    recovered,
    matchedIds
  }
}
