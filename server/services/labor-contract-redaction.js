const COMPANY_SUFFIX = '(?:股份有限公司|有限责任公司|有限公司|集团公司|集团|公司)'

function collectMatches(text, pattern, category, values) {
  for (const match of String(text || '').matchAll(pattern)) {
    const value = String(match[1] || match[0] || '').trim()
    if (value.length >= 2 && !values.has(value)) values.set(value, category)
  }
}

function buildEntries(documents = [], extraTexts = [], existingAliases = [], categories = null) {
  const values = new Map()
  const text = [
    ...documents.map((document) => `${document.fileName || ''}\n${document.text || ''}`),
    ...extraTexts.map((item) => typeof item === 'string' ? item : JSON.stringify(item))
  ].join('\n')

  collectMatches(text, new RegExp(`[\\u4e00-\\u9fffA-Za-z0-9·（）()]{2,50}${COMPANY_SUFFIX}`, 'g'), 'organization', values)
  collectMatches(text, /(?:姓名|劳动者|员工|甲方|乙方|用人单位|派遣单位|用工单位|签字人|联系人|法定代表人|负责人)(?:姓名)?\s*[：:]\s*([\u4e00-\u9fff]{2,4})(?=$|[\s，,。；;])/g, 'person', values)
  collectMatches(text, /(?<!\d)(1[3-9]\d{9})(?!\d)/g, 'phone', values)
  collectMatches(text, /(?<![\dA-Za-z])([1-9]\d{5}(?:18|19|20|21)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx])(?![\dA-Za-z])/g, 'identity', values)
  collectMatches(text, /(?<![\dA-Za-z])([1-9]\d{7}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3})(?![\dA-Za-z])/g, 'identity', values)
  collectMatches(text, /(?<![A-Z0-9._%+-])([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})(?![A-Z0-9._%+-])/gi, 'email', values)
  collectMatches(text, /(?:统一社会信用代码|社会信用代码|组织机构代码)\s*[：:]?\s*([0-9A-HJ-NPQRTUWXY]{18})/gi, 'business-id', values)
  collectMatches(text, /(?:银行卡号|银行账号|银行账户|收款账号|收款账户|开户账号|开户账户)\s*[：:]?\s*([0-9\s-]{8,32})/g, 'bank-account', values)
  const allowedCategories = Array.isArray(categories) && categories.length ? new Set(categories) : null
  const prior = Array.isArray(existingAliases)
    ? existingAliases.filter((item) => item && typeof item.value === 'string' && typeof item.token === 'string')
      .filter((item) => !allowedCategories || allowedCategories.has(item.category))
    : []
  for (const entry of prior) values.delete(entry.value)
  const counters = new Map()
  for (const entry of prior) counters.set(entry.category, (counters.get(entry.category) || 0) + 1)
  const discovered = [...values.entries()]
    .filter(([, category]) => !allowedCategories || allowedCategories.has(category))
    .sort(([left], [right]) => right.length - left.length)
    .map(([value, category]) => {
      const next = (counters.get(category) || 0) + 1
      counters.set(category, next)
      const token = category === 'organization'
        ? `【单位${String.fromCharCode(64 + Math.min(next, 26))}】`
        : category === 'person'
          ? `【个人${String.fromCharCode(64 + Math.min(next, 26))}】`
          : category === 'phone' ? `【电话${next}】`
            : category === 'email' ? `【邮箱${next}】`
                : category === 'bank-account' ? `【账户${next}】`
                  : category === 'business-id' ? `【企业代码${next}】`
                  : `【证件号${next}】`
      return { value, token, category }
    })
  return [...prior, ...discovered]
}

function replaceEntries(value, entries, direction) {
  let output = String(value || '')
  const ordered = [...entries].sort((left, right) => {
    const leftValue = direction === 'redact' ? left.value : left.token
    const rightValue = direction === 'redact' ? right.value : right.token
    return rightValue.length - leftValue.length
  })
  for (const entry of ordered) {
    const source = direction === 'redact' ? entry.value : entry.token
    const target = direction === 'redact' ? entry.token : entry.value
    if (source) output = output.split(source).join(target)
  }
  return output
}

export function createLaborContractRedactor({ documents = [], aliases = [], extraTexts = [], categories = null } = {}) {
  const entries = buildEntries(documents, extraTexts, aliases, categories)
  const mask = (value) => replaceEntries(value, entries, 'redact')
  const restore = (value) => replaceEntries(value, entries, 'restore')
  // Models occasionally drop brackets around aliases in extracted metadata.
  // Restore only a unique known entity alias; never relax quote matching.
  const uniqueNames = new Map()
  for (const entry of entries.filter((entry) => ['organization', 'person'].includes(entry.category))) {
    const bare = entry.token.replace(/^【|】$/g, '')
    uniqueNames.set(bare, uniqueNames.has(bare) && uniqueNames.get(bare) !== entry.value ? null : entry.value)
  }
  const names = [...uniqueNames.keys()].filter((name) => uniqueNames.get(name) !== null).sort((a, b) => b.length - a.length)
  const metadataPattern = names.length ? new RegExp(`(${names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![A-Za-z])`, 'g') : null
  const restoreMetadata = (value) => {
    const exact = restore(value)
    return metadataPattern ? exact.replace(metadataPattern, (alias) => uniqueNames.get(alias)) : exact
  }
  const mapDeep = (value, transform) => {
    if (typeof value === 'string') return transform(value)
    if (Array.isArray(value)) return value.map((item) => mapDeep(item, transform))
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapDeep(item, transform)]))
    return value
  }
  return {
    aliases: entries,
    maxTokenLength: Math.max(1, ...entries.map((entry) => entry.token.length)),
    mask,
    restore,
    maskDeep: (value) => mapDeep(value, mask),
    restoreDeep: (value) => mapDeep(value, restore),
    restoreMetadataDeep: (value) => mapDeep(value, restoreMetadata),
    maskDocuments: (documentsToMask = []) => documentsToMask.map((document, index) => ({
      ...document,
      fileName: `材料${index + 1}`,
      text: mask(document.text)
    }))
  }
}

export const LABOR_CONTRACT_REDACTION_NOTICE = '发送给模型前，系统会替换自动识别到的主体名称和直接身份标识；合同日期、工作地点、岗位、工资及条款等分析事实会保留。自动识别可能遗漏信息，请勿上传不应离开本机服务环境的材料。'
