/**
 * Synthetic LC-00–LC-09 inputs for labor-contract-analysis.
 *
 * These are review drafts, not gold labels or legal conclusions. The cited
 * official statutes are candidate references only; applicability and every
 * expected result still require Mentor/legal review.
 */

export const LABOR_CONTRACT_ANALYSIS_CASESET = {
  id: 'labor-contract-analysis-lc-00-lc-09',
  version: 1,
  source: 'synthetic',
  labelStatus: 'draft-pending-mentor-and-legal-review',
  goldStandard: false,
  evaluated: false,
  pendingConfirmations: [
    '劳务派遣合同/协议是否纳入首版',
    '具体知识资料来源及地区、生效时间覆盖范围',
    '风险等级的正式定义和法律结论金标准'
  ],
  authorities: {
    laborContractLaw: {
      title: '中华人民共和国劳动合同法',
      url: 'https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/bgt/art/2023/art_0abfdd261c03417b949df19d869add8d.html',
      status: 'official-text-referenced; applicability-and-conclusions-pending-review'
    },
    socialInsuranceLaw: {
      title: '中华人民共和国社会保险法',
      url: 'https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/bgt/art/2023/art_e81d115419b4463ebb59ec46467fb136.html',
      status: 'official-text-referenced; applicability-and-conclusions-pending-review'
    }
  }
}

const BASE_CONTRACT = `劳动合同（虚构测试样本）

甲方：海棠数字服务有限公司（虚构主体）
住所：上海市静安区示例路 1 号（虚构地址）
法定代表人：示例负责人

乙方：示例员工（虚构主体）
证件号码：未提供

第一条 合同期限
本合同为固定期限劳动合同，自 2026 年 10 月 1 日起至 2028 年 9 月 30 日止。试用期为 2 个月，自用工之日起计算。

第二条 工作内容与工作地点
乙方岗位为运营专员，主要从事平台运营支持工作。工作地点：上海市。工作内容或地点需要调整时，双方先行协商；协商一致的，按约定办理。

第三条 工作时间与休息休假
乙方实行标准工作时间，工作安排为每周 5 天、每日 8 小时。休息休假按适用规定及双方依法确认的安排执行。

第四条 劳动报酬
乙方月工资为人民币 8000 元（税前），每月 10 日支付上一个自然月工资。依法应由乙方承担的个人所得税及社会保险个人缴费部分，按规定处理。

第五条 社会保险
甲乙双方依法参加社会保险并按适用规定缴纳社会保险费；甲方按规定办理相关手续，乙方个人应承担部分依法代扣代缴。

第六条 劳动保护与劳动条件
甲方提供完成岗位工作所需的基本劳动条件，并按适用规定落实劳动保护要求。乙方遵守与岗位相关的安全操作要求。

第七条 合同变更与解除
变更本合同约定内容时，双方协商一致并以书面形式确认。合同解除、终止及相关手续按适用规定办理。

第八条 保密
乙方对履职中接触且依法或依约应保密的甲方商业信息承担保密义务；保密信息范围、期限及例外应结合实际信息另行明确。

第九条 竞业限制
本合同不对乙方当然设定离职后竞业限制。确需约定时，双方另行协商适用人员、范围、地域、期限及补偿，并以书面约定为准。

第十条 其他
本合同未尽事项由双方依法协商处理。本合同文本由双方各执一份。

甲方（盖章）：________________
乙方（签字）：________________
签订日期：________________`;

const cases = [
  {
    id: 'LC-00',
    title: '正常对照',
    inputType: 'contract-text',
    mutations: [],
    expectedChecks: [
      { id: 'key-terms', type: 'coverage', topics: ['合同期限', '试用期', '岗位地点', '薪酬', '工时', '社保', '解除', '保密', '竞业'], provisional: true },
      { id: 'no-false-trial-risk', type: 'must-not-claim', statement: '试用期超出法定上限；先确认文本内容及适用前提', provisional: true },
      { id: 'no-false-social-insurance-risk', type: 'must-not-claim', statement: '合同约定员工放弃参保或以补贴替代缴费', provisional: true },
      { id: 'traceable-locations', type: 'source-location', statement: '展示条款风险时可回到上传文本；不得编造位置', provisional: true }
    ]
  },
  {
    id: 'LC-01',
    title: '工作地点和报酬缺失',
    inputType: 'contract-text',
    mutations: [
      { type: 'remove', text: '工作地点：上海市。' },
      { type: 'remove', text: '乙方月工资为人民币 8000 元（税前），每月 10 日支付上一个自然月工资。' }
    ],
    expectedChecks: [
      { id: 'missing-workplace', type: 'missing-or-unclear', topic: '岗位地点', location: '全文未找到或标注相邻条款；不得推定地点', provisional: true },
      { id: 'missing-remuneration', type: 'missing-or-unclear', topic: '劳动报酬', location: '全文未找到或标注相邻条款；不得推定工资数额', provisional: true },
      { id: 'candidate-law', type: 'law-reference', references: [{ authority: 'laborContractLaw', articles: ['第十七条', '第十八条'] }], provisional: true }
    ]
  },
  {
    id: 'LC-02',
    title: '试用期与合同期限',
    inputType: 'contract-text',
    mutations: [
      { type: 'replace', from: '试用期为 2 个月', to: '试用期为 3 个月' }
    ],
    expectedChecks: [
      { id: 'probation-mismatch', type: 'risk', topic: '试用期', requiredQuote: '试用期为 3 个月', context: '合同期限仍为两年；说明需核对的上限和适用前提，并给出可操作调整建议', provisional: true },
      { id: 'candidate-law', type: 'law-reference', references: [{ authority: 'laborContractLaw', articles: ['第十九条'] }], provisional: true }
    ]
  },
  {
    id: 'LC-03',
    title: '单方调整地点和工资',
    inputType: 'contract-text',
    mutations: [
      { type: 'insert-after', anchor: '工作地点：上海市。', text: '甲方可随时调整工作地点并降低工资，乙方必须服从。' }
    ],
    expectedChecks: [
      { id: 'unilateral-change', type: 'risk', topic: '岗位地点与劳动报酬变更', requiredQuote: '甲方可随时调整工作地点并降低工资，乙方必须服从。', context: '说明协商及书面变更问题；不得断言所有调岗均违法', provisional: true },
      { id: 'candidate-law', type: 'law-reference', references: [{ authority: 'laborContractLaw', articles: ['第三十五条'] }], provisional: true }
    ]
  },
  {
    id: 'LC-04',
    title: '员工放弃参保并以补贴替代',
    inputType: 'contract-text',
    mutations: [
      { type: 'replace', from: '甲乙双方依法参加社会保险并按适用规定缴纳社会保险费；甲方按规定办理相关手续，乙方个人应承担部分依法代扣代缴。', to: '乙方自愿放弃参保，甲方以补贴替代缴费。' }
    ],
    expectedChecks: [
      { id: 'waiver-risk', type: 'risk', topic: '社会保险', requiredQuote: '乙方自愿放弃参保，甲方以补贴替代缴费。', context: '指出放弃参保及补贴替代的风险；不得将员工签字视为当然免责', provisional: true },
      { id: 'candidate-law', type: 'law-reference', references: [
        { authority: 'laborContractLaw', articles: ['第十七条', '第三十八条'] },
        { authority: 'socialInsuranceLaw', articles: ['第五十八条'] }
      ], provisional: true }
    ]
  },
  {
    id: 'LC-05',
    title: '竞业限制对象、期限和补偿',
    inputType: 'contract-text',
    mutations: [
      { type: 'replace', from: '本合同不对乙方当然设定离职后竞业限制。确需约定时，双方另行协商适用人员、范围、地域、期限及补偿，并以书面约定为准。', to: '所有员工离职后 3 年不得从事同行业工作，不支付补偿。' }
    ],
    expectedChecks: [
      { id: 'competition-scope', type: 'risk', topic: '竞业限制', requiredQuote: '所有员工离职后 3 年不得从事同行业工作，不支付补偿。', context: '区分保密与竞业限制，提示适用人员、期限和补偿问题', provisional: true },
      { id: 'candidate-law', type: 'law-reference', references: [{ authority: 'laborContractLaw', articles: ['第二十三条', '第二十四条'] }], provisional: true }
    ]
  },
  {
    id: 'LC-06',
    title: '两处工资约定冲突',
    inputType: 'contract-text',
    mutations: [
      { type: 'replace', from: '乙方月工资为人民币 8000 元（税前），每月 10 日支付上一个自然月工资。', to: '乙方固定月工资为人民币 8000 元（税前）。甲方可不经协商将乙方月工资降至人民币 5000 元（税前）。' }
    ],
    expectedChecks: [
      { id: 'show-both-pay-terms', type: 'multi-source-conflict', topic: '劳动报酬', requiredQuotes: ['乙方固定月工资为人民币 8000 元（税前）。', '甲方可不经协商将乙方月工资降至人民币 5000 元（税前）。'], context: '同时定位两处约定，指出冲突与单方降薪风险；不自行选择哪个数字生效', provisional: true },
      { id: 'candidate-law', type: 'law-reference', references: [{ authority: 'laborContractLaw', articles: ['第三十五条'] }], provisional: true }
    ]
  },
  {
    id: 'LC-07',
    title: '最低工资判断缺少地区和参照日期',
    inputType: 'contract-text',
    mutations: [
      { type: 'remove', text: '工作地点：上海市。' }
    ],
    analysisContext: { region: null, effectiveDate: null },
    userFocus: '请判断合同约定的工资是否符合当地最低工资标准。',
    expectedChecks: [
      { id: 'ask-for-region-and-date', type: 'missing-applicability-context', requiredContext: ['适用地区', '适用/核验日期'], context: '明确缺少地区和参照日期；先追问或给出标明前提的条件化说明，不得套用默认地区或日期', provisional: true },
      { id: 'no-invented-local-rule', type: 'must-not-conclude', statement: '不得在地区或适用日期未确认时直接判断达到或低于当地最低工资标准', provisional: true }
    ]
  },
  {
    id: 'LC-08',
    title: '空白或损坏文件解析失败',
    inputType: 'parse-failure-files',
    attachments: [
      { scenario: 'empty-text-file', originalName: '空白劳动合同.txt', mimeType: 'text/plain', contentBase64: '' },
      { scenario: 'corrupt-pdf', originalName: '损坏劳动合同.pdf', mimeType: 'application/pdf', contentBase64: 'bm90IGEgcGRm' }
    ],
    expectedChecks: [
      { id: 'no-analysis-without-text', type: 'parse-failure', context: '说明无法分析及解析失败原因，不生成风险卡片；任务可查询且保留失败状态', provisional: true }
    ]
  },
  {
    id: 'LC-09',
    title: '劳动合同知识来源隔离',
    inputType: 'contract-text',
    mutations: [],
    retrievalIsolation: {
      allowedContractTypes: ['劳动合同'],
      excludedContractTypes: ['买卖合同', '服务合同', '通用商业合同'],
      syntheticDecoy: { contractType: '买卖合同', category: '违约责任', sourceName: '虚构商业合同违约条款（检索隔离诱饵）' }
    },
    expectedChecks: [
      { id: 'only-labor-contract-evidence', type: 'retrieval-isolation', requiredAllowedTypes: ['劳动合同'], forbiddenTypes: ['买卖合同', '服务合同', '通用商业合同'], context: '商业合同材料不得作为劳动法依据或进入劳动合同分析的有效证据列表', provisional: true },
      { id: 'mark-unverified-support', type: 'source-status', context: '法规或原文未核实、知识不足时明确标待人工复核，不以范本、风险规则或实务问答替代法律依据', provisional: true }
    ]
  }
]

const countOccurrences = (text, needle) => text.split(needle).length - 1

function applyMutation(text, mutation, caseId) {
  if (mutation.type === 'append') return `${text}\n${mutation.text}`
  if (mutation.type === 'insert-after') {
    const count = countOccurrences(text, mutation.anchor)
    if (count !== 1) throw new Error(`${caseId}: expected one insertion anchor, got ${count}: ${mutation.anchor}`)
    return text.replace(mutation.anchor, `${mutation.anchor}${mutation.text}`)
  }
  if (mutation.type === 'remove' || mutation.type === 'replace') {
    const count = countOccurrences(text, mutation.type === 'remove' ? mutation.text : mutation.from)
    if (count !== 1) throw new Error(`${caseId}: expected one mutation target, got ${count}`)
    return mutation.type === 'remove'
      ? text.replace(mutation.text, '')
      : text.replace(mutation.from, mutation.to)
  }
  throw new Error(`${caseId}: unsupported fixture mutation ${mutation.type}`)
}

export function materializeLaborContractCase(caseId) {
  const definition = cases.find((item) => item.id === caseId)
  if (!definition) throw new Error(`Unknown labor-contract-analysis fixture: ${caseId}`)
  const result = structuredClone(definition)
  if (result.inputType === 'contract-text') {
    result.contractText = result.mutations.reduce((text, mutation) => applyMutation(text, mutation, result.id), BASE_CONTRACT)
  }
  return {
    caseSet: LABOR_CONTRACT_ANALYSIS_CASESET,
    ...result
  }
}

export function listLaborContractAnalysisCases() {
  return cases.map(({ id, title }) => ({ id, title }))
}

export function materializeAllLaborContractCases() {
  return cases.map(({ id }) => materializeLaborContractCase(id))
}
