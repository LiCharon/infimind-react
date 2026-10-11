export const HANDBOOK_PRODUCT = 'handbook-diagnosis'
export const HANDBOOK_TERMINAL = new Set(['succeeded', 'failed', 'cancelled'])
export const HANDBOOK_STATUS = { queued: '等待处理', running: '正在检查', retry_waiting: '正在重试', cancel_requested: '正在停止', cancelled: '已停止', failed: '检查未完成', succeeded: '处理结束' }

export function formatHandbookReport(report) {
  if (!report) return ''
  if (report.kind === 'followup') return report.answer || ''
  const lines = ['员工手册诊断', `检查范围：${report.scope?.description || '范围待核实'}`,
    `检查状态：${report.analysisStatus === 'completed' ? '本次可读正文检查完成' : report.analysisStatus === 'blocked' ? '材料待处理，未完成诊断' : '检查尚未完成'}`]
  for (const finding of report.findings || []) {
    lines.push('', finding.title, `${finding.status === 'pending' ? '待核实' : '风险提示'} · ${finding.topic}`, finding.explanation)
    if (finding.verificationNote) lines.push(`核对状态：${finding.verificationNote}`)
    for (const citation of finding.evidence || []) lines.push(`原文：${citation.quote}`, `定位：${citation.location?.status === 'found' ? citation.location.matches[0].fileName + ' · ' + citation.location.matches[0].sectionTitle : '引用待核实'}`)
    if (finding.conditions?.length) lines.push(`适用条件：${finding.conditions.join('；')}`)
    for (const authority of finding.authorities || []) lines.push(`待核实依据：${authority.title} ${authority.article}；${authority.note}`)
    lines.push(`修改建议：${finding.recommendation}`)
    if (finding.suggestedClause) lines.push(`示例条款：${finding.suggestedClause}`)
    if (finding.relatedChanges?.length) lines.push(`关联修改：${finding.relatedChanges.join('；')}`)
  }
  for (const item of report.unreadableMaterials || []) lines.push(`未检查材料：${item.fileName}；${item.reason}`)
  if (report.pendingQuestions?.length) lines.push('', '待核实事项', ...report.pendingQuestions)
  if (report.procedureChecklist?.length) lines.push('', '程序核对清单（未审核证据）', ...report.procedureChecklist.map((item) => `${item.title}：${item.description}；${item.materials.join('、')}；${item.note}`))
  if (report.referenceVersions?.length) lines.push('', '参考资料', ...report.referenceVersions.map((item) => `${item.title} · ${item.version}（仅参考）`))
  if (report.warnings?.length) lines.push('', '检查限制', ...report.warnings)
  return lines.filter((value) => typeof value === 'string').join('\n')
}

export async function readHandbookEvents(response, receive, signal) {
  if (!response.body) throw new Error('检查进度暂不可读取')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const cancel = () => { void reader.cancel().catch(() => {}) }
  signal?.addEventListener('abort', cancel, { once: true })
  const consume = (block) => {
    let event = 'message'
    let sequence = 0
    const data = []
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      if (line.startsWith('id:')) sequence = Number(line.slice(3).trim()) || 0
      if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
    }
    if (data.length) {
      let payload
      try { payload = JSON.parse(data.join('\n')) } catch { throw new Error('检查进度读取不完整，请重新连接') }
      receive(event, payload, sequence)
    }
  }
  try {
    while (!signal?.aborted) {
      const { done, value } = await reader.read()
      if (signal?.aborted) break
      buffer = (buffer + decoder.decode(value || new Uint8Array(), { stream: !done })).replace(/\r\n/g, '\n')
      const blocks = buffer.split('\n\n')
      buffer = blocks.pop() || ''
      for (const block of blocks) consume(block)
      if (done) { if (buffer.trim()) consume(buffer); break }
    }
  } finally { signal?.removeEventListener('abort', cancel); reader.releaseLock() }
}
