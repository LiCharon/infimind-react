import assert from 'node:assert/strict'
import { buildRevisionGroups } from '../services/finding-consolidator.js'
import { mergeRevisions, coalesceAdjacentAdds } from '../services/revision-merger.js'
import { buildRewriteUserMessage } from '../prompts/agent-3-rewrite.js'

const loanClause = '借款人为购买房产，向出借人借款人民币捌仟元整，借期八个月，月利率1%，到期还本付息。到期未还，按LPR的4倍计付逾期利息。'
const contractText = `借款合同\n${loanClause}\n保证条款：保证人承担连带责任。`

const makeFinding = (overrides = {}) => ({
  id: 'finding-1',
  level: '中',
  title: '借期起算和到期日不明确',
  location: '借款条款',
  anchor: 'L2',
  originalText: loanClause,
  quoteText: '借期八个月',
  quoteSpans: [{ line: 1, start: 24, end: 30 }],
  quoteStatus: 'exact',
  clauseEnd: 1,
  risk: '借期起算点和到期日不明确。',
  advice: '明确借款实际交付日起算并填写到期日。',
  replacement: '',
  evidence: [],
  lineStart: 1,
  lineEnd: 1,
  ...overrides
})

const screenshotFindings = [
  makeFinding(),
  makeFinding({
    id: 'finding-2',
    title: '逾期利息可能重复计算',
    quoteText: '到期未还，按LPR的4倍计付逾期利息',
    risk: '未明确逾期利息与月利率的关系，可能重复计息。',
    advice: '明确逾期期间不再另行计付月利率。'
  }),
  makeFinding({
    id: 'finding-3',
    title: '正常利息支付方式不明确',
    quoteText: '月利率1%',
    risk: '未明确正常借期内利息的支付方式。',
    advice: '明确利息随本金于到期日一次性支付。'
  })
]

const groupedOutput = JSON.stringify({
  groups: [{ memberFindingIds: ['finding-1', 'finding-2', 'finding-3'], relation: 'related' }]
})

const screenshotResult = buildRevisionGroups({
  findings: screenshotFindings,
  agentOutput: groupedOutput,
  contractText
})
assert.equal(screenshotResult.groups.length, 1, '截图中的同条款三项问题应收敛为一个修订组')
assert.equal(screenshotResult.groups[0].issueCount, 3)
assert.deepEqual(screenshotResult.groups[0].memberFindingIds, ['finding-1', 'finding-2', 'finding-3'])
assert.equal(screenshotResult.groups[0].quoteStatus, 'none', '多问题组应展示并替换统一原文范围')
assert.match(screenshotResult.groups[0].risk, /①.*②.*③/)
assert.equal(screenshotResult.stats.fallbackUsed, false)

const duplicateOutput = JSON.stringify({
  groups: [{ memberFindingIds: ['finding-1', 'finding-2'], relation: 'duplicate' }]
})
const duplicateResult = buildRevisionGroups({
  findings: [
    screenshotFindings[0],
    makeFinding({ id: 'finding-2', title: '借款期限起止日期缺失', risk: '借期开始和结束日期不清楚。', advice: '填写明确的起算日与到期日。' })
  ],
  agentOutput: duplicateOutput,
  contractText
})
assert.equal(duplicateResult.groups.length, 1)
assert.equal(duplicateResult.groups[0].issueCount, 1, '重复表述应只计为一个有效问题')
assert.equal(duplicateResult.stats.uniqueIssues, 1)
assert.doesNotMatch(duplicateResult.groups[0].risk, /②/, '真正重复的问题不应在最终报告中编号罗列两次')

const incorrectlySplitOutput = JSON.stringify({
  groups: screenshotFindings.map((finding) => ({ memberFindingIds: [finding.id], relation: 'independent' }))
})
const splitFallback = buildRevisionGroups({ findings: screenshotFindings, agentOutput: incorrectlySplitOutput, contractText })
assert.equal(splitFallback.stats.fallbackUsed, true, '同一修改目标被 Agent 拆分时必须回退')
assert.equal(splitFallback.groups.length, 1, '确定性回退仍应保证同一原文范围只有一个组')

const missingIdOutput = JSON.stringify({
  groups: [{ memberFindingIds: ['finding-1', 'finding-2'], relation: 'related' }]
})
const missingIdFallback = buildRevisionGroups({ findings: screenshotFindings, agentOutput: missingIdOutput, contractText })
assert.equal(missingIdFallback.stats.fallbackUsed, true, '遗漏 findingId 的 Agent 输出不得采用')
assert.equal(missingIdFallback.groups[0].issueCount, 3)

const unrelatedFinding = makeFinding({
  id: 'finding-4',
  title: '保证期间不明确',
  location: '保证条款',
  anchor: 'L3',
  originalText: '保证条款：保证人承担连带责任。',
  quoteText: '保证人承担连带责任',
  clauseEnd: 2,
  lineStart: 2,
  lineEnd: 2,
  risk: '保证期间未约定。',
  advice: '明确保证期间。'
})
const unsafeOutput = JSON.stringify({
  groups: [{ memberFindingIds: ['finding-1', 'finding-4'], relation: 'related' }]
})
const unsafeFallback = buildRevisionGroups({ findings: [screenshotFindings[0], unrelatedFinding], agentOutput: unsafeOutput, contractText })
assert.equal(unsafeFallback.stats.fallbackUsed, true, '跨条款误合并必须被服务端拒绝')
assert.equal(unsafeFallback.groups.length, 2)

const revisionGroup = screenshotResult.groups[0]
const rewriteOutput = JSON.stringify({
  revisions: [{
    findingId: revisionGroup.id,
    action: 'modify',
    rewrittenText: '借期自借款实际交付之日起计算，至____年____月____日止；月利率为1%，利息随本金于到期日一次性支付；逾期期间仅按约定逾期利率计息。',
    riskNote: '①明确借期起算及到期日；②区分正常利息与逾期利息；③明确正常利息支付方式。',
    localizedEdits: [
      {
        memberFindingIds: ['finding-1'],
        operation: 'replace',
        targetQuote: '借期八个月，月利率1%',
        replacementText: '借期自借款实际交付之日起计算，至____年____月____日止，月利率1%',
        riskNote: '明确借期起算点及到期日。'
      },
      {
        memberFindingIds: ['finding-2'],
        operation: 'replace',
        targetQuote: '到期未还，按LPR的4倍计付逾期利息',
        replacementText: '到期未还，逾期期间仅按约定逾期利率计息，不再另行计付借期月利率',
        riskNote: '避免正常利息与逾期利息重复计算。'
      },
      {
        memberFindingIds: ['finding-3'],
        operation: 'insert-after',
        targetQuote: '月利率1%，到期还本付息',
        replacementText: '正常借期内的利息随本金于到期日一次性支付',
        riskNote: '明确正常利息支付方式。'
      }
    ]
  }]
})
const merged = mergeRevisions([revisionGroup], rewriteOutput, contractText)
assert.equal(merged.revisions.length, 1)
assert.equal(merged.revisions[0].issueCount, 3)
assert.deepEqual(merged.revisions[0].memberFindingIds, ['finding-1', 'finding-2', 'finding-3'])
assert.equal(merged.revisions[0].hasRewrite, true)
assert.equal(merged.revisions[0].localizedEdits.length, 3)
assert.ok(merged.revisions[0].localizedEdits.every((edit) => edit.localizationStatus === 'agent-verified'))
assert.deepEqual(merged.revisions[0].localizedEdits.flatMap((edit) => edit.memberFindingIds), ['finding-1', 'finding-3', 'finding-2'])
assert.ok(merged.revisions[0].localizedEdits.every((edit) => edit.quoteSpans.length > 0))

const invalidLocalization = mergeRevisions([revisionGroup], JSON.stringify({
  revisions: [{
    findingId: revisionGroup.id,
    action: 'modify',
    rewrittenText: '这是一段明显长于目标片段并代表完整条款的修订文本，用于验证服务端不会把完整条款错误地当作局部替换内容。',
    riskNote: '完整说明',
    localizedEdits: [{
      memberFindingIds: ['finding-1', 'finding-2', 'finding-3'],
      operation: 'replace',
      targetQuote: '借期八个月，月利率1%',
      replacementText: '这是一段明显长于目标片段并代表完整条款的修订文本，用于验证服务端不会把完整条款错误地当作局部替换内容。',
      riskNote: '错误的大段局部替换'
    }]
  }]
}), contractText)
assert.ok(invalidLocalization.revisions[0].localizedEdits.length > 0, '局部化协议异常时仍应保留可定位的 fallback 编辑')
assert.ok(invalidLocalization.revisions[0].localizedEdits.every((edit) => edit.localizationStatus === 'finding-fallback'))
assert.ok(invalidLocalization.revisions[0].localizedEdits.every((edit) => edit.replacementText !== invalidLocalization.revisions[0].rewrittenText))

const outOfRangeLocalization = mergeRevisions([revisionGroup], JSON.stringify({
  revisions: [{
    findingId: revisionGroup.id,
    action: 'modify',
    rewrittenText: '完整条款修订',
    localizedEdits: [{
      memberFindingIds: ['finding-1'],
      operation: 'replace',
      targetQuote: '保证人承担连带责任',
      replacementText: '保证责任另行约定'
    }]
  }]
}), contractText)
assert.ok(outOfRangeLocalization.revisions[0].localizedEdits.every((edit) => edit.localizationStatus === 'finding-fallback'), '局部编辑不得越过当前问题组的核验行范围')

const rewritePrompt = buildRewriteUserMessage({ contractText, analysisReport: '借款合同', findings: [revisionGroup] })
assert.match(rewritePrompt, /每组只生成一条 revision/)
assert.match(rewritePrompt, /memberFindingId：finding-1/)
assert.match(rewritePrompt, /memberFindingId：finding-3/)
assert.match(rewritePrompt, /localizedEdits/)

const combinedAdds = coalesceAdjacentAdds([
  { ...merged.revisions[0], findingId: 'revision-group-1', memberFindingIds: ['finding-1', 'finding-2'], issueCount: 2, action: 'add', insertAfterLine: 1, sequence: 1, rewrittenText: '新增一', riskNote: '说明一' },
  { ...merged.revisions[0], findingId: 'revision-group-2', memberFindingIds: ['finding-3'], issueCount: 1, action: 'add', insertAfterLine: 1, sequence: 2, rewrittenText: '新增二', riskNote: '说明二' }
])
assert.equal(combinedAdds.length, 1)
assert.equal(combinedAdds[0].issueCount, 3)
assert.deepEqual(combinedAdds[0].memberFindingIds, ['finding-1', 'finding-2', 'finding-3'])
assert.equal(combinedAdds[0].mergedCount, 3)

console.log('finding consolidation regression: all assertions passed')
