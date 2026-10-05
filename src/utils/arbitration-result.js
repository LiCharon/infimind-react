export const riskLabel = (level) => ({ low: '低', medium: '中', high: '高', unknown: '暂无法判断' }[level] || '暂无法判断')
const array = (value) => Array.isArray(value) ? value.filter((item) => item != null) : []
const text = (value) => typeof value === 'string' ? value.trim() : ''
const bullet = (value) => `- ${String(value).replace(/\n/g, '\n  ')}`
const section = (title, lines) => lines.length ? `## ${title}\n\n${lines.join('\n\n')}` : ''

// Shared by server acceptance and historical-result rendering; never coerce objects into facts.
export function normalizeArbitrationResult(value) {
  const record = (item) => item && typeof item === 'object' && !Array.isArray(item)
  const objects = (items) => array(items).filter(record)
  const strings = (items) => array(items).map(text).filter(Boolean)
  const fields = (item, names) => Object.fromEntries(names.map((name) => [name, text(item[name])]))
  const result = record(value) ? { ...value } : {}
  for (const name of ['answer', 'defenseDraft', 'conversationTitle']) result[name] = text(result[name])
  result.claims = objects(result.claims).map((claim) => ({
    ...fields(claim, ['requestId', 'claim', 'companyPosition', 'defenseAdvice', 'reasoning', 'riskLevel', 'riskReason', 'materialSufficiency']),
    sourceIds: strings(claim.sourceIds), factIds: strings(claim.factIds), referenceIds: strings(claim.referenceIds),
    subitems: strings(claim.subitems), sources: objects(claim.sources),
    legalBasis: objects(claim.legalBasis).map((law) => fields(law, ['name', 'article', 'status', 'note'])),
    evidence: objects(claim.evidence).map((item) => fields(item, ['name', 'proves', 'source', 'sourceId', 'status'])),
    evidenceGaps: objects(claim.evidenceGaps).map((item) => fields(item, ['fact', 'suggestedEvidence', 'purpose']))
  })).filter((claim) => claim.claim)
  const shapes = {
    caseInfo: ['label', 'value', 'source', 'status'], documentTypes: ['fileName', 'type', 'confidence', 'reason'],
    evidenceGaps: ['fact', 'suggestedEvidence', 'purpose', 'priority'], evidenceList: ['name', 'purpose', 'source', 'estimatedPages'],
    references: ['title', 'sourceType', 'use']
  }
  for (const [name, names] of Object.entries(shapes)) result[name] = objects(result[name]).map((item) => fields(item, names))
  result.disputes = array(result.disputes).filter((item) => typeof item === 'string' || record(item)).map((item) => typeof item === 'string' ? item : {
    ...fields(item, ['topic', 'applicantPosition', 'companyPosition']), unknowns: strings(item.unknowns)
  })
  for (const name of ['riskBasis', 'defenseStrategy', 'hearingPoints', 'followUpQuestions', 'warnings']) result[name] = strings(result[name])
  return result
}

export function formatArbitrationDraft(value) {
  const lines = []
  for (const line of text(value).split('\n')) {
    if (/^#{1,6}\s+(?:第[一二三四五六七八九十\d]+条[:：]\s*)?关于/.test(line)) {
      const previous = [...lines].reverse().find((item) => item.trim())
      if (previous && previous.trim() !== '---') lines.push('', '---', '')
    }
    lines.push(line)
  }
  return lines.join('\n')
}

// 即使模型偶尔返回表格，也转成带字段名的文字段落，保留内容。
export function remarkArbitrationText() {
  const flatten = (node) => node.value || (node.children || []).map(flatten).join('')
  const visit = (node) => {
    if (!Array.isArray(node.children)) return
    node.children = node.children.flatMap((child) => {
      if (child.type !== 'table') { visit(child); return [child] }
      const rows = child.children || []
      const labels = (rows[0]?.children || []).map(flatten)
      return rows.slice(1).map((row) => ({ type: 'paragraph', children: row.children.flatMap((cell, index) => [
        ...(index ? [{ type: 'text', value: '；' }] : []),
        { type: 'strong', children: [{ type: 'text', value: `${labels[index] || '内容'}：` }] },
        ...(cell.children || [])
      ]) }))
    })
  }
  return visit
}

// 同一份纯文本用于对话展示与下轮上下文，保留旧结果字段兼容历史记录。
export function formatArbitrationResult(result = {}) {
  result = normalizeArbitrationResult(result)
  const sections = [text(result.answer)]
  if (result.changes?.message) sections.push(text(result.changes.message))
  if (array(result.changes?.items).length) sections.push(array(result.changes.items).map((item) => {
    const levels = { low: '低', medium: '中', high: '高', unknown: '暂无法判断' }
    const current = levels[item.riskLevel] || '暂无法判断'
    const before = levels[item.previousRisk]
    return bullet(`${text(item.claim)}：${before && before !== current ? `风险由${before}调整为${current}` : `风险${current}`}；${item.directionChanged ? '答辩方向已更新，见下文' : '已重新核对本轮依据'}`)
  }).join('\n'))
  if (array(result.changes?.removedRequests).length) sections.push(`本轮有效请求中已移除：${result.changes.removedRequests.map(text).join('；')}。旧版仍保留供查看。`)
  if (result.draftStatus === 'failed') sections.push(`**本次草稿未完成**：${text(result.draftError?.message) || '未通过检查'}；案件分析仍可查看。`)
  if (result.materialCoverage?.partial) sections.push('**材料读取提示**：部分正文未纳入本轮分析，以下仅针对已读取材料和已识别请求；不代表全案已经核对完整。')
  if (result.kind !== 'reply' || array(result.riskBasis).length) {
    sections.push(section('案件风险判断', [
      `**企业侧风险：${riskLabel(result.overallRisk)}**`,
      ...array(result.riskBasis).map(bullet),
      '风险判断基于当前材料，补充证据后可能调整；不代表胜诉承诺。'
    ]))
  }
  sections.push(section('基本信息梳理', array(result.caseInfo).map((item) =>
    bullet(`**${item.label || '案件信息'}**：${item.value || '待补充'}${item.status === 'claimed' ? '（当事方陈述，待核实）' : item.status === 'unknown' ? '（待核实）' : ''}${item.source ? `；来源：${item.source}` : ''}`))))
  sections.push(section('请求事项分析', array(result.claims).map((claim, index) => [
    `### ${index + 1}. ${claim.claim || '待明确的仲裁请求'}`,
    `**${text(result.defenseDraft) ? '企业答辩立场' : '答辩结论'}**：${claim.companyPosition || '需补充材料后判断'}（风险：${riskLabel(claim.riskLevel)}）`,
    !text(result.defenseDraft) && claim.defenseAdvice ? `**答辩建议**：${claim.defenseAdvice}` : '',
    array(claim.legalBasis).length ? `**法规核对提示**：${claim.legalBasis.map((law) => `${law.name || '待核对法规'}${law.article ? ` ${law.article}` : ''}（${law.status === 'verified' ? '法规名称已匹配，具体条文与本案适用性仍需核对' : '未核实，请核对现行文本与本案适用性'}）`).join('；')}` : '**法规核对提示**：待核对适用法规及条文。',
    claim.reasoning ? `**${text(result.defenseDraft) ? '初步分析' : '具体分析'}**：${claim.reasoning}` : '',
    claim.riskReason ? `**风险依据**：${claim.riskReason}` : '',
    claim.materialSufficiency ? `**材料充分程度**：${({ sufficient: '已有相关材料，仍需复核', partial: '部分材料待补充', insufficient: '关键信息不足' })[claim.materialSufficiency] || '待核实'}` : '',
    array(claim.evidenceGaps).length ? `**证据缺口**：${claim.evidenceGaps.map((gap) => `${gap.fact || '待证事实'}；建议补充${gap.suggestedEvidence || '相关证据'}`).join('；')}` : ''
  ].filter(Boolean).join('\n\n'))))
  sections.push(section('核心争议点总结', array(result.disputes).map((item) => typeof item === 'string' ? bullet(item) :
    bullet(`**${item.topic || '争议焦点'}**${item.applicantPosition ? `；申请方主张：${item.applicantPosition}` : ''}${item.companyPosition ? `；企业立场：${item.companyPosition}` : ''}${array(item.unknowns).length ? `；待核实：${item.unknowns.join('、')}` : ''}`))))
  if (text(result.defenseDraft)) sections.push(section('劳动仲裁答辩意见（草稿）', [formatArbitrationDraft(result.defenseDraft)]))
  sections.push(section('证据与庭审准备', [
    ...array(result.evidenceGaps).map((item) => bullet(`待证明：${item.fact || '待核实事实'}；建议材料：${item.suggestedEvidence || '待补充'}${item.purpose ? `；证明目的：${item.purpose}` : ''}`)),
    ...array(result.evidenceList).map((item) => bullet(`${item.name || '建议证据'}；证明目的：${item.purpose || '待明确'}；来源：${item.source || '建议补充'}`)),
    ...array(result.defenseStrategy).map(bullet), ...array(result.hearingPoints).map(bullet)
  ]))
  sections.push(section('需要补充的信息', array(result.followUpQuestions).map(bullet)))
  sections.push(section('参考资料', array(result.references).map((item) => bullet(`${item.title || '参考资料'}${item.use ? `：${item.use}` : ''}`))))
  sections.push(section('复核提示', array(result.warnings).map(bullet)))
  return sections.filter(Boolean).join('\n\n---\n\n')
}
