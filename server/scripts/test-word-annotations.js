import assert from 'node:assert/strict'
import { readFile } from 'fs/promises'
import { basename, extname, join } from 'path'
import { extractText, extractWordAnnotations, stripNativeCommentText } from '../services/file-parser.js'
import { splitIntoClauses, extractWordAnnotationRiskRules } from '../services/knowledge-processor.js'

const sourceDir = join('法飞飞商务合同第一版20260705', '16、（法务审核）劳动合同')
const cases = [
  { name: '0722派遣劳动合同-快聘（修改后）.docx', comments: 2, insertions: 0, deletions: 0 },
  { name: '劳动合同-20260707.doc', comments: 2, insertions: 343, deletions: 164 },
  { name: '劳动合同书0618更新（增加病假旅游条款）.docx', comments: 11, insertions: 158, deletions: 2 }
]

let totalComments = 0
for (const expected of cases) {
  const extension = extname(expected.name).toLowerCase()
  const buffer = await readFile(join(sourceDir, expected.name))
  const file = {
    buffer,
    originalname: basename(expected.name),
    mimetype: extension === '.docx'
      ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      : 'application/msword'
  }
  const [body, annotations] = await Promise.all([extractText(file), extractWordAnnotations(file)])
  assert.equal(annotations.comments.length, expected.comments, `${expected.name} 批注数量应一致`)
  assert.deepEqual(annotations.revisions, { insertions: expected.insertions, deletions: expected.deletions }, `${expected.name} 修订统计应一致`)
  assert.ok(annotations.comments.every((item) => item.anchor), `${expected.name} 每条批注都应关联到原文条款`)

  const text = extension === '.doc' ? stripNativeCommentText(body.text, annotations.comments) : body.text
  if (extension === '.doc') {
    assert.ok(annotations.comments.every((item) => !text.includes(item.text)), '旧 .doc 批注不得混入模板正文')
  }
  const rules = extractWordAnnotationRiskRules(annotations.comments, splitIntoClauses(text), annotations.revisions)
  assert.equal(rules.length, expected.comments)
  assert.ok(rules.every((rule) => rule.sourceNote.startsWith('【Word 原生批注】')))
  totalComments += annotations.comments.length
}

assert.equal(totalComments, 15)
console.log(`[test-word-annotations] Passed: ${totalComments} comments extracted as independent risk evidence`)
