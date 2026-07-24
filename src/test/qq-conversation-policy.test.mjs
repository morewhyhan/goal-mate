import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildQqReminderControlToolInput,
  detectQqReminderControlIntent,
  inspectQqRenderedMessage,
  isLikelyQqSchedulerFeedback,
  renderQqModelFailure,
  renderQqSchedulerFeedback,
  selectQqReminderRulesForControl,
  shouldPauseAllQqProactiveRules,
} from '../lib/qq-message-renderer.mjs'
import {
  buildFirstGoalDraftInput,
  inferCheckinFeedbackIntent,
} from '../lib/agent-runtime-shared.mjs'
import { pauseQqProactiveContact } from '../lib/qq-contact-policy.mjs'

const recentEvent = {
  id: 'event-1',
  reminderRuleId: 'rule-evening',
  externalMessageId: 'qq-message-1',
  agentMessageId: 'agent-message-1',
  eventType: 'evening_review',
  status: 'sent',
}

test('explicit stop language becomes a reminder control turn', () => {
  assert.deepEqual(detectQqReminderControlIntent('先别提醒我了'), {
    action: 'pause',
    scope: 'nearest_or_all',
    reminderType: null,
    reason: 'user_requested_pause',
  })
  assert.equal(detectQqReminderControlIntent('放弃')?.action, 'pause')
  assert.equal(detectQqReminderControlIntent('恢复提醒')?.action, 'resume')
})

test('negated stop language never pauses reminders', () => {
  assert.equal(detectQqReminderControlIntent('不要停止提醒我'), null)
  assert.notEqual(detectQqReminderControlIntent('继续提醒，别停')?.action, 'pause')
})

test('an unspecified pause is global even when a recent reminder exists', () => {
  const intent = detectQqReminderControlIntent('暂停')
  assert.equal(shouldPauseAllQqProactiveRules(intent), true)
  assert.equal(shouldPauseAllQqProactiveRules(detectQqReminderControlIntent('暂停早上的提醒')), false)
})

test('a time-specific pause only selects matching QQ rules', () => {
  const rules = [
    { id: 'rule-morning', channel: 'qq', reminderType: 'morning_planning', enabled: true, metadata: {} },
    { id: 'rule-evening', channel: 'qq', reminderType: 'evening_review', enabled: true, metadata: {} },
    { id: 'web-rule', channel: 'web', reminderType: 'evening_review', enabled: true, metadata: {} },
  ]
  const intent = detectQqReminderControlIntent('暂停早上的提醒')
  const selected = selectQqReminderRulesForControl(rules, intent, recentEvent)
  assert.deepEqual(selected.map((rule) => rule.id), ['rule-morning'])
})

test('resume only restores rules previously paused by the QQ user', () => {
  const rules = [
    { id: 'user-paused', channel: 'qq', enabled: false, metadata: { pausedBy: 'qq_user' } },
    { id: 'admin-paused', channel: 'qq', enabled: false, metadata: { pausedBy: 'admin' } },
    { id: 'enabled', channel: 'qq', enabled: true, metadata: { pausedBy: 'qq_user' } },
  ]
  const selected = selectQqReminderRulesForControl(rules, detectQqReminderControlIntent('恢复提醒'))
  assert.deepEqual(selected.map((rule) => rule.id), ['user-paused'])
})

test('resume requests autonomous contact through one confirmation-gated tool input', () => {
  const intent = detectQqReminderControlIntent('恢复提醒')
  assert.deepEqual(buildQqReminderControlToolInput(intent), {
    mode: 'autonomous',
    enabled: true,
    cadence: 'balanced',
    source: 'qq_conversation',
  })
})

test('global pause disables every QQ rule and revokes proactive-contact consent', async () => {
  const ruleUpdates = []
  let notificationUpdate = null
  const prisma = {
    reminderRule: {
      findMany: async () => [
        { id: 'morning', metadata: { contactConsent: { granted: true } } },
        { id: 'evening', metadata: {} },
      ],
      update: async (input) => {
        ruleUpdates.push(input)
        return input
      },
    },
    userSetting: {
      findUnique: async () => ({ notifications: { proactive_contact_enabled: true, quiet_hours: '23:00-07:30' } }),
      update: async (input) => {
        notificationUpdate = input
        return input
      },
    },
  }
  const result = await pauseQqProactiveContact(prisma, 'user-1', {
    reasonCode: 'user_requested_pause',
    now: new Date('2026-07-24T10:00:00.000Z'),
  })
  assert.deepEqual(result.disabledRuleIds, ['morning', 'evening'])
  assert.equal(ruleUpdates.every((item) => item.data.enabled === false), true)
  assert.equal(notificationUpdate.data.notifications.proactive_contact_enabled, false)
})

test('an 18-hour-old scheduler window does not swallow ordinary conversation', () => {
  assert.equal(
    isLikelyQqSchedulerFeedback('我想重新做一个三个月的学习目标', recentEvent, {}),
    false,
  )
  assert.equal(
    isLikelyQqSchedulerFeedback('你为什么建议我做这一步？', recentEvent, {}),
    false,
  )
})

test('explicit status or direct message reference can correlate scheduler feedback', () => {
  assert.equal(isLikelyQqSchedulerFeedback('没做，今天太难了', recentEvent, {}), true)
  assert.equal(
    isLikelyQqSchedulerFeedback('这一步不是关键，我想换一下', recentEvent, { referenceMessageId: 'qq-message-1' }),
    true,
  )
})

test('scheduler renderer uses human language with no internal labels and at most one question', () => {
  const reply = renderQqSchedulerFeedback({ result: 'NOT_DONE', reasonCategory: 'MOTIVATION' })
  const inspection = inspectQqRenderedMessage(reply)
  assert.equal(inspection.exposesInternalReasonLabel, false)
  assert.ok(inspection.questionCount <= 1)
})

test('provider failure rendering never exposes raw provider payloads', () => {
  const reply = renderQqModelFailure('provider_error')
  assert.equal(reply.includes('sk-secret'), false)
  assert.equal(reply.includes('模型调用失败：'), false)
  assert.match(reply, /消息已经保存/u)
})

test('a sufficiently concrete natural goal becomes a complete draft scaffold', () => {
  const input = buildFirstGoalDraftInput('我想在30天内把产品上线，现在只有一个原型，至少找3个用户连续使用7天')
  assert.equal(input?.rawInput.includes('产品上线'), true)
  assert.ok(input?.keyResults?.length >= 2)
  assert.ok(input?.necessaryConditions?.length >= 2)
  assert.ok(input?.stagePlans?.length >= 2)
  assert.ok(input?.dailyAction?.minimumStep)
})

test('plain resistance such as not wanting to do the task is treated as feedback', () => {
  const intent = inferCheckinFeedbackIntent('我今天真的不想做这个任务')
  assert.equal(intent?.toolName, 'checkin.submit')
  assert.equal(intent?.input?.result, 'not_done')
  assert.equal(inferCheckinFeedbackIntent('如果今天不想做，我应该怎么办？'), null)
})
