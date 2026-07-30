import { createHash } from 'node:crypto'

const normalizeForMatch = (value = '') => String(value)
  .replace(/[\s\u3000]+/g, '')
  .replace(/[“”"'‘’]/g, '')
  .trim()

const rangeText = (lines, range) => lines.slice(range.start, range.end + 1).map(normalizeForMatch).join('')

const rangeContainsQuote = (lines, range, quote) => {
  const normalizedQuote = normalizeForMatch(quote)
  return normalizedQuote.length >= 6 && rangeText(lines, range).includes(normalizedQuote)
}

const findQuoteRanges = (lines, quote) => {
  const needle = normalizeForMatch(quote)
  if (needle.length < 6) return []
  const singleLineMatches = []
  for (let index = 0; index < lines.length; index += 1) {
    const range = { start: index, end: index }
    if (rangeContainsQuote(lines, range, needle)) singleLineMatches.push(range)
  }
  if (singleLineMatches.length) return singleLineMatches

  // 合同条款偶有跨行；按最短可匹配窗口返回，避免把同一段文本的多个超集范围误判成多处命中。
  for (let start = 0; start < lines.length; start += 1) {
    for (let width = 2; width <= 8 && start + width <= lines.length; width += 1) {
      const range = { start, end: start + width - 1 }
      if (rangeContainsQuote(lines, range, needle)) {
        const matches = []
        for (let candidateStart = 0; candidateStart + width <= lines.length; candidateStart += 1) {
          const candidateRange = { start: candidateStart, end: candidateStart + width - 1 }
          if (rangeContainsQuote(lines, candidateRange, needle)) matches.push(candidateRange)
        }
        return matches
      }
    }
  }
  return []
}

const locationTokens = (location = '') => {
  const text = String(location)
  return [...new Set([
    ...text.matchAll(/第[一二三四五六七八九十百千万零〇两\d]+条/g),
    ...text.matchAll(/\d+(?:\.\d+)+/g)
  ].map((match) => match[0]))]
}

const lineNgrams = (value = '') => {
  const text = normalizeForMatch(value)
  const grams = new Set()
  for (let index = 0; index < text.length - 1; index += 1) grams.add(text.slice(index, index + 2))
  return grams
}

const overlapScore = (query, source) => {
  const queryGrams = lineNgrams(query)
  if (!queryGrams.size) return 0
  const sourceGrams = lineNgrams(source)
  let matched = 0
  queryGrams.forEach((gram) => { if (sourceGrams.has(gram)) matched += 1 })
  return matched / queryGrams.size
}

const CLAUSE_HEADING_RE = /^\s*(?:#{1,4}\s*)?第[一二三四五六七八九十百千万零〇两\d]+条/

const isClauseHeadingLine = (line = '') => CLAUSE_HEADING_RE.test(String(line))

// 条款末尾：从定位行向后扫描到下一个“第X条”标题，供新增条款兜底插入到所属条款之后。
const findClauseEnd = (lines, startLine) => {
  if (!Array.isArray(lines) || !Number.isInteger(startLine) || startLine < 0) return -1
  for (let index = startLine + 1; index < lines.length; index += 1) {
    if (isClauseHeadingLine(lines[index])) return index - 1
  }
  return lines.length - 1
}

// 只做精确子串命中：把 normalizeForMatch 会丢弃的空白/引号保留为偏移映射，
// 命中后回映成原始行内字符区间。无法精确映射时不猜 span，交由前端回退整段显示。
const findQuoteSpansInRange = (lines, range, quote = '') => {
  const needle = normalizeForMatch(quote)
  if (!Array.isArray(lines) || !range || !Number.isInteger(range.start) || !Number.isInteger(range.end) || needle.length < 6) {
    return { quoteText: '', quoteSpans: [], quoteStatus: 'none' }
  }

  let normalizedHaystack = ''
  const charMap = []
  for (let line = range.start; line <= range.end; line += 1) {
    const rawLine = String(lines[line] ?? '')
    for (let offset = 0; offset < rawLine.length; offset += 1) {
      const char = rawLine[offset]
      if (/[\s　]/.test(char) || /[“”"'‘’]/.test(char)) continue
      normalizedHaystack += char
      charMap.push({ line, offset })
    }
  }

  const hitIndex = normalizedHaystack.indexOf(needle)
  const hitEnd = hitIndex + needle.length - 1
  if (hitIndex < 0 || !charMap[hitIndex] || !charMap[hitEnd]) {
    return { quoteText: '', quoteSpans: [], quoteStatus: 'none' }
  }

  const start = charMap[hitIndex]
  const end = charMap[hitEnd]
  const quoteSpans = []
  for (let line = start.line; line <= end.line; line += 1) {
    const rawLine = String(lines[line] ?? '')
    const spanStart = line === start.line ? start.offset : 0
    const spanEnd = line === end.line ? end.offset + 1 : rawLine.length
    if (spanEnd > spanStart) quoteSpans.push({ line, start: spanStart, end: spanEnd })
  }

  const quoteText = quoteSpans.map((span) => String(lines[span.line] ?? '').slice(span.start, span.end)).join('\n').trim()
  const originalText = lines.slice(range.start, range.end + 1).join('\n').trim()
  if (!quoteText || !originalText.includes(quoteText)) {
    return { quoteText: '', quoteSpans: [], quoteStatus: 'none' }
  }
  return { quoteText, quoteSpans, quoteStatus: 'exact' }
}

const rangesOverlap = (left, right) => Boolean(
  left && right &&
  Number.isInteger(left.start) && Number.isInteger(left.end) &&
  Number.isInteger(right.start) && Number.isInteger(right.end) &&
  left.start <= right.end && right.start <= left.end
)

const bidirectionalOverlap = (left = '', right = '') => {
  const a = normalizeForMatch(left)
  const b = normalizeForMatch(right)
  if (!a || !b) return 0
  if (a === b) return 1
  return (overlapScore(a, b) + overlapScore(b, a)) / 2
}

// quote 相似度：完全相等为 1；包含关系返回真实长度比（子片段≠同一问题，交给 title 二次把关）；
// 否则用双向 n-gram 重叠度。
const quoteSimilarity = (left = '', right = '') => {
  const a = normalizeForMatch(left)
  const b = normalizeForMatch(right)
  if (!a || !b) return 0
  if (a === b) return 1
  if (a.includes(b) || b.includes(a)) {
    return Math.min(a.length, b.length) / Math.max(a.length, b.length)
  }
  return bidirectionalOverlap(a, b)
}

const findingRange = (value = {}) => {
  if (Number.isInteger(value.lineStart)) return { start: value.lineStart, end: Number.isInteger(value.lineEnd) ? value.lineEnd : value.lineStart }
  if (value.range && Number.isInteger(value.range.start)) return { start: value.range.start, end: Number.isInteger(value.range.end) ? value.range.end : value.range.start }
  return null
}

// 跨轮/跨措辞近似判重：quote 最可信，其次要求区间或位置相近，避免把同一条款的两个不同问题误合并。
const findingSimilarity = (left = {}, right = {}) => {
  const quoteSim = quoteSimilarity(left.quote ?? left.quoteText ?? '', right.quote ?? right.quoteText ?? '')
  const titleSim = bidirectionalOverlap(left.title ?? '', right.title ?? '')
  const leftLocation = normalizeForMatch(left.location ?? '')
  const rightLocation = normalizeForMatch(right.location ?? '')
  const sameLocation = Boolean(leftLocation && rightLocation && leftLocation === rightLocation)
  const rangeOverlap = rangesOverlap(findingRange(left), findingRange(right))

  // quote 高度一致（同一句的截断/扩写）直接判重；但 quote 完全相同时，缺失条款类批注常共用
  // 同一锚点行（如"到期时还本付息"），此时要看"问题同一性"：标题与风险描述需同时有重合
  // （共用锚点的不同缺失项，标题可能撞词如"还款"，但风险描述通常无关，借此区分）。
  const issueSim = bidirectionalOverlap(`${left.title ?? ''} ${left.risk ?? ''}`, `${right.title ?? ''} ${right.risk ?? ''}`)
  const riskSim = bidirectionalOverlap(left.risk ?? '', right.risk ?? '')
  const issueMatch = issueSim >= 0.35 || (titleSim >= 0.3 && riskSim >= 0.15)
  if (quoteSim >= 0.85 && (quoteSim < 1 || issueMatch)) return { similar: true, reason: 'quote', quoteSim, titleSim, sameLocation, rangeOverlap }
  if (quoteSim >= 0.55 && titleSim >= 0.45) return { similar: true, reason: 'quote-title', quoteSim, titleSim, sameLocation, rangeOverlap }
  if (rangeOverlap && quoteSim >= 0.45 && issueMatch) return { similar: true, reason: 'range-quote', quoteSim, titleSim, sameLocation, rangeOverlap }
  if (rangeOverlap && titleSim >= 0.75 && quoteSim >= 0.20) return { similar: true, reason: 'range-title', quoteSim, titleSim, sameLocation, rangeOverlap }
  if (sameLocation && titleSim >= 0.82 && quoteSim >= 0.25) return { similar: true, reason: 'location-title', quoteSim, titleSim, sameLocation, rangeOverlap }
  return { similar: false, reason: '', quoteSim, titleSim, sameLocation, rangeOverlap }
}

export {
  normalizeForMatch,
  findQuoteRanges,
  locationTokens,
  lineNgrams,
  overlapScore,
  isClauseHeadingLine,
  findClauseEnd,
  findQuoteSpansInRange,
  findingSimilarity
}

const findCodeLocatedRange = (lines, { location = '', quote = '', title = '', risk = '' }) => {
  const exactRanges = findQuoteRanges(lines, quote)
  if (exactRanges.length === 1) return { range: exactRanges[0], status: 'verified' }

  const tokens = locationTokens(location)
  const locationLines = tokens.length
    ? lines.map((line, index) => ({ line, index })).filter(({ line }) => tokens.some((token) => line.includes(token))).map(({ index }) => index)
    : []

  // 由代码而非模型行号确定候选范围：先在模型给出的条款标题附近匹配，再退回全文的文本相似度。
  const scopes = locationLines.length
    ? locationLines.flatMap((line) => Array.from({ length: Math.min(8, lines.length - line) }, (_, offset) => line + offset))
    : Array.from({ length: lines.length }, (_, index) => index)
  const query = `${quote}\n${title}\n${risk}`
  let best = null
  for (const index of [...new Set(scopes)]) {
    if (!lines[index]?.trim()) continue
    const score = overlapScore(query, lines[index]) + (locationLines.includes(index) ? 0.35 : 0)
    if (!best || score > best.score) best = { index, score }
  }

  // 同一摘录在多处出现时，优先采用与“位置”字段对应的条款；无位置时必须有足够强的文本重合才采用。
  if (exactRanges.length > 1 && locationLines.length) {
    const nearest = exactRanges.toSorted((left, right) => Math.min(...locationLines.map((line) => Math.abs(left.start - line))) - Math.min(...locationLines.map((line) => Math.abs(right.start - line))))[0]
    return { range: nearest, status: 'code-located' }
  }
  // 有 location 线索也只能降低门槛，不能 0 分放行；否则“缺失条款”类批注会被随意锚到标题行。
  const minimumScore = locationLines.length ? 0.10 : 0.18
  if (best && best.score >= minimumScore) return { range: { start: best.index, end: best.index }, status: 'code-located' }
  return null
}

const asText = (value) => typeof value === 'string' ? value.trim() : ''

const extractJsonObject = (output = '') => {
  const trimmed = String(output).trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim()
  const candidate = fenced || trimmed
  const first = candidate.indexOf('{')
  const last = candidate.lastIndexOf('}')
  if (first < 0 || last <= first) throw new Error('审查模型没有返回 JSON 对象')
  try {
    return JSON.parse(candidate.slice(first, last + 1))
  } catch {
    throw new Error('审查模型返回的 JSON 格式不完整')
  }
}

// 仅作为模型未遵守 JSON 协议时的服务端恢复措施：仍然只读取本轮 Agent 2 的原始输出，
// 绝不从合同原文的【风险批注】或前端 Markdown 再造一套批注。
const parseMarkdownReviewOutput = (output = '') => {
  const headers = [...String(output).matchAll(/^#{1,6}\s*(?:【\s*)?(高|中|低)(?:风险)?\s*】?\s*(?:[:：—-]\s*)?(.+)$/gm)]
  if (!headers.length) return null
  const fieldEnd = '\\n\\s*(?:[-*+]\\s*)?(?:\\*\\*|__)?\\s*(?:定位|位置|原文(?:摘录|条款)?|风险(?:说明)?|建议(?:替换文本)?|知识库参考)(?:\\*\\*|__)?\\s*[：:]'
  const getField = (body, labels) => {
    for (const label of labels) {
      const match = body.match(new RegExp(`(?:^|\\n)\\s*(?:[-*+]\\s*)?(?:\\*\\*|__)?\\s*${label}(?:\\*\\*|__)?\\s*[：:]\\s*([\\s\\S]*?)(?=${fieldEnd}|$)`))
      if (match) return match[1].trim()
    }
    return ''
  }
  const findings = headers.map((header, index) => {
    const bodyStart = header.index + header[0].length
    const bodyEnd = headers[index + 1]?.index ?? output.length
    const body = output.slice(bodyStart, bodyEnd)
    const anchor = getField(body, ['定位', '行号'])
    const anchorNumbers = [...anchor.matchAll(/L?\s*(\d+)/gi)].map((match) => Number(match[1]))
    return {
      level: header[1],
      title: header[2].trim(),
      location: getField(body, ['位置', '条款位置']),
      lineStart: anchorNumbers[0],
      lineEnd: anchorNumbers[1] || anchorNumbers[0],
      quote: getField(body, ['原文', '原文摘录', '原条款', '条款原文']),
      risk: getField(body, ['风险', '风险说明']),
      advice: getField(body, ['建议']),
      replacement: getField(body, ['建议替换文本']),
      evidence: getField(body, ['知识库参考']).match(/E\d+/g) || []
    }
  })
  return { conclusion: '', findings, completeness: [] }
}

const extractReviewPayload = (output = '') => {
  try {
    return extractJsonObject(output)
  } catch (jsonError) {
    const recovered = parseMarkdownReviewOutput(output)
    if (recovered) return recovered
    throw jsonError
  }
}

export { extractReviewPayload }

const normalizeLevel = (value) => ({ 高: '高', 中: '中', 低: '低' }[String(value || '').trim()] || null)

const documentHash = (text) => createHash('sha256').update(text).digest('hex')

/**
 * 将审核模型的 JSON 结果收敛为唯一、经验证的风险批注清单。
 * 模型不提供行号；代码使用原文摘录、条款名称及文本相似度计算范围，并只展示实际原文。
 */
export function buildReviewResult({ contractText = '', modelOutput = '' }) {
  const lines = contractText.split('\n')
  const payload = extractReviewPayload(modelOutput)
  const candidates = Array.isArray(payload.findings) ? payload.findings : []
  const findings = []
  const unresolved = []
  const seen = new Set()
  let repairedCount = 0
  let deduplicatedCount = 0

  candidates.forEach((candidate, index) => {
    const title = asText(candidate?.title)
    const level = normalizeLevel(candidate?.level)
    const quote = asText(candidate?.quote)
    const risk = asText(candidate?.risk)
    const advice = asText(candidate?.advice)
    const located = findCodeLocatedRange(lines, { location: candidate?.location, quote, title, risk })
    const range = located?.range
    const validationError = !title ? '缺少标题'
      : !level ? '风险等级必须为高、中或低'
        : !risk ? '缺少风险说明'
          : !advice ? '缺少处理建议'
            : !range ? '代码无法从原文中确定对应条款'
              : ''

    if (validationError) {
      unresolved.push({
        sourceIndex: index + 1,
        title: title || `第 ${index + 1} 项批注`,
        reason: validationError
      })
      return
    }

    const sourceText = lines.slice(range.start, range.end + 1).join('\n').trim()
    const duplicateKey = `${range.start}:${range.end}:${normalizeForMatch(title)}:${normalizeForMatch(sourceText)}`
    if (seen.has(duplicateKey)) {
      deduplicatedCount += 1
      return
    }

    const spanInfo = findQuoteSpansInRange(lines, range, quote)
    const clauseEnd = findClauseEnd(lines, range.start)
    const candidateCore = {
      title,
      location: asText(candidate?.location),
      risk,
      quote: spanInfo.quoteText || quote,
      lineStart: range.start,
      lineEnd: range.end
    }
    const isDuplicate = findings.some((existing) => findingSimilarity(candidateCore, {
      title: existing.title,
      location: existing.location,
      risk: existing.risk,
      quote: existing.quoteText || existing.originalText,
      lineStart: existing.lineStart,
      lineEnd: existing.lineEnd
    }).similar)
    if (isDuplicate) {
      deduplicatedCount += 1
      return
    }

    seen.add(duplicateKey)
    const status = located.status
    if (status !== 'verified') repairedCount += 1
    findings.push({
      id: `finding-${index + 1}`,
      level,
      title,
      location: asText(candidate?.location),
      anchor: `L${range.start + 1}${range.end > range.start ? `-L${range.end + 1}` : ''}`,
      // 条款上下文：展示完整所在条款；问题子句由 quoteText/quoteSpans 单独标出。
      originalText: sourceText,
      quoteText: spanInfo.quoteText,
      quoteSpans: spanInfo.quoteSpans,
      quoteStatus: spanInfo.quoteStatus,
      clauseEnd,
      risk,
      advice,
      replacement: asText(candidate?.replacement),
      evidence: Array.isArray(candidate?.evidence) ? candidate.evidence.filter((item) => typeof item === 'string') : asText(candidate?.evidence),
      lineStart: range.start,
      lineEnd: range.end,
      status
    })
  })

  return {
    documentHash: documentHash(contractText),
    conclusion: asText(payload.conclusion),
    completeness: Array.isArray(payload.completeness) ? payload.completeness.map(asText).filter(Boolean) : [],
    findings,
    unresolved,
    stats: {
      generated: candidates.length,
      verified: findings.length - repairedCount,
      repaired: repairedCount,
      unresolved: unresolved.length,
      deduplicated: deduplicatedCount,
      quoteExact: findings.filter((finding) => finding.quoteStatus === 'exact').length,
      confirmed: findings.length
    }
  }
}

/** 将同一份结构化 findings 渲染为对话中展示的 Markdown，禁止再使用模型原始文本作为另一套事实来源。 */
export function renderReviewReport(reviewResult) {
  const lines = ['# 审查结论']
  lines.push(reviewResult.conclusion || '已完成合同风险审查。')
  lines.push('', '# 逐条批注')
  if (!reviewResult.findings.length) lines.push('未发现可稳定定位到原文的风险批注。')
  reviewResult.findings.forEach((finding) => {
    lines.push(
      '',
      `## 【${finding.level}】${finding.title}`,
      `- 定位：${finding.anchor}`,
      `- 位置：${finding.location || '相关条款'}`,
      `- 原文：${finding.originalText}`,
      ...(finding.quoteText && finding.quoteText !== finding.originalText ? [`- 问题子句：${finding.quoteText}`] : []),
      `- 风险：${finding.risk}`,
      `- 建议：${finding.advice}`
    )
    if (finding.replacement) lines.push(`- 建议替换文本：${finding.replacement}`)
    if (Array.isArray(finding.evidence) ? finding.evidence.length : finding.evidence) lines.push(`- 知识库参考：${Array.isArray(finding.evidence) ? finding.evidence.join('、') : finding.evidence}`)
  })
  if (reviewResult.completeness.length) lines.push('', '# 完整性清单', ...reviewResult.completeness.map((item) => `- ${item}`))
  lines.push('', '# 审查说明', '结果供合同完善参考；签署、重大金额、强监管或争议项目应结合具体事实由专业人士复核。')
  return lines.join('\n')
}
