const AUTONOMOUS_CONTACT_PATTERN = /(你|ai|助手|系统).{0,12}(合适|适当|该|需要|关键|风险|看着|判断).{0,12}(提醒|催我|叫我|通知|联系)|(?:提醒|催我|叫我|通知|联系).{0,12}(你来|你决定|你判断|合适|适当|看着)|主动.{0,6}(提醒|联系|干预)|恢复.{0,6}(主动)?提醒/u
const PAUSE_CONTACT_PATTERN = /(暂停|停止|关闭|取消|别再|不要再|不用再|先别|别).{0,10}(主动)?(提醒|催我|通知|联系|消息)|(?:主动)?(提醒|催我|通知|联系|消息).{0,10}(暂停|停止|关闭|取消|别再|不要再)/u
const BARE_STOP_PATTERN = /^(暂停|停止|放弃|算了|先放着|不搞了|不弄了|不继续了)[。！!]?$/u

function normalizedText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function hasNegatedPauseIntent(content) {
  return /(不要|不用|无需|别|不必).{0,4}(停止|暂停|关闭).{0,4}(提醒|催我)|继续提醒|别停|不要停/u.test(content)
}

export const RECOMMENDED_PROACTIVE_CONTACT_RULES = Object.freeze([
  Object.freeze({ reminderType: 'morning_planning', schedule: '08:30' }),
  Object.freeze({ reminderType: 'midday_check', schedule: '12:30' }),
  Object.freeze({ reminderType: 'evening_review', schedule: '21:30' }),
  Object.freeze({ reminderType: 'weekly_review', schedule: 'SUN 21:00' }),
])

export function normalizeProactiveContactCadence(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'light' || /少|轻|低频/u.test(normalized)) return 'light'
  if (normalized === 'supportive' || /积极|多一点|多提醒|高频/u.test(normalized)) return 'supportive'
  return 'balanced'
}

export function inferProactiveContactToolIntent(value) {
  const content = normalizedText(value)
  if (!content) return null

  if (!hasNegatedPauseIntent(content) && (PAUSE_CONTACT_PATTERN.test(content) || BARE_STOP_PATTERN.test(content))) {
    return {
      toolName: 'reminder.schedule',
      input: {
        mode: 'pause',
        enabled: false,
        reason: 'user_requested_pause',
      },
      confidence: 0.98,
      reason: '用户明确要求暂停主动联系。',
    }
  }

  if (!AUTONOMOUS_CONTACT_PATTERN.test(content) && !/^(恢复提醒|继续提醒|重新提醒)$/u.test(content)) {
    return null
  }

  const cadence = /少|轻|低频/u.test(content)
    ? 'light'
    : /积极|多一点|多提醒|高频/u.test(content)
      ? 'supportive'
      : 'balanced'

  return {
    toolName: 'reminder.schedule',
    input: {
      mode: 'autonomous',
      enabled: true,
      cadence,
      source: 'agent_conversation',
    },
    confidence: 0.96,
    reason: '用户希望由助手判断有价值的主动联系时机。',
  }
}

export function isProactiveContactDisableInput(value = {}) {
  const mode = String(value?.mode || '').trim().toLowerCase()
  return value?.enabled === false || ['pause', 'disable', 'off', 'revoke'].includes(mode)
}

export function buildProactiveContactMetadata(input = {}, now = new Date()) {
  const updatedAt = now instanceof Date ? now.toISOString() : new Date(now).toISOString()
  const cadence = normalizeProactiveContactCadence(input.cadence)
  const source = String(input.source || 'agent_confirmed')
  const confirmedSource = source.endsWith('_conversation') ? 'agent_confirmed' : source
  return {
    source: confirmedSource,
    consentChannel: source,
    recommended: true,
    scheduleMode: 'candidate_window',
    cadence,
    activeContactConsent: true,
    consentUpdatedAt: updatedAt,
    contactConsent: {
      granted: true,
      source: confirmedSource,
      updatedAt,
    },
  }
}
