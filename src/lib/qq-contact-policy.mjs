const MINUTE_MS = 60 * 1000
const DAY_MS = 24 * 60 * MINUTE_MS

export const QQ_CONTACT_ACTION = Object.freeze({
  SEND: 'send',
  SKIP: 'skip',
  DEFER: 'defer',
})

export const QQ_CHANNEL_MODE = Object.freeze({
  C2C_PASSIVE: 'c2c_passive',
  C2C_WAKEUP: 'c2c_wakeup',
  GROUP_ACTIVE: 'group_active',
})

export const QQ_CADENCE_WINDOWS = Object.freeze({
  light: Object.freeze(['morning_planning', 'weekly_review']),
  balanced: Object.freeze(['morning_planning', 'evening_review', 'weekly_review']),
  supportive: Object.freeze(['morning_planning', 'midday_check', 'evening_review', 'weekly_review']),
})

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function asDate(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function metadataHasConsent(metadata) {
  const record = asRecord(metadata)
  const consent = asRecord(record.contactConsent)
  return record.activeContactConsent === true || consent.granted === true
}

function decision(action, reasonCode, channelMode = null, details = {}) {
  return {
    action,
    reasonCode,
    channelMode,
    nextEligibleAt: details.nextEligibleAt || null,
    shouldPauseAll: details.shouldPauseAll === true,
    sendOptions: details.sendOptions || null,
    evidence: details.evidence || {},
  }
}

function normalizeStatus(value) {
  return String(value || '').trim().toUpperCase()
}

function futureIso(value) {
  const date = asDate(value)
  return date ? date.toISOString() : null
}

function normalizeCadence(value) {
  const cadence = String(value || '').trim().toLowerCase()
  return cadence === 'light' || cadence === 'supportive' ? cadence : 'balanced'
}

export function qqCadenceAllowsReminder(cadence, reminderType) {
  return QQ_CADENCE_WINDOWS[normalizeCadence(cadence)].includes(String(reminderType || ''))
}

/**
 * Pure value gate for proactive intervention. A due clock window is only a
 * candidate; it is not evidence that contacting the user is worthwhile.
 */
export function evaluateQqInterventionValue(input = {}) {
  const goal = asRecord(input.goal)
  const action = asRecord(input.currentAction)
  const reminderType = String(input.reminderType || input.rule?.reminderType || '')
  const goalStatus = normalizeStatus(goal.status)
  const actionStatus = normalizeStatus(action.status)
  const goalId = String(goal.id || '')
  const actionGoalId = String(action.goalId || '')
  const completedActionGoalId = String(input.completedActionGoalId || '')
  const recentFeedbackAt = asDate(input.recentFeedbackAt)
  const now = asDate(input.now) || new Date()
  const recentFeedbackCooldownMinutes = Math.max(0, Number(input.recentFeedbackCooldownMinutes || 180))
  const recentFeedbackAgeMinutes = recentFeedbackAt
    ? Math.max(0, Math.floor((now.getTime() - recentFeedbackAt.getTime()) / MINUTE_MS))
    : null
  const openGapCount = Math.max(0, Number(input.openGapCount || 0))
  const recentActivityCount = Math.max(0, Number(input.recentActivityCount || 0))
  const actionWindowState = String(input.actionWindowState || '')
  const cadence = normalizeCadence(input.cadence)
  const cadenceWindowAllowed = qqCadenceAllowsReminder(cadence, reminderType)
  const localWeekday = String(input.localWeekday || '').slice(0, 3).toUpperCase()
  const weeklyReviewWorthwhile = recentActivityCount > 0 || openGapCount > 0
  const promptSignalActive = input.promptSignalActive === true
  const promptSignalCreatedAt = asDate(input.promptSignalCreatedAt)

  const evidence = {
    goalId,
    goalStatus,
    isCurrentFocus: goal.isCurrentFocus === true,
    actionId: String(action.id || ''),
    actionGoalId,
    actionStatus,
    plannedActionAt: futureIso(input.plannedActionAt || action.actionDate),
    estimatedMinutes: Math.max(0, Number(action.estimatedMinutes || 0)),
    actionWindowState,
    reminderType,
    riskWindow: String(input.riskWindow || reminderType),
    completedActionGoalId,
    recentFeedbackAt: futureIso(recentFeedbackAt),
    recentFeedbackAgeMinutes,
    recentFeedbackResult: String(input.recentFeedbackResult || ''),
    openGapCount,
    recentActivityCount,
    cadence,
    cadenceWindowAllowed,
    localWeekday,
    weeklyReviewWorthwhile,
    promptSignalActive,
    promptSignalCategory: String(input.promptSignalCategory || ''),
    promptSignalAdjustmentType: String(input.promptSignalAdjustmentType || ''),
    promptSignalCreatedAt: futureIso(promptSignalCreatedAt),
    promptSignalAgeMinutes: promptSignalCreatedAt
      ? Math.max(0, Math.floor((now.getTime() - promptSignalCreatedAt.getTime()) / MINUTE_MS))
      : null,
    promptSignalEvidence: String(input.promptSignalEvidence || ''),
    promptSignalProposedNextAction: String(input.promptSignalProposedNextAction || ''),
  }

  if (!goalId) {
    return decision(QQ_CONTACT_ACTION.SKIP, 'no_active_goal', null, { evidence })
  }
  if (goalStatus !== 'ACTIVE') {
    return decision(QQ_CONTACT_ACTION.SKIP, 'goal_inactive', null, { evidence })
  }
  if (goal.isCurrentFocus !== true && !input.allowNonFocusGoal) {
    return decision(QQ_CONTACT_ACTION.SKIP, 'goal_not_current_focus', null, { evidence })
  }
  if (!cadenceWindowAllowed) {
    return decision(QQ_CONTACT_ACTION.SKIP, 'cadence_window_disabled', null, { evidence })
  }
  if (
    reminderType !== 'weekly_review'
    && input.todayActionCompleted === true
    && completedActionGoalId
    && completedActionGoalId === goalId
  ) {
    return decision(QQ_CONTACT_ACTION.SKIP, 'already_done', null, { evidence })
  }

  if (
    recentFeedbackAt
    && recentFeedbackCooldownMinutes > 0
    && recentFeedbackAgeMinutes < recentFeedbackCooldownMinutes
  ) {
    return decision(QQ_CONTACT_ACTION.DEFER, 'recent_feedback_cooldown', null, {
      nextEligibleAt: new Date(recentFeedbackAt.getTime() + recentFeedbackCooldownMinutes * MINUTE_MS).toISOString(),
      evidence,
    })
  }

  if (
    localWeekday === 'SUN'
    && weeklyReviewWorthwhile
    && (
      (cadence === 'light' && reminderType === 'morning_planning')
      || (cadence !== 'light' && reminderType === 'evening_review')
    )
  ) {
    return decision(QQ_CONTACT_ACTION.SKIP, 'weekly_review_priority', null, { evidence })
  }

  if (reminderType === 'weekly_review') {
    if (!weeklyReviewWorthwhile) {
      return decision(QQ_CONTACT_ACTION.SKIP, 'no_new_evidence', null, { evidence })
    }
    return decision(QQ_CONTACT_ACTION.SEND, 'weekly_recalibration_due', null, { evidence })
  }

  if (!action.id || actionGoalId !== goalId) {
    return decision(QQ_CONTACT_ACTION.SKIP, 'no_current_action', null, { evidence })
  }
  if (actionWindowState === 'future') {
    return decision(QQ_CONTACT_ACTION.DEFER, 'before_action_window', null, {
      nextEligibleAt: futureIso(action.actionDate),
      evidence,
    })
  }
  if (actionWindowState === 'outside') {
    return decision(QQ_CONTACT_ACTION.SKIP, 'outside_action_window', null, { evidence })
  }

  if (reminderType === 'morning_planning') {
    if (['PLANNED', 'PARTIAL', 'NOT_DONE'].includes(actionStatus)) {
      return decision(
        QQ_CONTACT_ACTION.SEND,
        promptSignalActive ? 'prompt_reschedule_risk' : 'daily_action_ready',
        null,
        { evidence },
      )
    }
    return decision(QQ_CONTACT_ACTION.SKIP, 'no_intervention_value', null, { evidence })
  }
  if (reminderType === 'midday_check') {
    if (actionStatus === 'PLANNED') {
      return decision(
        QQ_CONTACT_ACTION.SEND,
        promptSignalActive ? 'prompt_reschedule_risk' : 'action_start_risk',
        null,
        { evidence },
      )
    }
    if (['PARTIAL', 'NOT_DONE'].includes(actionStatus)) {
      return decision(QQ_CONTACT_ACTION.SEND, 'recovery_window', null, { evidence })
    }
    return decision(QQ_CONTACT_ACTION.SKIP, 'no_intervention_value', null, { evidence })
  }
  if (reminderType === 'evening_review') {
    if (['PLANNED', 'PARTIAL', 'NOT_DONE'].includes(actionStatus)) {
      return decision(QQ_CONTACT_ACTION.SEND, 'feedback_needed', null, { evidence })
    }
    return decision(QQ_CONTACT_ACTION.SKIP, 'no_intervention_value', null, { evidence })
  }

  if (input.explicitRiskWindow === true) {
    return decision(QQ_CONTACT_ACTION.SEND, 'explicit_risk_window', null, { evidence })
  }
  return decision(QQ_CONTACT_ACTION.SKIP, 'no_intervention_value', null, { evidence })
}

/**
 * Decides whether an already-due reminder candidate is worth delivering.
 * This function is intentionally pure so consent and restraint remain testable
 * without starting Prisma, the model provider, or the QQ gateway.
 */
export function evaluateQqContactPolicy(input = {}) {
  const rule = asRecord(input.rule)
  const binding = asRecord(input.binding)
  const now = asDate(input.now) || new Date()
  const metadata = asRecord(rule.metadata)
  const consentMetadata = asRecord(metadata.contactConsent)
  const authorizedContextId = String(
    input.authorizedContextId
      || metadata.qqContextId
      || consentMetadata.qqContextId
      || consentMetadata.contextId
      || '',
  )
  const authorizedContextType = String(
    input.authorizedContextType
      || metadata.qqContextType
      || consentMetadata.qqContextType
      || consentMetadata.contextType
      || '',
  ).toLowerCase()
  const noResponsePauseAfter = Math.max(1, Number(input.noResponsePauseAfter || 3))
  const unansweredCount = Math.max(0, Number(input.unansweredCount || 0))
  const sentTodayCount = Math.max(0, Number(input.sentTodayCount || 0))
  const sentForRuleTodayCount = Math.max(0, Number(input.sentForRuleTodayCount || 0))
  const maxDailyContacts = Math.max(1, Number(input.maxDailyContacts || rule.maxPerDay || 1))
  const maxRuleContacts = Math.max(1, Number(rule.maxPerDay || 1))
  const latestInboundAt = asDate(input.latestInboundAt)
  const passiveWindowMinutes = Math.max(1, Number(input.passiveWindowMinutes || 60))
  const wakeupWindowDays = Math.max(1, Number(input.wakeupWindowDays || 30))
  const valueGate = evaluateQqInterventionValue({
    ...input,
    reminderType: rule.reminderType,
    now,
  })

  const baseEvidence = {
    reminderType: String(rule.reminderType || ''),
    enabled: rule.enabled === true,
    activeContactConsent: input.activeContactConsent === true,
    metadataConsent: metadataHasConsent(metadata),
    sentTodayCount,
    maxDailyContacts,
    sentForRuleTodayCount,
    maxRuleContacts,
    unansweredCount,
    noResponsePauseAfter,
    contextType: String(binding.contextType || ''),
    contextId: String(binding.contextId || ''),
    authorizedContextId,
    authorizedContextType,
    contextAuthorizationAmbiguous: input.contextAuthorizationAmbiguous === true,
    valueGate: {
      action: valueGate.action,
      reasonCode: valueGate.reasonCode,
      evidence: valueGate.evidence,
    },
  }

  if (rule.enabled !== true) {
    return decision(QQ_CONTACT_ACTION.SKIP, 'rule_disabled', null, { evidence: baseEvidence })
  }

  if (input.userOptedOut === true) {
    return decision(QQ_CONTACT_ACTION.SKIP, 'user_opt_out', null, {
      shouldPauseAll: true,
      evidence: baseEvidence,
    })
  }

  if (input.activeContactConsent !== true || !metadataHasConsent(metadata)) {
    return decision(QQ_CONTACT_ACTION.SKIP, 'missing_consent', null, { evidence: baseEvidence })
  }

  if (input.inQuietHours === true) {
    return decision(QQ_CONTACT_ACTION.DEFER, 'quiet_hours', null, {
      nextEligibleAt: input.quietHoursEndAt || null,
      evidence: baseEvidence,
    })
  }

  if (unansweredCount >= noResponsePauseAfter) {
    return decision(QQ_CONTACT_ACTION.SKIP, 'no_response_pause', null, {
      shouldPauseAll: true,
      evidence: baseEvidence,
    })
  }

  const awaitingReplyUntil = asDate(input.awaitingReplyUntil)
  if (awaitingReplyUntil && awaitingReplyUntil.getTime() > now.getTime()) {
    return decision(QQ_CONTACT_ACTION.DEFER, 'awaiting_reply', null, {
      nextEligibleAt: awaitingReplyUntil.toISOString(),
      evidence: baseEvidence,
    })
  }

  if (sentTodayCount >= maxDailyContacts || sentForRuleTodayCount >= maxRuleContacts) {
    return decision(QQ_CONTACT_ACTION.SKIP, 'daily_limit', null, { evidence: baseEvidence })
  }

  if (!authorizedContextId || input.contextAuthorizationAmbiguous === true) {
    return decision(QQ_CONTACT_ACTION.SKIP, 'context_not_authorized', null, { evidence: baseEvidence })
  }

  if (!binding.contextId || !binding.contextType) {
    return decision(QQ_CONTACT_ACTION.SKIP, 'no_enabled_binding', null, { evidence: baseEvidence })
  }

  if (
    String(binding.contextId) !== authorizedContextId
    || (
      authorizedContextType
      && String(binding.contextType || '').toLowerCase() !== authorizedContextType
    )
  ) {
    return decision(QQ_CONTACT_ACTION.SKIP, 'context_not_authorized', null, { evidence: baseEvidence })
  }

  if (valueGate.action !== QQ_CONTACT_ACTION.SEND) {
    return decision(valueGate.action, valueGate.reasonCode, null, {
      nextEligibleAt: valueGate.nextEligibleAt,
      evidence: baseEvidence,
    })
  }

  const contextType = String(binding.contextType || '').toLowerCase()
  if (contextType === 'group' || contextType === 'channel') {
    return decision(QQ_CONTACT_ACTION.SEND, valueGate.reasonCode, QQ_CHANNEL_MODE.GROUP_ACTIVE, {
      sendOptions: { msgId: null, isWakeup: false },
      evidence: baseEvidence,
    })
  }

  if (contextType !== 'c2c') {
    return decision(QQ_CONTACT_ACTION.SKIP, 'unsupported_context', null, { evidence: baseEvidence })
  }

  const sourceMessageId = String(input.sourceMessageId || '').trim()
  const inboundAgeMs = latestInboundAt ? now.getTime() - latestInboundAt.getTime() : Number.POSITIVE_INFINITY
  if (
    sourceMessageId
    && inboundAgeMs >= 0
    && inboundAgeMs <= passiveWindowMinutes * MINUTE_MS
  ) {
    return decision(QQ_CONTACT_ACTION.SEND, valueGate.reasonCode, QQ_CHANNEL_MODE.C2C_PASSIVE, {
      sendOptions: { msgId: sourceMessageId, isWakeup: false },
      evidence: { ...baseEvidence, inboundAgeMinutes: Math.floor(inboundAgeMs / MINUTE_MS) },
    })
  }

  if (!latestInboundAt) {
    return decision(QQ_CONTACT_ACTION.DEFER, 'c2c_no_user_context', QQ_CHANNEL_MODE.C2C_WAKEUP, {
      evidence: baseEvidence,
    })
  }

  if (inboundAgeMs > wakeupWindowDays * DAY_MS) {
    return decision(QQ_CONTACT_ACTION.DEFER, 'c2c_recall_expired', QQ_CHANNEL_MODE.C2C_WAKEUP, {
      evidence: { ...baseEvidence, inboundAgeDays: Math.floor(inboundAgeMs / DAY_MS) },
    })
  }

  if (input.c2cWakeupEligible !== true) {
    return decision(QQ_CONTACT_ACTION.DEFER, 'platform_quota', QQ_CHANNEL_MODE.C2C_WAKEUP, {
      nextEligibleAt: input.platformNextEligibleAt || null,
      evidence: baseEvidence,
    })
  }

  return decision(QQ_CONTACT_ACTION.SEND, valueGate.reasonCode, QQ_CHANNEL_MODE.C2C_WAKEUP, {
    sendOptions: { msgId: null, isWakeup: true },
    evidence: { ...baseEvidence, inboundAgeDays: Math.floor(inboundAgeMs / DAY_MS) },
  })
}

export function buildQqMessageBody(content, options = {}) {
  const channelMode = String(options.channelMode || '')
  const sourceMessageId = String(options.sourceMessageId || '').trim()
  const body = {
    msg_type: 0,
    content: String(content || ''),
    msg_seq: Number.isFinite(options.msgSeq) ? options.msgSeq : Math.floor(Date.now() % 2_000_000_000),
  }

  if (channelMode === QQ_CHANNEL_MODE.C2C_PASSIVE) {
    if (!sourceMessageId) throw new Error('c2c_passive requires sourceMessageId')
    body.msg_id = sourceMessageId
  } else if (channelMode === QQ_CHANNEL_MODE.C2C_WAKEUP) {
    body.is_wakeup = true
  }

  return body
}

export async function pauseQqProactiveContact(prisma, userId, options = {}) {
  const reasonCode = String(options.reasonCode || 'user_opt_out')
  const now = asDate(options.now) || new Date()
  const rules = await prisma.reminderRule.findMany({ where: { userId, channel: 'qq' } })
  for (const reminderRule of rules) {
    await prisma.reminderRule.update({
      where: { id: reminderRule.id },
      data: {
        enabled: false,
        metadata: {
          ...asRecord(reminderRule.metadata),
          pausedReason: reasonCode,
          pausedAt: now.toISOString(),
        },
      },
    })
  }

  const settings = await prisma.userSetting.findUnique({ where: { userId } })
  if (settings) {
    await prisma.userSetting.update({
      where: { userId },
      data: {
        notifications: {
          ...asRecord(settings.notifications),
          proactive_contact_enabled: false,
          proactive_contact_paused_reason: reasonCode,
          proactive_contact_paused_at: now.toISOString(),
        },
      },
    })
  }

  return {
    userId,
    reasonCode,
    pausedAt: now.toISOString(),
    disabledRuleIds: rules.map((rule) => rule.id),
  }
}
