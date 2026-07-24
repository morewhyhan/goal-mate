import assert from 'node:assert/strict'
import test from 'node:test'
import { renderQqToolExecution } from './qq-message-renderer.mjs'

test('QQ only says next action was written when a persisted commitment is present', () => {
  const written = renderQqToolExecution('checkin.submit', {
    result: {
      nextCommitment: {
        id: 'next-action',
        persisted: true,
        title: '先做两分钟版本',
        minimumStep: '打开文档写一句',
      },
    },
  })
  assert.match(written, /下一步已经写入/)
  assert.match(written, /先做两分钟版本/)

  const proposalOnly = renderQqToolExecution('checkin.submit', {
    result: {
      diagnosis: {
        proposedNextAction: '把提醒改到晚上。',
        nextQuestion: '晚上几点更合适？',
      },
    },
  })
  assert.doesNotMatch(proposalOnly, /已经写入|把提醒改到晚上/)
  assert.match(proposalOnly, /晚上几点更合适/)
})
