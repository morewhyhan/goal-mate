import assert from 'node:assert/strict'
import test from 'node:test'
import { formatAgentToolReply } from './agent-tool-shared.mjs'

test('confirmation copy uses a human action name instead of an internal tool id', () => {
  const reply = formatAgentToolReply('reminder.schedule', {
    needsConfirmation: true,
    action: { status: 'pending_confirmation' },
  })

  assert.match(reply, /调整主动联系/)
  assert.doesNotMatch(reply, /reminder\.schedule/)
})

test('check-in copy hides diagnostic labels and only claims a persisted next commitment', () => {
  const reply = formatAgentToolReply('checkin.submit', {
    action: { status: 'executed' },
    result: {
      diagnosis: {
        category: 'ABILITY',
        nextQuestion: '这一步是太大，还是现在精力不够？',
      },
      nextCommitment: {
        id: 'action-next',
        persisted: true,
        title: '先完成两分钟启动',
        minimumStep: '打开材料并写一句',
      },
      logEntry: { id: 'log-1' },
    },
  })

  assert.match(reply, /下一步已经调整为/)
  assert.match(reply, /先完成两分钟启动/)
  assert.doesNotMatch(reply, /ABILITY|checkin\.submit|log-1/)
})

test('check-in copy does not describe a diagnosis proposal as an applied change', () => {
  const reply = formatAgentToolReply('checkin.submit', {
    action: { status: 'executed' },
    result: {
      diagnosis: {
        category: 'PROMPT',
        proposedNextAction: '把提醒改到晚上。',
        nextQuestion: '晚上几点更合适？',
      },
    },
  })

  assert.doesNotMatch(reply, /已经调整为|把提醒改到晚上/)
  assert.match(reply, /晚上几点更合适/)
})
