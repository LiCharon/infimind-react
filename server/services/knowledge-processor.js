const MAX_CLAUSE_CHARS = 1600
const MIN_CLAUSE_CHARS = 80

/**
 * 将合同正文切成可引用的条款单元，而不是按固定字数盲切。
 * 结果保留条款号、标题、父级标题和原始字符位置，便于检索与审查报告回链。
 */
export function splitIntoClauses(text) {
  const normalized = normalizeText(text)
  if (!normalized) return []

  const lines = normalized.split('\n')
  const segments = []
  let current = createSegment({ title: '前言、主体与定义', clauseNo: '', parentTitle: '', startOffset: 0 })
  const hierarchy = new Map()
  let offset = 0

  for (const line of lines) {
    const trimmed = line.trim()
    const heading = parseHeading(trimmed)
    if (heading && current.content.trim()) {
      segments.push(finalizeSegment(current, offset - 1))
      const parentTitle = resolveParentTitle(heading, hierarchy)
      current = createSegment({ ...heading, parentTitle, startOffset: offset })
    } else if (heading && !current.content.trim()) {
      current = createSegment({ ...heading, parentTitle: resolveParentTitle(heading, hierarchy), startOffset: offset })
    }

    if (heading) hierarchy.set(heading.level, heading.title || heading.clauseNo)
    if (trimmed) current.content += `${current.content ? '\n' : ''}${trimmed}`
    offset += line.length + 1
  }
  if (current.content.trim()) segments.push(finalizeSegment(current, normalized.length))

  const expanded = []
  for (const segment of segments) {
    if (segment.content.length <= MAX_CLAUSE_CHARS) {
      expanded.push(segment)
      continue
    }
    const parts = splitLongClause(segment.content)
    parts.forEach((content, index) => expanded.push({
      ...segment,
      content,
      chunkIndex: index,
      title: `${segment.title}${parts.length > 1 ? `（${index + 1}/${parts.length}）` : ''}`,
      endOffset: segment.startOffset + content.length
    }))
  }

  const nonEmpty = expanded.filter((segment) => segment.content.length >= MIN_CLAUSE_CHARS)
  return (nonEmpty.length ? nonEmpty : expanded).map((segment, index) => ({
    ...segment,
    clauseKey: `clause-${index + 1}`,
    chunkIndex: segment.chunkIndex || 0
  }))
}

/** 将坏例中的人工批注转成可检索、可复用的风险规则。 */
export function extractRiskRules(text, clauses) {
  const source = String(text || '')
  const annotations = [
    ...findAnnotations(source, /【[^】]*(?:风险批注|风险分析|批注)[^】]*】/g),
    ...findAnnotations(source, /（(?:风险批注|风险分析)[^）]*）/g)
  ]
  const deduped = []
  const seen = new Set()
  for (const annotation of annotations) {
    const normalized = annotation.text.replace(/\s+/g, ' ').trim()
    if (normalized.length < 12 || seen.has(normalized)) continue
    seen.add(normalized)
    const clause = findNearestClause(annotation.startOffset, clauses)
    const category = inferRiskCategory(`${normalized}\n${clause?.content || ''}`)
    const severity = inferSeverity(normalized)
    const { riskText, recommendation } = parseAnnotation(normalized)
    deduped.push({
      ruleKey: `risk-${deduped.length + 1}`,
      sourceClauseKey: clause?.clauseKey || '',
      category,
      severity,
      triggerText: (clause?.content || '').slice(0, 1000),
      riskText,
      recommendation,
      sourceNote: normalized.slice(0, 1800)
    })
  }
  return deduped
}

/** 将 Word 原生批注转为可检索的人工审核证据，不将批注文字混入模板正文。 */
export function extractWordAnnotationRiskRules(annotations = [], clauses = [], revisions = {}) {
  return annotations
    .filter((annotation) => annotation?.text?.trim())
    .map((annotation, index) => {
      const anchor = String(annotation.anchor || '').trim()
      const category = inferWordAnnotationCategory(`${anchor}\n${annotation.text}`) || inferRiskCategory(`${anchor}\n${annotation.text}`)
      const revisionHint = revisions.insertions || revisions.deletions
        ? `文档修订足迹：新增 ${revisions.insertions || 0} 处，删除 ${revisions.deletions || 0} 处`
        : ''
      const sourceClause = anchor ? findClauseByText(anchor, clauses) : null
      return {
        ruleKey: `word-comment-${index + 1}`,
        sourceClauseKey: sourceClause?.clauseKey || '',
        category,
        severity: '中',
        triggerText: (anchor || sourceClause?.content || '批注关联条款未保留').slice(0, 1000),
        riskText: `人工批注：${annotation.text.trim()}`.slice(0, 1200),
        recommendation: '请结合交易事实核对该条批注，必要时调整对应合同约定。',
        sourceNote: [
          '【Word 原生批注】',
          annotation.author ? `批注人：${annotation.author}` : '',
          annotation.date ? `日期：${annotation.date}` : '',
          revisionHint
        ].filter(Boolean).join('；')
      }
    })
}

export function inferRiskCategory(text) {
  const value = String(text || '')
  const categories = [
    ['合同效力与权利救济', /效力高于法律|排除法律|永久有效|放弃.*?(?:抗辩|索赔|起诉|仲裁|解除)|单方解释|法律适用/],
    ['主体、授权与通知', /主体|统一社会信用代码|授权|法定代表人|送达|通知|账户变更/],
    ['标的、范围与附件', /标的|规格|数量|范围|图纸|样品|附件|订单|工程量清单/],
    ['价税、付款与发票', /价款|付款|预付款|尾款|税率|含税|发票|收款账户|结算/],
    ['交付、履行与验收', /交付|发货|签收|验收|隐蔽瑕疵|履行|到货/],
    ['质量、质保与售后', /质量|质保|瑕疵|维修|退货|更换|售后/],
    ['风险、所有权与保险', /风险转移|所有权|毁损|灭失|保险|货损/],
    ['变更、解除与违约', /变更|解除|违约|违约金|赔偿|延期|顺延|签证/],
    ['保密、数据与知识产权', /保密|数据|知识产权|专利|源代码|开源/],
    ['争议解决', /争议|管辖|仲裁|诉讼/],
    ['工程履约', /工程|施工|工期|进度款|竣工|安全/],
    ['运输、保管与仓储', /运输|承运|冷链|保管|仓储|仓单|提货/]
  ]
  return categories.find(([, pattern]) => pattern.test(value))?.[0] || '其他履约风险'
}

function normalizeText(text) {
  return String(text || '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

function createSegment({ clauseNo, title, parentTitle, startOffset, level = 0 }) {
  return { clauseNo, title, parentTitle, startOffset, endOffset: startOffset, level, content: '', chunkIndex: 0 }
}

function finalizeSegment(segment, endOffset) {
  return { ...segment, content: segment.content.trim(), endOffset }
}

function parseHeading(line) {
  const article = line.match(/^(第[一二三四五六七八九十百千万零〇]+条)\s*[、.．：:]?\s*(.*)$/)
  if (article) return { clauseNo: article[1], title: article[2] || article[1], level: 1 }

  const numbered = line.match(/^(\d+(?:\.\d+){1,3})[、.．）)]?\s+(.{2,})$/)
  if (numbered) return { clauseNo: numbered[1], title: numbered[2], level: numbered[1].split('.').length + 1 }

  const chinese = line.match(/^([一二三四五六七八九十]+)[、.．）)]\s*(.{2,})$/)
  if (chinese) return { clauseNo: chinese[1], title: chinese[2], level: 1 }
  return null
}

function resolveParentTitle(heading, hierarchy) {
  for (let level = heading.level - 1; level >= 1; level--) {
    if (hierarchy.has(level)) return hierarchy.get(level)
  }
  return ''
}

function splitLongClause(text) {
  const paragraphs = text.split(/\n+/).filter(Boolean)
  const parts = []
  let current = ''
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 1 > MAX_CLAUSE_CHARS) {
      parts.push(current)
      current = paragraph
    } else {
      current += `${current ? '\n' : ''}${paragraph}`
    }
  }
  if (current) parts.push(current)
  return parts
}

function findAnnotations(text, pattern) {
  return [...text.matchAll(pattern)].map((match) => ({ text: match[0], startOffset: match.index || 0 }))
}

function findNearestClause(offset, clauses) {
  if (!clauses?.length) return null
  return clauses.find((clause) => offset >= clause.startOffset && offset <= clause.endOffset) ||
    [...clauses].reverse().find((clause) => clause.startOffset <= offset) || clauses[0]
}

function inferSeverity(text) {
  if (/极高|特别高|高危|严重|重大/.test(text)) return '高'
  if (/中危|中等/.test(text)) return '中'
  if (/低危|低风险/.test(text)) return '低'
  return '中'
}

function inferWordAnnotationCategory(text) {
  return /劳动合同|试用期|工时|加班|工资|社保|劳动报酬|员工手册|规章制度|派驻|劳动仲裁|无固定期限|休息休假/.test(text) ? '劳动用工合规' : ''
}

function findClauseByText(anchor, clauses) {
  const normalizedAnchor = normalizeInline(anchor)
  if (!normalizedAnchor) return null
  return clauses.find((clause) => normalizeInline(clause.content).includes(normalizedAnchor)) ||
    clauses.find((clause) => normalizedAnchor.includes(normalizeInline(clause.content).slice(0, 80))) || null
}

function normalizeInline(text) {
  return String(text || '').replace(/\s+/g, ' ').trim()
}

function parseAnnotation(annotation) {
  const content = annotation.replace(/^[【（]|[】）]$/g, '').trim()
  const recommendationMatch = content.match(/(?:修改建议|建议)[:：]\s*([\s\S]+)$/)
  const recommendation = recommendationMatch?.[1]?.trim().slice(0, 900) || '请结合交易事实明确约定，并保留双方书面确认与救济路径。'
  const riskText = (recommendationMatch ? content.slice(0, recommendationMatch.index) : content).trim().slice(0, 1200)
  return { riskText, recommendation }
}
