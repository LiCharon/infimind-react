// Structural checks only: legal applicability and factual authenticity still need professional review.
const requestTerms = ['加班费', '年休假', '二倍工资', '双倍工资', '经济补偿', '违法解除', '赔偿金', '代通知金', '工资差额', '拖欠工资', '停工留薪', '一次性伤残补助金', '一次性工伤医疗补助金', '一次性伤残就业补助金', '住院伙食补助', '食宿费', '护理费', '交通费', '辅助器具']
const paymentAcknowledgement = /(?<!不|未)(?:认可(?:应)?支付|认可应当支付|仅需补(?:差额|付|足)|应补差额)/
const canonical = (value) => String(value || '').replace(/双倍工资/g, '二倍工资').replace(/违法解除(?:劳动合同)?赔偿金/g, '违法解除')
const matchesRequest = (name, text) => {
  const source = canonical(name), target = canonical(text)
  const terms = requestTerms.filter((term) => source.includes(term))
  const core = source.replace(/^\s*(?:[一二三四五六七八九十\d]+[、.．)）]|[（(][一二三四五六七八九十\d]+[)）])/, '').replace(/[\d,.]+\s*元?/g, '').replace(/请求|支付|关于|要求|[\s，。；：]/g, '')
  return terms.length ? terms.every((term) => target.includes(term)) : Boolean(core && target.includes(core.slice(0, 20)))
}

export function arbitrationRequestCoverageIssues(requests, sourceRequests) {
  const assigned = new Set()
  return sourceRequests.flatMap((request) => {
    const index = requests.findIndex((item, i) => !assigned.has(i) && matchesRequest(request, item.text || item.claim))
    if (index < 0) return [`案件整理遗漏或合并原文明确请求：${request}`]
    assigned.add(index)
    return []
  })
}

export function extractExplicitArbitrationRequests(text) {
  const requests = []
  // Only section headings introduce requests. A prose sentence such as
  // "恳请驳回其仲裁请求。" must not turn later numbered factual arguments into claims.
  for (const match of String(text || '').matchAll(/^[ \t]*(?:#{1,6}[ \t]*)?(?:[一二三四五六七八九十\d]+[、，,.．)）][ \t]*)?(?:仲裁请求|申请请求|请求事项)(?:如下)?(?=[：:\s]|$)[：:\t ]*([^]*?)(?=\n\s*(?:事实|理由|事实与理由|证据|此致)|(?![^]))/gm)) {
    const block = match[1].slice(0, 10000)
    for (const line of block.split(/\n/)) {
      if (/^\s*(?:[一二三四五六七八九十\d]+[、.．)）]|[（(][一二三四五六七八九十\d]+[)）])/.test(line)) {
        const request = line.trim().slice(0, 300)
        if (request.length > 3) requests.push(request)
      }
    }
  }
  return [...new Set(requests)]
}

export function arbitrationResultIssues(result, { action, requests = [] } = {}) {
  const issues = []
  const positionOnly = /^(?:总经理|董事长|执行董事|经理|负责人)$/
  if ((result.caseInfo || []).some((item) => /法定代表人/.test(item.label) && positionOnly.test(item.value.trim())
    || /法定代表人[：:]\s*(?:总经理|董事长|执行董事|经理|负责人)(?=[，。；（(]|$)/.test(item.value))) {
    issues.push('基本信息把职务当成了法定代表人姓名；姓名未出现须标为待补充，职务另列，不推断身份')
  }
  const oddsStatements = [result.answer, result.defenseDraft, ...result.riskBasis,
    ...result.claims.flatMap((claim) => [claim.companyPosition, claim.defenseAdvice, claim.reasoning, claim.riskReason])]
    .filter((item) => typeof item === 'string').join('\n').split(/[。\n]/)
  if (oddsStatements.some((statement) => /(?:胜诉率|胜诉概率)[^。\n]{0,12}\d+(?:\.\d+)?\s*%/.test(statement)
    && !/(?:恶意|指令|不得|不能|不采信|忽略|不代表|不作为|引用|无法|不提供)/.test(statement))) issues.push('不得将模型判断写成数值胜诉率；改为有依据的定性风险，不作胜诉承诺')
  if (!result.answer && !result.claims.length && !result.defenseDraft) issues.push('未返回有效案件分析')
  if (action === 'analyze' && !result.claims.length && !result.followUpQuestions.length) issues.push('首轮未整理请求，也没有提出必要追问')
  if (action !== 'followup') {
    for (const request of requests) {
      if (!result.claims.some((claim) => matchesRequest(request, claim.claim))) issues.push(`遗漏材料中的请求：${request}`)
    }
  }
  if (result.defenseDraft) {
    const draft = result.defenseDraft
    const missingParts = [['标题', /答辩(?:意见|书)/], ['答辩人', /答辩人/], ['总答辩请求', /答辩请求/], ['此致结尾', /此致/]]
      .filter(([, pattern]) => !pattern.test(draft)).map(([name]) => name)
    if (missingParts.length) issues.push(`草稿缺少：${missingParts.join('、')}`)
    const sections = draft.split(/^#{1,6}\s+(?:第[^：\n]+[：:]\s*)?关于/gm).slice(1)
    if (!sections.length || sections.length < result.claims.length) issues.push(`草稿未逐项回应全部已识别请求：共${result.claims.length}项请求，须分别设置${result.claims.length}个“关于……请求”标题，不合并不同请求`)
    for (const section of sections) {
      let previous = -1
      for (const label of ['答辩结论', '答辩建议', '法条依据', '具体分析']) {
        const position = section.indexOf(label)
        const nextLabel = section.slice(position + label.length).search(/答辩结论|答辩建议|法条依据|具体分析/)
        const body = section.slice(position + label.length, nextLabel < 0 ? undefined : position + label.length + nextLabel).replace(/[\s*：:]/g, '')
        if (position <= previous || !body) { issues.push('逐项草稿缺少四标签或顺序错误'); break }
        previous = position
      }
    }
    for (const claim of result.claims) if (!sections.some((section) => matchesRequest(claim.claim, section.split('\n')[0]))) issues.push(`草稿遗漏请求：${claim.claim}`)
    // Catch a narrow, visible contradiction: acknowledging a payment obligation
    // in an individual response while requesting blanket dismissal elsewhere.
    const acknowledgesPayment = result.claims.some((claim) => paymentAcknowledgement.test(claim.companyPosition))
      || sections.some((section) => paymentAcknowledgement.test(section.split('答辩建议')[0]))
    if (acknowledgesPayment) {
      const summaries = [draft.split(/#{1,6}\s+关于/)[0], draft.split(/#{1,6}\s+结语/)[1]?.split('此致')[0] || '']
      if (summaries.some((part) => /驳回[^。\n]{0,40}(?:全部|所有)?仲裁请求/.test(part)
        && !/(?:其余|不合理部分|无依据部分|超出[^。\n]{0,20}部分|不应支持的部分|缺乏[^。\n]{0,20}部分)/.test(part))) {
        issues.push('草稿整体答辩请求与逐项认可支付义务矛盾；仅对不应支持或超出合理范围的部分请求驳回，认可部分须保留待核实或待企业确认')
      }
    }
  } else if (action === 'draft') issues.push('模型未返回答辩文书正文')
  if (action !== 'followup') {
    for (const claim of result.claims) if (!claim.companyPosition || !claim.reasoning) issues.push(`请求缺少答辩立场或分析：${claim.claim}`)
  }
  return [...new Set(issues)]
}

export function selectArbitrationMaterialText(documents, query = '', budget = 80000) {
  const readable = documents.filter((document) => typeof document.text === 'string' && document.text.trim())
  // A per-document share keeps a later large file from evicting an earlier application.
  const share = Math.floor(budget / Math.max(1, readable.length))
  const keywords = [...new Set([...requestTerms.filter((term) => query.includes(term)), '仲裁请求', '请求事项', '事实与理由'])]
  return readable.map((document) => {
    const source = document.text.trim()
    if (source.length <= share) return { ...document, text: source, partial: Boolean(document.truncated) }
    const ranges = [[0, Math.floor(share / 3)], [Math.max(0, source.length - Math.floor(share / 6)), source.length]]
    let remaining = share - ranges.reduce((sum, [from, to]) => sum + to - from, 0)
    for (const word of keywords) {
      const index = source.indexOf(word)
      if (index < 0 || remaining <= 0) continue
      const from = Math.max(0, index - 100)
      const to = Math.min(source.length, from + Math.min(remaining, 3000))
      ranges.push([from, to]); remaining -= to - from
    }
    if (remaining > 0) ranges.push([Math.floor(share / 3), Math.floor(share / 3) + remaining])
    ranges.sort((a, b) => a[0] - b[0])
    const merged = []
    for (const range of ranges) {
      const last = merged.at(-1)
      if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1])
      else merged.push([...range])
    }
    return { ...document, text: merged.map(([from, to]) => `【原文字符${from + 1}—${to}】\n${source.slice(from, to)}`).join('\n【中间正文未纳入本轮】\n'), partial: true }
  })
}
