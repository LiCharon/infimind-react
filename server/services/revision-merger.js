/**
 * 改写结果配对与校验。
 *
 * 设计纪律（与 annotation-locator.js 一致）：
 * - 原句、行号、风险等级等"可信字段"一律来自服务端 buildReviewResult 产出的 finding；
 *   绝不被 Agent 3 的输出覆盖。
 * - Agent 3 只负责"如何修订"：action(改/增/删)、rewrittenText、riskNote。
 * - 漏配或解析失败的 finding，用 advice/replacement 兜底，保证每条风险都有对应的修订块。
 */
import { findQuoteRanges, isClauseHeadingLine, locationTokens } from './annotation-locator.js'

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

const asSequence = (value, fallback) => {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

// add 锚点解析：优先使用 Agent 3 给出的逐字 insertAfterQuote；无法唯一确认时，
// 标题锚点插入到所属条款末尾，普通锚点插入到 finding 行后；再失败则 unresolved，不猜位置。
const resolveAddAnchor = ({ finding, matched, contractLines }) => {
  const lineStart = Number.isInteger(finding?.lineStart) ? finding.lineStart : -1
  const lineEnd = Number.isInteger(finding?.lineEnd) ? finding.lineEnd : lineStart
  const clauseEnd = Number.isInteger(finding?.clauseEnd) ? finding.clauseEnd : -1
  const insertAfterQuote = asText(matched?.insertAfterQuote)

  if (insertAfterQuote && contractLines.length) {
    const ranges = findQuoteRanges(contractLines, insertAfterQuote)
    let chosen = null
    let anchorStatus = 'verified'
    if (ranges.length === 1) {
      chosen = ranges[0]
    } else if (ranges.length > 1) {
      const tokens = locationTokens(finding?.location || '')
      const locationLines = tokens.length
        ? contractLines.map((line, index) => ({ line, index })).filter(({ line }) => tokens.some((token) => line.includes(token))).map(({ index }) => index)
        : []
      chosen = ranges.toSorted((left, right) => {
        const distance = (range) => locationLines.length
          ? Math.min(...locationLines.map((line) => Math.abs(range.end - line)))
          : Math.abs(range.end - lineEnd)
        return distance(left) - distance(right)
      })[0]
      anchorStatus = 'code-located'
    }
    if (chosen && Number.isInteger(chosen.end) && contractLines[chosen.end]) {
      return {
        insertAfterLine: chosen.end,
        anchorText: String(contractLines[chosen.end] || '').trim(),
        anchorStatus
      }
    }
  }

  if (lineStart >= 0 && contractLines[lineStart] && isClauseHeadingLine(contractLines[lineStart]) && clauseEnd >= lineStart && contractLines[clauseEnd]) {
    return {
      insertAfterLine: clauseEnd,
      anchorText: String(contractLines[lineStart] || '').trim(),
      anchorStatus: 'code-located'
    }
  }

  if (lineEnd >= 0 && contractLines[lineEnd]) {
    return {
      insertAfterLine: lineEnd,
      anchorText: String(contractLines[lineEnd] || '').trim() || asText(finding?.originalText),
      anchorStatus: 'code-located'
    }
  }

  return { insertAfterLine: -1, anchorText: asText(finding?.originalText), anchorStatus: 'unresolved' }
}

const sortLineForRevision = (revision) => {
  if (revision.action === 'add') return revision.insertAfterLine >= 0 ? revision.insertAfterLine : Number.MAX_SAFE_INTEGER
  return Number.isInteger(revision.lineStart) ? revision.lineStart : Number.MAX_SAFE_INTEGER
}

const sortRevisions = (revisions) => revisions.sort((left, right) => {
  const lineDiff = sortLineForRevision(left) - sortLineForRevision(right)
  if (lineDiff) return lineDiff
  const sequenceDiff = (left.sequence || 0) - (right.sequence || 0)
  if (sequenceDiff) return sequenceDiff
  return String(left.findingId).localeCompare(String(right.findingId))
})

/**
 * 把可信的 findings 与 Agent 3 的 revisions 按 findingId（或顺序）配对。
 *
 * @param {Array} findings - 来自 buildReviewResult 的 canonical findings（含可信 originalText/lineStart/lineEnd/quoteSpans）
 * @param {string} agentOutput - Agent 3 返回的完整 JSON 文本，形如 { revisions: [{ findingId, action, rewrittenText, riskNote, insertAfterQuote?, sequence? }] }
 * @param {string} contractText - 原合同全文，用于解析 add 的 insertAfterQuote 与条款末尾锚点
 * @returns {{ revisions: Array, stats: object, recovered: boolean, matchedIds: string[] }}
 */
export function mergeRevisions(findings = [], agentOutput = '', contractText = '') {
  const contractLines = String(contractText || '').split('\n')
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
    const sequence = asSequence(matched?.sequence, index + 1)
    const addAnchor = action === 'add'
      ? resolveAddAnchor({ finding, matched, contractLines })
      : { insertAfterLine: -1, anchorText: '', anchorStatus: 'not-applicable' }

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
      quoteText: asText(finding.quoteText),
      quoteSpans: Array.isArray(finding.quoteSpans) ? finding.quoteSpans : [],
      quoteStatus: finding.quoteStatus === 'exact' ? 'exact' : 'none',
      clauseEnd: Number.isInteger(finding.clauseEnd) ? finding.clauseEnd : -1,
      risk: finding.risk,
      advice: finding.advice,
      evidence: finding.evidence,
      // Agent 3 产出字段
      action,
      rewrittenText,
      riskNote,
      sequence,
      insertAfterLine: addAnchor.insertAfterLine,
      anchorText: addAnchor.anchorText,
      anchorStatus: addAnchor.anchorStatus,
      // 标记本条是否成功匹配到 Agent 3 的改写输出（用于分批补全判断）
      hasRewrite: Boolean(agentRewrittenText)
    })
  })

  sortRevisions(revisions)

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

const LEVEL_RANK = { 高: 3, 中: 2, 低: 1 }
const CIRCLED_NUMBERS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩']

// 同锚点 add 合并：纯粹是"渲染前的展示归并"，必须在匹配/分批补全全部完成后调用。
// insertAfterLine 相同的多条 add（如围绕同一条款的补充约定）按 sequence 排序后合并为一个修订块：
// rewrittenText 依序拼接成连贯段落，riskNote 编号罗列，level 取最高，findingId 用复合形式。
// stats 不做调整——统计口径始终保持 per-finding，与审查报告一致。
export function coalesceAdjacentAdds(revisions = []) {
  const groupsByAnchor = new Map()
  revisions.forEach((rev) => {
    if (rev?.action !== 'add' || !Number.isInteger(rev.insertAfterLine) || rev.insertAfterLine < 0) return
    if (!groupsByAnchor.has(rev.insertAfterLine)) groupsByAnchor.set(rev.insertAfterLine, [])
    groupsByAnchor.get(rev.insertAfterLine).push(rev)
  })

  // findingId -> 合并块（组首）或 null（被吞并的成员）
  const mergedByFindingId = new Map()
  groupsByAnchor.forEach((group) => {
    if (group.length < 2) return
    const sorted = group.slice().sort((left, right) => (left.sequence || 0) - (right.sequence || 0))
    const first = sorted[0]
    const texts = sorted.map((rev) => asText(rev.rewrittenText)).filter(Boolean)
    const notes = sorted.map((rev) => asText(rev.riskNote)).filter(Boolean)
    mergedByFindingId.set(first.findingId, {
      ...first,
      findingId: sorted.map((rev) => rev.findingId).join('+'),
      mergedFindingIds: sorted.map((rev) => rev.findingId),
      mergedCount: sorted.length,
      level: sorted.reduce((top, rev) => (LEVEL_RANK[rev.level] || 0) > (LEVEL_RANK[top] || 0) ? rev.level : top, first.level),
      rewrittenText: texts.join('\n'),
      riskNote: notes.length > 1
        ? notes.map((note, index) => `${CIRCLED_NUMBERS[index] || `${index + 1}.`}${note}`).join(' ')
        : (notes[0] || asText(first.riskNote)),
      hasRewrite: sorted.every((rev) => rev.hasRewrite)
    })
    sorted.slice(1).forEach((rev) => mergedByFindingId.set(rev.findingId, null))
  })

  if (!mergedByFindingId.size) return revisions
  return revisions
    .map((rev) => mergedByFindingId.has(rev.findingId) ? mergedByFindingId.get(rev.findingId) : rev)
    .filter(Boolean)
}
