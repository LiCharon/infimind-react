import assert from 'node:assert/strict'
import { reduceLaborProgress } from '../../src/utils/labor-progress.js'
import { LABOR_CONTRACT_REVIEW_SYSTEM_PROMPT } from '../prompts/labor-contract-analysis.js'

const events = [
  ['review.round', { phase: 'start', round: 1 }],
  ['review.delta', { content: '第一轮风险' }],
  ['review.round', { phase: 'end', round: 1, newCount: 2, newFindings: [{ title: '风险一' }] }],
  ['review.round', { phase: 'start', round: 2 }],
  ['review.round', { phase: 'end', round: 2, newCount: 1, newFindings: [{ title: '风险二' }] }],
  ['review.round', { phase: 'start', round: 3 }],
  ['review.delta', { content: '第三轮累计风险' }],
  ['rewrite.result', { revisions: [{ findingId: 'one' }], stats: { groups: 1 } }]
]
const restore = () => events.reduce((report, [event, data]) => reduceLaborProgress(report, event, data), {})
const snapshot = restore()
assert.equal(snapshot.activeReviewRound, 3)
assert.equal(snapshot.reviewReport, '第三轮累计风险')
assert.deepEqual(snapshot.reviewRounds.map((round) => round.round), [1, 2])
assert.deepEqual(restore(), snapshot, '刷新重建快照不追加历史内容')
assert.equal(reduceLaborProgress(snapshot, 'review.round', { phase: 'end', round: 2, newCount: 3 }).reviewRounds.length, 2)
const info = reduceLaborProgress(snapshot, 'analysis.section', { section: 'contractInfo', item: { term: '待确认' } })
assert.equal(info.contractInfo.term, '待确认')
assert.equal(snapshot.contractInfo, undefined, '不修改旧快照')
assert.equal(reduceLaborProgress(snapshot, 'model.progress', { message: '连接心跳' }), snapshot, '连接心跳不重绘风险全文')
assert.equal(reduceLaborProgress(snapshot, 'rewrite.result', { revisions: [{ findingId: 'one' }, { findingId: 'two' }] }).revisions.length, 2)
assert.match(LABOR_CONTRACT_REVIEW_SYSTEM_PROMPT, /没有单独写明不等于违法/)
assert.match(LABOR_CONTRACT_REVIEW_SYSTEM_PROMPT, /限定条件和例外/)
assert.match(LABOR_CONTRACT_REVIEW_SYSTEM_PROMPT, /工资、经济补偿、赔偿/)
console.log('劳动合同历史快照、重复轮次及质量提示约束回归通过')
