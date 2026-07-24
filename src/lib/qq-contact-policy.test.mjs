import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildQqMessageBody,
  evaluateQqContactPolicy,
  evaluateQqInterventionValue,
  qqCadenceAllowsReminder,
  QQ_CHANNEL_MODE,
  QQ_CONTACT_ACTION,
} from './qq-contact-policy.mjs'

const now = new Date('2026-07-24T06:00:00.000Z')

function input(overrides = {}) {
  return {
    now,
    rule: {
      reminderType: 'midday_check',
      enabled: true,
      maxPerDay: 2,
      metadata: {
        activeContactConsent: true,
        contactConsent: { granted: true, source: 'settings_ui' },
      },
    },
    binding: { contextType: 'c2c', contextId: 'openid-1' },
    authorizedContextId: 'openid-1',
    authorizedContextType: 'c2c',
    goal: { id: 'goal-1', status: 'ACTIVE', isCurrentFocus: true },
    currentAction: {
      id: 'action-1',
      goalId: 'goal-1',
      status: 'PLANNED',
      actionDate: now,
    },
    actionWindowState: 'today',
    completedActionGoalId: '',
    openGapCount: 1,
    recentActivityCount: 1,
    cadence: 'supportive',
    localWeekday: 'FRI',
    activeContactConsent: true,
    latestInboundAt: new Date(now.getTime() - 30 * 60 * 1000),
    sourceMessageId: 'source-1',
    c2cWakeupEligible: true,
    ...overrides,
  }
}

test('binding or an enabled rule never substitutes for explicit proactive-contact consent', () => {
  const globalMissing = evaluateQqContactPolicy(input({ activeContactConsent: false }))
  assert.equal(globalMissing.action, QQ_CONTACT_ACTION.SKIP)
  assert.equal(globalMissing.reasonCode, 'missing_consent')

  const metadataMissing = evaluateQqContactPolicy(input({
    rule: { reminderType: 'midday_check', enabled: true, metadata: { recommended: true } },
  }))
  assert.equal(metadataMissing.action, QQ_CONTACT_ACTION.SKIP)
  assert.equal(metadataMissing.reasonCode, 'missing_consent')
})

test('quiet hours defer and a completed today action suppresses the same-day prompt', () => {
  const quiet = evaluateQqContactPolicy(input({
    inQuietHours: true,
    quietHoursEndAt: '2026-07-24T23:30:00.000Z',
  }))
  assert.equal(quiet.action, QQ_CONTACT_ACTION.DEFER)
  assert.equal(quiet.reasonCode, 'quiet_hours')
  assert.equal(quiet.nextEligibleAt, '2026-07-24T23:30:00.000Z')

  const done = evaluateQqContactPolicy(input({
    todayActionCompleted: true,
    completedActionGoalId: 'goal-1',
  }))
  assert.equal(done.action, QQ_CONTACT_ACTION.SKIP)
  assert.equal(done.reasonCode, 'already_done')
})

test('inactive goals are suppressed before a message can be sent', () => {
  for (const status of ['DRAFT', 'CLARIFYING', 'CONFIRMED', 'PAUSED', 'COMPLETED', 'ABANDONED', 'ARCHIVED']) {
    const result = evaluateQqInterventionValue(input({
      goal: { id: 'goal-1', status, isCurrentFocus: true },
    }))
    assert.equal(result.action, QQ_CONTACT_ACTION.SKIP)
    assert.equal(result.reasonCode, 'goal_inactive')
  }
})

test('completion suppresses only the current target goal', () => {
  const otherGoalDone = evaluateQqContactPolicy(input({
    todayActionCompleted: true,
    completedActionGoalId: 'goal-2',
  }))
  assert.equal(otherGoalDone.action, QQ_CONTACT_ACTION.SEND)

  const currentGoalDone = evaluateQqContactPolicy(input({
    todayActionCompleted: true,
    completedActionGoalId: 'goal-1',
  }))
  assert.equal(currentGoalDone.action, QQ_CONTACT_ACTION.SKIP)
  assert.equal(currentGoalDone.reasonCode, 'already_done')
})

test('a due clock window still skips when there is no relevant current action', () => {
  const result = evaluateQqContactPolicy(input({
    currentAction: null,
  }))
  assert.equal(result.action, QQ_CONTACT_ACTION.SKIP)
  assert.equal(result.reasonCode, 'no_current_action')
  assert.equal(result.evidence.valueGate.reasonCode, 'no_current_action')
})

test('midday contact is valuable only for start risk or recovery', () => {
  const planned = evaluateQqInterventionValue(input())
  assert.equal(planned.action, QQ_CONTACT_ACTION.SEND)
  assert.equal(planned.reasonCode, 'action_start_risk')

  const partial = evaluateQqInterventionValue(input({
    currentAction: { id: 'action-1', goalId: 'goal-1', status: 'PARTIAL', actionDate: now },
  }))
  assert.equal(partial.reasonCode, 'recovery_window')

  const done = evaluateQqInterventionValue(input({
    currentAction: { id: 'action-1', goalId: 'goal-1', status: 'DONE', actionDate: now },
  }))
  assert.equal(done.action, QQ_CONTACT_ACTION.SKIP)
  assert.equal(done.reasonCode, 'no_intervention_value')
})

test('a fresh PROMPT RESCHEDULE diagnosis changes the value reason without increasing frequency', () => {
  const result = evaluateQqContactPolicy(input({
    promptSignalActive: true,
    promptSignalCategory: 'PROMPT',
    promptSignalAdjustmentType: 'RESCHEDULE',
    promptSignalCreatedAt: new Date(now.getTime() - 20 * 60 * 1000),
    promptSignalEvidence: '用户总是在开始前十分钟才想起准备。',
    promptSignalProposedNextAction: '在约定窗口前十分钟提示准备，不增加提醒频率。',
  }))
  assert.equal(result.action, QQ_CONTACT_ACTION.SEND)
  assert.equal(result.reasonCode, 'prompt_reschedule_risk')
  assert.equal(result.evidence.valueGate.evidence.promptSignalActive, true)
  assert.equal(result.evidence.valueGate.evidence.promptSignalAdjustmentType, 'RESCHEDULE')
  assert.equal(result.evidence.sentTodayCount, 0)
  assert.equal(result.evidence.maxDailyContacts, 2)
})

test('recent feedback defers another intervention until its value can recover', () => {
  const feedbackAt = new Date(now.getTime() - 30 * 60 * 1000)
  const result = evaluateQqContactPolicy(input({
    recentFeedbackAt: feedbackAt,
    recentFeedbackResult: 'NOT_DONE',
    recentFeedbackCooldownMinutes: 180,
  }))
  assert.equal(result.action, QQ_CONTACT_ACTION.DEFER)
  assert.equal(result.reasonCode, 'recent_feedback_cooldown')
  assert.equal(result.nextEligibleAt, new Date(feedbackAt.getTime() + 180 * 60 * 1000).toISOString())
})

test('weekly review requires new activity or an open goal gap', () => {
  const rule = {
    reminderType: 'weekly_review',
    enabled: true,
    maxPerDay: 1,
    metadata: {
      activeContactConsent: true,
      contactConsent: { granted: true, source: 'settings_ui' },
    },
  }
  const empty = evaluateQqContactPolicy(input({
    rule,
    currentAction: null,
    openGapCount: 0,
    recentActivityCount: 0,
  }))
  assert.equal(empty.action, QQ_CONTACT_ACTION.SKIP)
  assert.equal(empty.reasonCode, 'no_new_evidence')

  const useful = evaluateQqContactPolicy(input({
    rule,
    currentAction: null,
    openGapCount: 1,
    recentActivityCount: 0,
  }))
  assert.equal(useful.action, QQ_CONTACT_ACTION.SEND)
  assert.equal(useful.reasonCode, 'weekly_recalibration_due')

  const usefulAfterTodayDone = evaluateQqContactPolicy(input({
    rule,
    currentAction: null,
    todayActionCompleted: true,
    completedActionGoalId: 'goal-1',
    openGapCount: 1,
  }))
  assert.equal(usefulAfterTodayDone.action, QQ_CONTACT_ACTION.SEND)
  assert.equal(usefulAfterTodayDone.reasonCode, 'weekly_recalibration_due')
})

test('cadence presets expose genuinely different candidate windows and reserve Sunday review capacity', () => {
  assert.equal(qqCadenceAllowsReminder('light', 'morning_planning'), true)
  assert.equal(qqCadenceAllowsReminder('light', 'midday_check'), false)
  assert.equal(qqCadenceAllowsReminder('light', 'evening_review'), false)
  assert.equal(qqCadenceAllowsReminder('balanced', 'midday_check'), false)
  assert.equal(qqCadenceAllowsReminder('balanced', 'evening_review'), true)
  assert.equal(qqCadenceAllowsReminder('supportive', 'midday_check'), true)

  const lightMidday = evaluateQqContactPolicy(input({ cadence: 'light' }))
  assert.equal(lightMidday.action, QQ_CONTACT_ACTION.SKIP)
  assert.equal(lightMidday.reasonCode, 'cadence_window_disabled')

  const sundayMorning = evaluateQqContactPolicy(input({
    cadence: 'light',
    localWeekday: 'SUN',
    rule: {
      reminderType: 'morning_planning',
      enabled: true,
      maxPerDay: 1,
      metadata: {
        activeContactConsent: true,
        contactConsent: { granted: true, source: 'settings_ui' },
      },
    },
  }))
  assert.equal(sundayMorning.action, QQ_CONTACT_ACTION.SKIP)
  assert.equal(sundayMorning.reasonCode, 'weekly_review_priority')

  const sundayWithoutReviewEvidence = evaluateQqContactPolicy(input({
    cadence: 'light',
    localWeekday: 'SUN',
    openGapCount: 0,
    recentActivityCount: 0,
    rule: {
      reminderType: 'morning_planning',
      enabled: true,
      maxPerDay: 1,
      metadata: {
        activeContactConsent: true,
        contactConsent: { granted: true, source: 'settings_ui' },
      },
    },
  }))
  assert.equal(sundayWithoutReviewEvidence.action, QQ_CONTACT_ACTION.SEND)
})

test('an outstanding prompt defers; repeated non-response pauses every proactive rule', () => {
  const awaiting = evaluateQqContactPolicy(input({
    unansweredCount: 1,
    awaitingReplyUntil: new Date(now.getTime() + 60 * 60 * 1000),
  }))
  assert.equal(awaiting.action, QQ_CONTACT_ACTION.DEFER)
  assert.equal(awaiting.reasonCode, 'awaiting_reply')

  const paused = evaluateQqContactPolicy(input({ unansweredCount: 3 }))
  assert.equal(paused.action, QQ_CONTACT_ACTION.SKIP)
  assert.equal(paused.reasonCode, 'no_response_pause')
  assert.equal(paused.shouldPauseAll, true)
})

test('C2C uses a recent message only for passive reply, otherwise uses wakeup without msg_id', () => {
  const passive = evaluateQqContactPolicy(input())
  assert.equal(passive.channelMode, QQ_CHANNEL_MODE.C2C_PASSIVE)
  assert.deepEqual(passive.sendOptions, { msgId: 'source-1', isWakeup: false })

  const wakeup = evaluateQqContactPolicy(input({
    latestInboundAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
  }))
  assert.equal(wakeup.channelMode, QQ_CHANNEL_MODE.C2C_WAKEUP)
  assert.deepEqual(wakeup.sendOptions, { msgId: null, isWakeup: true })

  const passiveBody = buildQqMessageBody('继续吗？', {
    channelMode: passive.channelMode,
    sourceMessageId: passive.sendOptions.msgId,
    msgSeq: 1,
  })
  assert.equal(passiveBody.msg_id, 'source-1')
  assert.equal('is_wakeup' in passiveBody, false)

  const wakeupBody = buildQqMessageBody('现在先做两分钟。', {
    channelMode: wakeup.channelMode,
    msgSeq: 2,
  })
  assert.equal(wakeupBody.is_wakeup, true)
  assert.equal('msg_id' in wakeupBody, false)
})

test('group proactive delivery never carries passive or wakeup parameters', () => {
  const group = evaluateQqContactPolicy(input({
    binding: { contextType: 'group', contextId: 'group-1' },
    authorizedContextId: 'group-1',
    authorizedContextType: 'group',
  }))
  assert.equal(group.action, QQ_CONTACT_ACTION.SEND)
  assert.equal(group.channelMode, QQ_CHANNEL_MODE.GROUP_ACTIVE)

  const body = buildQqMessageBody('该开始了。', {
    channelMode: group.channelMode,
    sourceMessageId: 'must-not-leak',
    msgSeq: 3,
  })
  assert.equal('msg_id' in body, false)
  assert.equal('is_wakeup' in body, false)
})

test('proactive delivery never falls back to an unproved or different QQ context', () => {
  const missingAuthorization = evaluateQqContactPolicy(input({
    authorizedContextId: '',
    authorizedContextType: '',
  }))
  assert.equal(missingAuthorization.action, QQ_CONTACT_ACTION.SKIP)
  assert.equal(missingAuthorization.reasonCode, 'context_not_authorized')

  const differentBinding = evaluateQqContactPolicy(input({
    binding: { contextType: 'group', contextId: 'group-2' },
  }))
  assert.equal(differentBinding.action, QQ_CONTACT_ACTION.SKIP)
  assert.equal(differentBinding.reasonCode, 'context_not_authorized')

  const authorizedButUnbound = evaluateQqContactPolicy(input({ binding: null }))
  assert.equal(authorizedButUnbound.action, QQ_CONTACT_ACTION.SKIP)
  assert.equal(authorizedButUnbound.reasonCode, 'no_enabled_binding')
})

test('C2C delivery defers when the platform recall window or quota is unavailable', () => {
  const noQuota = evaluateQqContactPolicy(input({
    latestInboundAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
    c2cWakeupEligible: false,
  }))
  assert.equal(noQuota.action, QQ_CONTACT_ACTION.DEFER)
  assert.equal(noQuota.reasonCode, 'platform_quota')

  const expired = evaluateQqContactPolicy(input({
    latestInboundAt: new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000),
  }))
  assert.equal(expired.action, QQ_CONTACT_ACTION.DEFER)
  assert.equal(expired.reasonCode, 'c2c_recall_expired')
})
