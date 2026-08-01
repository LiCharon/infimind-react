import { normalizeForMatch } from './annotation-locator.js'

const LEVEL_RANK = { 高: 3, 中: 2, 低: 1 }
const CIRCLED_NUMBERS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩']

const asText = (value) => (typeof value === 'string' ? value.trim() : '')

const findingRange = (finding = {}) => {
  if (!Number.isInteger(finding.lineStart)) return null
  return {
    start: finding.lineStart,
    end: Number.isInteger(finding.lineEnd) ? finding.lineEnd : finding.lineStart
  }
}

const rangesOverlap = (left, right) => Boolean(
  left && right && left.start <= right.end && right.start <= left.end
)

const sameClauseTarget = (left = {}, right = {}) => {
  const leftRange = findingRange(left)
  const rightRange = findingRange(right)
  if (rangesOverlap(leftRange, rightRange)) return true

  const leftOriginal = normalizeForMatch(left.originalText || '')
  const rightOriginal = normalizeForMatch(right.originalText || '')
  if (leftOriginal && leftOriginal === rightOriginal) return true

  const leftLocation = normalizeForMatch(left.location || '')
  const rightLocation = normalizeForMatch(right.location || '')
  const sameLocation = Boolean(leftLocation && leftLocation === rightLocation)
  const sameClauseEnd = Number.isInteger(left.clauseEnd) && Number.isInteger(right.clauseEnd) && left.clauseEnd === right.clauseEnd
  const nearby = leftRange && rightRange && Math.abs(leftRange.start - rightRange.start) <= 12
  return Boolean(sameLocation && sameClauseEnd && nearby)
}

const canShareRevision = (left = {}, right = {}) => {
  if (sameClauseTarget(left, right)) return true
  const leftLocation = normalizeForMatch(left.location || '')
  const rightLocation = normalizeForMatch(right.location || '')
  const leftRange = findingRange(left)
  const rightRange = findingRange(right)
  return Boolean(
    leftLocation && leftLocation === rightLocation && leftRange && rightRange &&
    Math.abs(leftRange.start - rightRange.start) <= 8
  )
}

const extractJsonObject = (output = '') => {
  const trimmed = String(output).trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim()
  const candidate = fenced || trimmed
  const first = candidate.indexOf('{')
  const last = candidate.lastIndexOf('}')
  if (first < 0 || last <= first) throw new Error('归并模型没有返回 JSON 对象')
  return JSON.parse(candidate.slice(first, last + 1))
}

const deterministicGroups = (findings) => {
  const parents = findings.map((_, index) => index)
  const find = (index) => {
    while (parents[index] !== index) {
      parents[index] = parents[parents[index]]
      index = parents[index]
    }
    return index
  }
  const union = (left, right) => {
    const leftRoot = find(left)
    const rightRoot = find(right)
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot
  }

  for (let left = 0; left < findings.length; left += 1) {
    for (let right = left + 1; right < findings.length; right += 1) {
      if (sameClauseTarget(findings[left], findings[right])) union(left, right)
    }
  }

  const groups = new Map()
  findings.forEach((finding, index) => {
    const root = find(index)
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root).push(finding.id)
  })
  return [...groups.values()].map((memberFindingIds) => ({
    memberFindingIds,
    relation: memberFindingIds.length > 1 ? 'related' : 'independent'
  }))
}

const validateAgentGroups = (payload, findings) => {
  if (!Array.isArray(payload?.groups)) throw new Error('归并结果缺少 groups 数组')
  const findingsById = new Map(findings.map((finding) => [finding.id, finding]))
  const seen = new Set()
  const groups = payload.groups.map((group) => {
    const memberFindingIds = Array.isArray(group?.memberFindingIds)
      ? group.memberFindingIds.filter((id) => typeof id === 'string')
      : []
    const relation = asText(group?.relation).toLowerCase()
    if (!memberFindingIds.length) throw new Error('归并组为空')
    if (!['duplicate', 'related', 'independent'].includes(relation)) throw new Error('归并关系无效')
    if (relation === 'independent' && memberFindingIds.length !== 1) throw new Error('独立组只能包含一个问题')
    if (relation !== 'independent' && memberFindingIds.length < 2) throw new Error('重复或相关组至少包含两个问题')
    memberFindingIds.forEach((id) => {
      if (!findingsById.has(id)) throw new Error(`归并结果包含未知 findingId: ${id}`)
      if (seen.has(id)) throw new Error(`归并结果重复使用 findingId: ${id}`)
      seen.add(id)
    })
    const members = memberFindingIds.map((id) => findingsById.get(id))
    for (let left = 0; left < members.length; left += 1) {
      for (let right = left + 1; right < members.length; right += 1) {
        if (!canShareRevision(members[left], members[right])) {
          throw new Error(`归并组跨越不兼容的修改目标: ${members[left].id}, ${members[right].id}`)
        }
      }
    }
    return { memberFindingIds, relation }
  })

  if (seen.size !== findings.length) throw new Error('归并结果未覆盖全部 findings')

  const groupIndexById = new Map()
  groups.forEach((group, index) => group.memberFindingIds.forEach((id) => groupIndexById.set(id, index)))
  for (let left = 0; left < findings.length; left += 1) {
    for (let right = left + 1; right < findings.length; right += 1) {
      if (sameClauseTarget(findings[left], findings[right]) && groupIndexById.get(findings[left].id) !== groupIndexById.get(findings[right].id)) {
        throw new Error(`同一修改目标被拆分: ${findings[left].id}, ${findings[right].id}`)
      }
    }
  }
  return groups
}

const numberedText = (members, field) => {
  const values = [...new Set(members.map((member) => asText(member[field])).filter(Boolean))]
  if (values.length <= 1) return values[0] || ''
  return values.map((value, index) => `${CIRCLED_NUMBERS[index] || `${index + 1}.`}${value}`).join(' ')
}

const buildGroup = (members, groupIndex, relation, contractLines) => {
  const sorted = members.slice().sort((left, right) => {
    const lineDiff = (left.lineStart ?? Number.MAX_SAFE_INTEGER) - (right.lineStart ?? Number.MAX_SAFE_INTEGER)
    return lineDiff || String(left.id).localeCompare(String(right.id))
  })
  const lineStarts = sorted.map((finding) => finding.lineStart).filter(Number.isInteger)
  const lineEnds = sorted.map((finding) => finding.lineEnd).filter(Number.isInteger)
  const lineStart = lineStarts.length ? Math.min(...lineStarts) : -1
  const lineEnd = lineEnds.length ? Math.max(...lineEnds) : lineStart
  const originalText = lineStart >= 0 && lineEnd >= lineStart
    ? contractLines.slice(lineStart, lineEnd + 1).join('\n').trim()
    : asText(sorted[0]?.originalText)
  const titles = [...new Set(sorted.map((finding) => asText(finding.title)).filter(Boolean))]
  const locations = [...new Set(sorted.map((finding) => asText(finding.location)).filter(Boolean))]
  const evidence = [...new Set(sorted.flatMap((finding) => Array.isArray(finding.evidence) ? finding.evidence : [finding.evidence]).filter(Boolean))]
  const highestLevel = sorted.reduce((top, finding) =>
    (LEVEL_RANK[finding.level] || 0) > (LEVEL_RANK[top] || 0) ? finding.level : top, sorted[0]?.level || '中')
  const isDuplicateGroup = sorted.length > 1 && relation === 'duplicate'

  return {
    id: `revision-group-${groupIndex + 1}`,
    memberFindingIds: sorted.map((finding) => finding.id),
    memberFindings: sorted,
    // duplicate 成员只是同一问题的多种表述；保留全部来源 ID，但对外只计一个有效问题。
    issueCount: isDuplicateGroup ? 1 : sorted.length,
    relation: sorted.length > 1 ? relation : 'independent',
    level: highestLevel,
    title: isDuplicateGroup ? (titles[0] || '合同条款需完善') : (titles.join('；') || '合同条款需完善'),
    location: locations.join('、'),
    anchor: lineStart >= 0 ? `L${lineStart + 1}${lineEnd > lineStart ? `-L${lineEnd + 1}` : ''}` : '',
    lineStart,
    lineEnd,
    clauseEnd: Math.max(...sorted.map((finding) => Number.isInteger(finding.clauseEnd) ? finding.clauseEnd : -1)),
    originalText,
    quoteText: sorted.length === 1 ? asText(sorted[0].quoteText) : '',
    quoteSpans: sorted.flatMap((finding) => Array.isArray(finding.quoteSpans) ? finding.quoteSpans : []),
    quoteStatus: sorted.length === 1 && sorted[0].quoteStatus === 'exact' ? 'exact' : 'none',
    risk: isDuplicateGroup ? asText(sorted[0]?.risk) : numberedText(sorted, 'risk'),
    advice: isDuplicateGroup ? asText(sorted[0]?.advice) : numberedText(sorted, 'advice'),
    replacement: isDuplicateGroup ? asText(sorted[0]?.replacement) : numberedText(sorted, 'replacement'),
    evidence
  }
}

/**
 * 将已定位 findings 收敛为互不冲突的修订组。
 * Agent 只建议分组；代码校验 ID 全覆盖和修改目标兼容性，失败时使用确定性分组。
 */
export function buildRevisionGroups({ findings = [], agentOutput = '', contractText = '' } = {}) {
  const canonicalFindings = Array.isArray(findings) ? findings.filter((finding) => finding?.id) : []
  if (!canonicalFindings.length) {
    return { groups: [], stats: { findings: 0, uniqueIssues: 0, groups: 0, consolidated: 0, fallbackUsed: false } }
  }

  let groupSpecs
  let fallbackUsed = false
  let fallbackReason = ''
  if (canonicalFindings.length === 1) {
    groupSpecs = [{ memberFindingIds: [canonicalFindings[0].id], relation: 'independent' }]
  } else {
    try {
      if (!agentOutput) throw new Error('未调用归并 Agent')
      groupSpecs = validateAgentGroups(extractJsonObject(agentOutput), canonicalFindings)
    } catch (error) {
      fallbackUsed = true
      fallbackReason = error.message
      groupSpecs = deterministicGroups(canonicalFindings)
    }
  }

  const findingsById = new Map(canonicalFindings.map((finding) => [finding.id, finding]))
  const contractLines = String(contractText || '').split('\n')
  const groups = groupSpecs.map((spec, index) =>
    buildGroup(spec.memberFindingIds.map((id) => findingsById.get(id)).filter(Boolean), index, spec.relation, contractLines))

  return {
    groups,
    stats: {
      findings: canonicalFindings.length,
      uniqueIssues: groups.reduce((sum, group) => sum + group.issueCount, 0),
      groups: groups.length,
      consolidated: canonicalFindings.length - groups.length,
      fallbackUsed,
      fallbackReason
    }
  }
}

export const findingConsolidatorInternals = { sameClauseTarget, canShareRevision, deterministicGroups }
