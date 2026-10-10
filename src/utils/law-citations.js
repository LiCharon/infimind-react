/**
 * 法规引用的识别规则（前端把正文里的法规引用标红用）。
 *
 * ⚠️ 这里的规则必须与服务端 `citation-verifier.js` 的抽取规则**保持一致**。
 * 标红的文本和「法规引用核实」面板里校验的文本若对不上，用户会看到
 * "标红的没被校验、校验的没标红"——那比完全不标还糟，等于给用户一个错误的
 * 检查清单。
 *
 * 覆盖范围与取舍：
 *  - 只识别**书名号形式**（`《法规名》` 及其后紧邻的 `第X条`）。它是校验器的
 *    主路径，也是法律回答里引用法规的绝对主流写法。
 *  - 不识别无书名号的别名形式（如"劳动合同法第三十八条"）：那需要法规白名单
 *    才能可靠判定，而三个工作台里只有用工咨询页持有白名单——为它做差异化标红，
 *    会让同一段回答在不同页面表现不一致，反而更难解释。
 *
 * 排除规则同样照搬服务端：书名号里是被上传材料的标题（《员工手册》）或
 * 章节标题（《第三章 …》）时不算法规引用。少了这层过滤，界面会被大量
 * 误导性标红淹没。
 */

/** 中文数字与阿拉伯数字的条号 */
const ARTICLE_PATTERN = '第\\s*([一二三四五六七八九十百千零〇两\\d]{1,8})\\s*条'
/** 书名号引用：《法规名》[第X条] */
const BRACKET_SOURCE = `《([^》]{2,80})》(?:\\s*${ARTICLE_PATTERN})?`
/** 非法规的书名号内容：附件、附件N、第X章… */
const NON_LEGAL_PREFIX = /^(附件|附件\d|第[一二三四五六七八九十]+章)/

/**
 * 法律规范的名称后缀。
 * 「解释（一）」这类尾部括号要先去掉再比对，否则《…解释（一）》会被漏掉。
 */
const LEGAL_NORM_SUFFIX = /(法|法典|条例|规定|办法|实施细则|解释|决定|规则|准则|通知|意见|批复|复函|答复|纪要|通则|章程)$/

/**
 * 判断书名号内的名称是否"看起来是法律规范"。
 * @param {string} name
 * @returns {boolean}
 */
export function looksLikeLegalNorm(name) {
  const cleaned = String(name || '')
    .replace(/[（(][^）)]*[）)]\s*$/, '')
    .replace(/[\s\u3000]+/g, '')
    .trim()
  if (cleaned.length < 3) return false
  return LEGAL_NORM_SUFFIX.test(cleaned)
}

/**
 * 把一个纯文本片段按法规引用切成若干段，供渲染层分别处理。
 *
 * 为什么按"文本节点"而不是"整篇原文"切：Markdown 渲染前会剥掉语法符号
 * （`**`、`#`），整篇原文的字符下标和渲染后的文本对不上，做偏移映射既复杂又脆。
 * 而法规引用是连续纯文本，在单个文本节点内必然完整——按节点处理既简单又不会错位。
 *
 * @param {string} value 单个文本节点的内容
 * @returns {Array<{ text: string, isCitation: boolean }> | null}
 *          没有命中引用时返回 null（调用方据此跳过重建，避免无谓的对象分配）
 */
export function splitLawCitations(value) {
  const source = String(value || '')
  // 快速短路：绝大多数文本节点不含书名号
  if (!source.includes('《')) return null

  const pattern = new RegExp(BRACKET_SOURCE, 'g')
  const parts = []
  let cursor = 0

  for (const match of source.matchAll(pattern)) {
    const lawName = String(match[1] || '').trim()
    if (NON_LEGAL_PREFIX.test(lawName)) continue
    if (!looksLikeLegalNorm(lawName)) continue
    if (match.index > cursor) parts.push({ text: source.slice(cursor, match.index), isCitation: false })
    // match[0] 已包含紧随的「第X条」（若存在）
    parts.push({ text: match[0], isCitation: true })
    cursor = match.index + match[0].length
  }

  if (!parts.length) return null
  if (cursor < source.length) parts.push({ text: source.slice(cursor), isCitation: false })
  return parts
}

/** 统计文本里的法规引用处数（测试与排查用） */
export function countLawCitations(value) {
  const parts = splitLawCitations(value)
  return parts ? parts.filter((part) => part.isCitation).length : 0
}
