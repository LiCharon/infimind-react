import { inferRiskCategory } from './knowledge-processor.js'

const UNIVERSAL_TOPICS = [
  ['合同效力与权利救济', ['法律适用', '合同效力', '永久有效', '口头约定', '单方解释', '起诉', '仲裁']],
  ['主体、授权与通知', ['主体', '授权', '统一社会信用代码', '通知', '送达', '账户变更']],
  ['标的、范围与附件', ['标的', '范围', '规格', '数量', '样品', '附件', '订单']],
  ['价税、付款与发票', ['价款', '付款', '税费', '发票', '收款账户', '结算']],
  ['履行、交付与验收', ['履行', '交付', '交货', '签收', '验收', '隐蔽瑕疵']],
  ['质量、风险与权利', ['质量', '质保', '风险转移', '所有权', '保险', '赔偿']],
  ['变更、解除与违约', ['变更', '解除', '违约', '违约金', '不可抗力', '争议解决']]
]

const TYPE_TOPICS = {
  劳动合同: [['劳动用工专项', ['劳动合同期限', '试用期', '工作内容', '工作地点', '工时', '休息休假', '劳动报酬', '社会保险', '劳动保护', '解除终止']]],
  买卖合同: [['买卖专项', ['质量标准', '交货', '验收异议', '质保', '退换货', '所有权']]],
  租赁合同: [['租赁专项', ['权属', '交付', '起租', '维修', '押金', '返还']]],
  融资租赁合同: [['融资租赁专项', ['租赁物', '购买价款', '权属', '保险', '回收', '结算']]],
  借款合同: [['借款专项', ['实际到账', '利率', '费用', '提前还款', '逾期', '担保']]],
  保证合同: [['保证专项', ['主合同', '保证方式', '保证范围', '保证期间', '变更']]],
  承揽合同: [['承揽专项', ['图纸', '样品', '变更', '交付', '验收', '缺陷']]],
  委托合同: [['委托专项', ['需求', '成果', '阶段交付', '验收', '知识产权', '数据']]],
  建设工程合同: [['工程专项', ['资质', '图纸', '工程量清单', '签证', '工期', '结算', '竣工']]],
  运输合同: [['运输专项', ['货物清单', '包装', '提送货', '运单', '温控', '货损', '索赔']]],
  保管合同: [['保管专项', ['保管物', '价值', '场所', '查验', '损毁', '提取']]],
  仓储合同: [['仓储专项', ['仓单', '入库', '出库', '仓储条件', '货损', '费用']]],
  中介合同: [['中介专项', ['服务范围', '收费触发', '居间成果', '绕开交易', '保密']]],
  物业服务合同: [['物业专项', ['服务标准', '物业费', '公共收益', '维修', '交接']]],
  知识产权合同: [['知识产权专项', ['权属', '专利状态', '许可范围', '登记', '侵权', '保密']]],
  赠与合同: [['赠与专项', ['财产权属', '交付', '条件', '撤销', '税费']]]
}

const KNOWN_TYPES = Object.keys(TYPE_TOPICS).sort((a, b) => b.length - a.length)

export function buildReviewPlan({ analysisReport = '', contractText = '', userInstruction = '' } = {}) {
  const source = `${analysisReport}\n${contractText}\n${userInstruction}`
  const contractType = KNOWN_TYPES.find((type) => source.includes(type)) || inferContractType(source)
  const explicitFocus = hasSpecificFocus(userInstruction) ? userInstruction.trim() : ''
  const focusText = explicitFocus || contractText.slice(0, 6000)
  const contractSignals = contractText.slice(0, 12000)
  const focusedCategory = inferRiskCategory(focusText)
  const topicDefinitions = [...UNIVERSAL_TOPICS, ...(TYPE_TOPICS[contractType] || [])]
  const topics = topicDefinitions
    .filter(([label, terms]) => !explicitFocus || label.includes(focusedCategory.split('、')[0]) || terms.some((term) => focusText.includes(term)) || terms.some((term) => contractSignals.includes(term)) || label === '变更、解除与违约')
    .slice(0, 8)
    .map(([label, terms], index) => ({
      id: `topic-${index + 1}`,
      label,
      terms,
      query: [contractType, ...terms, ...extractUsefulTerms(explicitFocus)].filter(Boolean).join(' OR '),
      priority: explicitFocus && label.includes(focusedCategory.split('、')[0]) ? 'high' : 'normal'
    }))

  return {
    contractType,
    userFocus: userInstruction.trim(),
    topics: topics.length ? topics : [{
      id: 'topic-1', label: '通用合同审查', terms: ['合同主体', '付款', '交付', '验收', '违约'],
      query: [contractType, '合同主体', '付款', '交付', '验收', '违约'].filter(Boolean).join(' OR '), priority: 'normal'
    }]
  }
}

function hasSpecificFocus(instruction) {
  const text = String(instruction || '').trim()
  if (!text) return false
  return !/^(?:请|帮我)?(?:识别|审查|审核|检查)(?:合同|合同中|合同里的)?(?:需要)?(?:修改)?(?:的)?(?:风险|风险条款|条款)?[。！？!？]*$/u.test(text)
}

function inferContractType(text) {
  const entries = [
    ['劳动合同', /劳动合同|劳动关系|劳务派遣|派遣员工/],
    ['融资租赁合同', /融资租赁|售后回租/], ['建设工程合同', /建设工程|施工|工程承包/],
    ['知识产权合同', /专利|知识产权|许可使用|技术转让/], ['物业服务合同', /物业服务|物业管理/],
    ['仓储合同', /仓储/], ['保管合同', /保管/], ['运输合同', /运输|冷链|物流|货运/],
    ['承揽合同', /承揽|定作|加工/], ['保证合同', /保证|担保/], ['借款合同', /借款|贷款/],
    ['委托合同', /委托|软件开发/], ['中介合同', /中介|居间|推广服务/], ['赠与合同', /赠与/],
    ['租赁合同', /租赁|出租|承租/], ['买卖合同', /买卖|采购|销售|购销/]
  ]
  return entries.find(([, pattern]) => pattern.test(text))?.[0] || '通用商业合同'
}

function extractUsefulTerms(text) {
  return [...new Set(String(text || '').match(/[\u4e00-\u9fa5]{2,8}/g) || [])]
    .filter((term) => !/^(请|帮我|合同|审查|重点|风险|条款)$/.test(term))
    .slice(0, 6)
}
