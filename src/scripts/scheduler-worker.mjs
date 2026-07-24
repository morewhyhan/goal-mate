import { PrismaClient } from '@prisma/client'
import { existsSync, readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  recordAgentToolActionWithPrisma,
} from '../lib/agent-tool-executor.mjs'
import { planIntervention } from '../lib/intervention-planner.mjs'
import { chatCompletionsUrl } from '../lib/model-endpoint.mjs'
import { fetchModelProvider } from '../lib/model-provider-http.mjs'
import { resolveModelApiKey } from '../lib/model-secret.mjs'
import { resolveQqBotConfig } from '../lib/qq-bot-config.mjs'
import {
  buildQqMessageBody,
  evaluateQqContactPolicy,
  pauseQqProactiveContact,
  QQ_CONTACT_ACTION,
} from '../lib/qq-contact-policy.mjs'
import { touchRuntimeHeartbeat } from '../lib/runtime-heartbeat.mjs'
import { ensureTodayAction } from '../lib/today-action-planner.mjs'

const prisma = new PrismaClient()

function loadLocalEnv() {
  if (!existsSync('.env')) return
  const content = readFileSync('.env', 'utf8')
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const index = trimmed.indexOf('=')
    if (index === -1) continue
    const key = trimmed.slice(0, index).trim()
    const rawValue = trimmed.slice(index + 1).trim()
    const value = rawValue.replace(/^"|"$/g, '').replace(/^'|'$/g, '')
    if (!(key in process.env)) process.env[key] = value
  }
}

loadLocalEnv()

const tickSeconds = Number(process.env.SCHEDULER_TICK_SECONDS || '60')
const defaultTimezone = process.env.SCHEDULER_TIMEZONE || 'Asia/Shanghai'
const defaultQqMessageApiBase = 'https://api.sgroup.qq.com'
const defaultQqAuthBase = 'https://bots.qq.com'
const runOnce = process.argv.includes('--once') || process.env.SCHEDULER_RUN_ONCE === '1'
const forceReminderArg = process.argv.find((arg) => arg.startsWith('--force-reminder='))
const forcedReminderType = forceReminderArg?.split('=')[1] || process.env.SCHEDULER_FORCE_REMINDER || ''
const defaultRules = [
  { reminderType: 'morning_planning', schedule: process.env.SCHEDULER_MORNING_TIME || '08:30', maxPerDay: 1, quietHours: '23:00-07:30', enabled: false },
  { reminderType: 'midday_check', schedule: process.env.SCHEDULER_MIDDAY_TIME || '12:30', maxPerDay: 1, quietHours: '23:00-07:30', enabled: false },
  { reminderType: 'evening_review', schedule: process.env.SCHEDULER_EVENING_TIME || '21:30', maxPerDay: 1, quietHours: '23:00-07:30', enabled: false },
  { reminderType: 'weekly_review', schedule: process.env.SCHEDULER_WEEKLY_TIME || 'SUN 21:00', maxPerDay: 1, quietHours: '23:00-07:30', enabled: false },
]

let cachedAccessToken = ''
let accessTokenExpiresAt = 0
let stopping = false
let currentQqConfig = null
let currentQqConfigSignature = ''
let currentQqConfigUserId = ''
let lastMissingConfigLogAt = 0

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function trimForPrompt(value, max = 900) {
  return value.length > max ? `${value.slice(0, max)}...` : value
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function asDate(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function qqConfigSignature(config) {
  return JSON.stringify({
    source: config?.source || '',
    userId: config?.userId || '',
    appId: config?.appId || '',
    token: config?.token || '',
    apiBase: config?.apiBase || '',
  })
}

function qqAuthBase(config) {
  const explicit = String(process.env.QQ_BOT_AUTH_BASE || '').trim().replace(/\/+$/, '')
  if (explicit) return explicit
  const apiBase = String(config?.apiBase || '').trim().replace(/\/+$/, '')
  if (!apiBase || apiBase === defaultQqMessageApiBase) return defaultQqAuthBase
  return apiBase
}

async function refreshQqConfig(userId = '') {
  const config = await resolveQqBotConfig(prisma, userId)
  if (!config.configured) {
    currentQqConfig = null
    currentQqConfigSignature = ''
    currentQqConfigUserId = ''
    cachedAccessToken = ''
    accessTokenExpiresAt = 0
    const now = Date.now()
    if (now - lastMissingConfigLogAt > 60_000) {
      console.warn('[scheduler] QQ Bot config missing; scheduler is alive and waiting for Settings -> QQ configuration.')
      lastMissingConfigLogAt = now
    }
    return null
  }

  const nextSignature = qqConfigSignature(config)
  if (nextSignature !== currentQqConfigSignature) {
    cachedAccessToken = ''
    accessTokenExpiresAt = 0
    currentQqConfigSignature = nextSignature
    console.log(`[scheduler] loaded QQ config from ${config.source}; apiBase=${config.apiBase}`)
  }
  currentQqConfig = config
  currentQqConfigUserId = userId
  return config
}

async function requireQqConfig(userId = '') {
  if (
    currentQqConfig
    && (
      currentQqConfigUserId === userId
      || (!userId && currentQqConfig.source === 'server_env_fallback')
    )
  ) {
    return currentQqConfig
  }
  return refreshQqConfig(userId)
}

async function getAppAccessToken(userId = '') {
  const config = await requireQqConfig(userId)
  if (!config) throw new Error('QQ Bot config missing')
  if (cachedAccessToken && currentQqConfigUserId === userId && Date.now() < accessTokenExpiresAt - 60_000) return cachedAccessToken

  const response = await fetch(`${qqAuthBase(config)}/app/getAppAccessToken`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ appId: config.appId, clientSecret: config.token }),
  })
  const text = await response.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (!response.ok || !data?.access_token) {
    throw new Error(`QQ getAppAccessToken failed: ${response.status} ${text.slice(0, 300)}`)
  }

  cachedAccessToken = data.access_token
  accessTokenExpiresAt = Date.now() + Number(data.expires_in || 7200) * 1000
  return cachedAccessToken
}

async function qqRequest(method, path, body, userId = '') {
  const config = await requireQqConfig(userId)
  if (!config) throw new Error('QQ Bot config missing')
  const accessToken = await getAppAccessToken(userId)
  const response = await fetch(`${config.apiBase}${path}`, {
    method,
    headers: {
      authorization: `QQBot ${accessToken}`,
      'content-type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (!response.ok) {
    throw new Error(`QQ API ${method} ${path} failed: ${response.status} ${text.slice(0, 300)}`)
  }
  return data
}

async function sendQqMessage(binding, content, contactPolicy) {
  const sourceMessageId = contactPolicy?.sendOptions?.msgId || undefined
  if (binding.contextType === 'c2c') {
    return qqRequest('POST', `/v2/users/${binding.contextId}/messages`, buildQqMessageBody(content, {
      channelMode: contactPolicy?.channelMode,
      sourceMessageId,
    }), binding.userId)
  }
  if (binding.contextType === 'group') {
    return qqRequest('POST', `/v2/groups/${binding.contextId}/messages`, buildQqMessageBody(content, {
      channelMode: contactPolicy?.channelMode,
    }), binding.userId)
  }
  return qqRequest('POST', `/channels/${binding.contextId}/messages`, {
    content,
  }, binding.userId)
}

function localParts(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)
  return Object.fromEntries(parts.map((part) => [part.type, part.value]))
}

function dueInfo(rule, now = new Date(), forceReminderType = '') {
  const timezone = rule.timezone || defaultTimezone
  const parts = localParts(now, timezone)
  const schedule = String(rule.schedule || '').trim().toUpperCase()
  const tokens = schedule.split(/\s+/).filter(Boolean)
  const timeToken = tokens.length > 1 ? tokens[1] : tokens[0]
  const weekdayToken = tokens.length > 1 ? tokens[0] : ''
  const [hour, minute] = timeToken.split(':')
  const weekday = String(parts.weekday || '').slice(0, 3).toUpperCase()
  const due =
    (!weekdayToken || weekdayToken === weekday) &&
    String(parts.hour).padStart(2, '0') === String(hour).padStart(2, '0') &&
    String(parts.minute).padStart(2, '0') === String(minute).padStart(2, '0')
  const dateKey = `${parts.year}-${parts.month}-${parts.day}`
  const quiet = isInQuietHours(rule.quietHours, parts)
  const quietEndAt = quiet ? quietHoursEndAt(rule.quietHours, parts, now) : null
  if (forceReminderType && forceReminderType === rule.reminderType) {
    return {
      due: true,
      dueKey: `${dateKey}:${rule.reminderType}:forced:${Date.now()}`,
      localDate: dateKey,
      timezone,
      forced: true,
      quiet,
      quietHoursEndAt: quietEndAt,
      localWeekday: weekday,
    }
  }
  return {
    due,
    dueKey: `${dateKey}:${rule.reminderType}`,
    localDate: dateKey,
    timezone,
    quiet,
    quietHoursEndAt: quietEndAt,
    localWeekday: weekday,
  }
}

function deferredDueInfo(rule, event, now = new Date()) {
  const timezone = rule.timezone || defaultTimezone
  const parts = localParts(now, timezone)
  const weekday = String(parts.weekday || '').slice(0, 3).toUpperCase()
  const quiet = isInQuietHours(rule.quietHours, parts)
  return {
    due: true,
    dueKey: event.dueKey,
    localDate: `${parts.year}-${parts.month}-${parts.day}`,
    timezone,
    quiet,
    quietHoursEndAt: quiet ? quietHoursEndAt(rule.quietHours, parts, now) : null,
    localWeekday: weekday,
    retry: true,
  }
}

function minutesFromTime(value) {
  const [hour, minute] = String(value || '').split(':').map((part) => Number(part))
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null
  return Math.max(0, Math.min(1439, hour * 60 + minute))
}

function quietHoursRange(value) {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && typeof value.range === 'string') return value.range
  return ''
}

function isInQuietHours(quietHours, parts) {
  const range = quietHoursRange(quietHours)
  const [startRaw, endRaw] = range.split('-')
  const start = minutesFromTime(startRaw)
  const end = minutesFromTime(endRaw)
  const current = minutesFromTime(`${parts.hour}:${parts.minute}`)
  if (start === null || end === null || current === null || start === end) return false
  if (start < end) return current >= start && current < end
  return current >= start || current < end
}

function quietHoursEndAt(quietHours, parts, now) {
  if (!isInQuietHours(quietHours, parts)) return null
  const range = quietHoursRange(quietHours)
  const [startRaw, endRaw] = range.split('-')
  const start = minutesFromTime(startRaw)
  const end = minutesFromTime(endRaw)
  const current = minutesFromTime(`${parts.hour}:${parts.minute}`)
  if (start === null || end === null || current === null || start === end) return null

  let minutesUntilEnd = 0
  if (start < end) {
    minutesUntilEnd = end - current
  } else if (current >= start) {
    minutesUntilEnd = (1440 - current) + end
  } else {
    minutesUntilEnd = end - current
  }
  if (minutesUntilEnd <= 0) minutesUntilEnd += 1440
  const partialMinuteMs = now.getSeconds() * 1000 + now.getMilliseconds()
  return new Date(now.getTime() + minutesUntilEnd * 60 * 1000 - partialMinuteMs).toISOString()
}

function deferredRetryAt(contactPolicy, now = new Date()) {
  const explicit = asDate(contactPolicy?.nextEligibleAt)
  if (explicit && explicit.getTime() > now.getTime()) return explicit

  const fallbackHours = contactPolicy?.reasonCode === 'platform_quota'
    ? 6
    : contactPolicy?.reasonCode === 'c2c_no_user_context'
      || contactPolicy?.reasonCode === 'c2c_recall_expired'
      ? 24
      : 1
  return new Date(now.getTime() + fallbackHours * 60 * 60 * 1000)
}

async function ensureDefaultRulesForBoundUsers() {
  const bindings = await prisma.qqChatBinding.findMany({
    where: { status: 'ENABLED' },
    distinct: ['userId'],
  })

  for (const binding of bindings) {
    const existingCount = await prisma.reminderRule.count({
      where: { userId: binding.userId, channel: 'qq' },
    })
    if (existingCount > 0) continue

    for (const rule of defaultRules) {
      await prisma.reminderRule.create({
        data: {
          userId: binding.userId,
          reminderType: rule.reminderType,
          channel: 'qq',
          schedule: rule.schedule,
          timezone: defaultTimezone,
          maxPerDay: rule.maxPerDay,
          quietHours: { range: rule.quietHours },
          enabled: false,
          metadata: {
            source: 'scheduler_recommended',
            recommended: true,
            scheduleMode: 'candidate_window',
            candidateWindow: { reminderType: rule.reminderType, selectedBy: 'system_recommendation' },
            activeContactConsent: false,
          },
        },
      })
    }
  }
}

async function buildGoalContext(userId) {
  const goal = await prisma.goal.findFirst({
    where: { userId, isCurrentFocus: true },
    include: {
      keyResults: true,
      conditions: true,
      dailyActions: { orderBy: { actionDate: 'desc' }, take: 3 },
      reasoningCards: { orderBy: { version: 'desc' }, take: 1 },
    },
  })
  if (!goal) return '当前还没有主目标。'
  return [
    `当前目标：${goal.title}`,
    `解释：${goal.interpretedGoal || goal.rawInput}`,
    `KR：${goal.keyResults.map((kr) => `${kr.title}(${Math.round(kr.progress * 100)}%)`).join('；') || '暂无'}`,
    `条件：${goal.conditions.map((condition) => `${condition.title}[${condition.status}]`).join('；') || '暂无'}`,
    `最近行动：${goal.dailyActions.map((action) => `${action.title}[${action.status}]`).join('；') || '暂无'}`,
    `当前重点：${goal.reasoningCards[0]?.recommendedFocus || '暂无'}`,
  ].join('\n')
}

function shouldEnsureTodayAction(reminderType) {
  return reminderType === 'morning_planning'
    || reminderType === 'midday_check'
    || reminderType === 'evening_review'
}

function localDateKey(date, timezone) {
  const parts = localParts(date, timezone)
  return `${parts.year}-${parts.month}-${parts.day}`
}

function contactCadenceLimit(value) {
  if (value === 'light') return 1
  if (value === 'supportive') return 3
  return 2
}

function schedulerReplyFromPayload(payload) {
  const record = asRecord(payload)
  const reply = asRecord(record.reply)
  if (Object.keys(reply).length) return reply
  if (!record.previousPayload) return {}
  return schedulerReplyFromPayload(record.previousPayload)
}

function schedulerContactPolicyFromPayload(payload) {
  const record = asRecord(payload)
  const contactPolicy = asRecord(record.contact_policy)
  if (Object.keys(contactPolicy).length) return contactPolicy
  if (!record.previousPayload) return {}
  return schedulerContactPolicyFromPayload(record.previousPayload)
}

function isExplicitContactOptOut(reply, consentUpdatedAt) {
  const feedback = asRecord(reply.feedback)
  const text = String(reply.text || feedback.userFeedback || '')
  if (!/(别提醒|不要提醒|停止提醒|暂停提醒|别催|不要催|别烦|关闭提醒)/i.test(text)) return false
  const repliedAt = new Date(String(reply.processedAt || 0))
  const consentAt = new Date(String(consentUpdatedAt || 0))
  if (Number.isNaN(repliedAt.getTime()) || Number.isNaN(consentAt.getTime())) return true
  return repliedAt.getTime() >= consentAt.getTime()
}

async function loadContactContext(rule, binding, info, now) {
  const metadata = asRecord(rule.metadata)
  const sentWindowStart = new Date(now.getTime() - 36 * 60 * 60 * 1000)
  const historyWindowStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const activityWindowStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const goal = await prisma.goal.findFirst({
    where: rule.goalId
      ? { id: rule.goalId, userId: rule.userId }
      : { userId: rule.userId, isCurrentFocus: true },
    include: {
      conditions: true,
      dailyActions: { orderBy: { actionDate: 'desc' }, take: 14 },
      checkins: { orderBy: { createdAt: 'desc' }, take: 10 },
      reviews: { orderBy: { createdAt: 'desc' }, take: 5 },
      diagnoses: { orderBy: { createdAt: 'desc' }, take: 10 },
    },
  })
  const [settings, recentSchedulerEvents, sentWindowEvents, recentInbound] = await Promise.all([
    prisma.userSetting.findUnique({ where: { userId: rule.userId } }),
    prisma.schedulerEvent.findMany({
      where: {
        userId: rule.userId,
        channel: rule.channel,
        status: { in: ['sent', 'responded'] },
        createdAt: { gte: historyWindowStart },
      },
      orderBy: { createdAt: 'desc' },
      take: 24,
    }),
    prisma.schedulerEvent.findMany({
      where: {
        userId: rule.userId,
        channel: rule.channel,
        status: { in: ['sent', 'responded'] },
        sentAt: { gte: sentWindowStart },
      },
      orderBy: { sentAt: 'desc' },
    }),
    binding ? prisma.qqMessageEvent.findFirst({
      where: {
        userId: rule.userId,
        contextType: binding.contextType,
        contextId: binding.contextId,
      },
      orderBy: { createdAt: 'desc' },
    }) : Promise.resolve(null),
  ])

  const notifications = asRecord(settings?.notifications)
  const cadence = String(notifications.proactive_contact_cadence || metadata.cadence || 'balanced')
  const consentUpdatedAt = metadata.consentUpdatedAt || notifications.proactive_contact_consent_updated_at
  let unansweredCount = 0
  for (const schedulerEvent of recentSchedulerEvents) {
    if (schedulerEvent.status === 'responded') break
    if (schedulerEvent.status === 'sent') unansweredCount += 1
  }

  const latestSchedulerEvent = recentSchedulerEvents[0]
  const responseWindowHours = Math.max(1, Number(process.env.QQ_SCHEDULER_REPLY_WINDOW_HOURS || '18'))
  const awaitingReplyUntil = latestSchedulerEvent?.status === 'sent' && latestSchedulerEvent.sentAt
    ? new Date(latestSchedulerEvent.sentAt.getTime() + responseWindowHours * 60 * 60 * 1000)
    : null
  const userOptedOut = recentSchedulerEvents.some((schedulerEvent) => (
    schedulerEvent.status === 'responded'
    && isExplicitContactOptOut(schedulerReplyFromPayload(schedulerEvent.payload), consentUpdatedAt)
  ))
  const sentTodayCount = sentWindowEvents.filter((schedulerEvent) => (
    schedulerEvent.sentAt
    && localDateKey(schedulerEvent.sentAt, info.timezone) === info.localDate
  )).length
  const sentForRuleTodayCount = sentWindowEvents.filter((schedulerEvent) => (
    schedulerEvent.reminderRuleId === rule.id
    && schedulerEvent.sentAt
    && localDateKey(schedulerEvent.sentAt, info.timezone) === info.localDate
  )).length
  const wakeupCount = recentSchedulerEvents.filter((schedulerEvent) => {
    return schedulerContactPolicyFromPayload(schedulerEvent.payload).channelMode === 'c2c_wakeup'
  }).length
  const latestInboundPayload = asRecord(recentInbound?.payload)
  const todayActions = (goal?.dailyActions || []).filter((action) => (
    localDateKey(action.actionDate, info.timezone) === info.localDate
  ))
  const completedAction = todayActions.find((action) => action.status === 'DONE') || null
  const futureAction = (goal?.dailyActions || [])
    .filter((action) => localDateKey(action.actionDate, info.timezone) > info.localDate)
    .sort((left, right) => left.actionDate.getTime() - right.actionDate.getTime())[0] || null
  const currentAction = completedAction
    || todayActions.find((action) => !['SKIPPED', 'REPLACED'].includes(action.status))
    || futureAction
    || null
  const actionDateKey = currentAction ? localDateKey(currentAction.actionDate, info.timezone) : ''
  const actionWindowState = !currentAction
    ? 'missing'
    : actionDateKey === info.localDate
      ? 'today'
      : actionDateKey > info.localDate
        ? 'future'
        : 'outside'
  const latestRespondedEvent = recentSchedulerEvents.find((schedulerEvent) => schedulerEvent.status === 'responded')
  const latestReply = latestRespondedEvent ? schedulerReplyFromPayload(latestRespondedEvent.payload) : {}
  const recentFeedbackAt = latestReply.processedAt || latestRespondedEvent?.updatedAt || null
  const recentFeedback = asRecord(latestReply.feedback)
  const recentActivityCount = [
    ...(goal?.checkins || []).filter((checkin) => checkin.createdAt >= activityWindowStart),
    ...(goal?.reviews || []).filter((review) => review.createdAt >= activityWindowStart),
  ].length
  const openGapCount = (goal?.conditions || []).filter((condition) => (
    condition.status === 'MISSING' || condition.status === 'PARTIAL'
  )).length
  const latestCheckinAt = goal?.checkins?.[0]?.createdAt || null
  const latestPromptDiagnosis = (goal?.diagnoses || []).find((diagnosis) => (
    String(diagnosis.category || '').toUpperCase() === 'PROMPT'
    && String(diagnosis.adjustmentType || '').toUpperCase() === 'RESCHEDULE'
  )) || null
  const promptSignalActive = Boolean(
    latestPromptDiagnosis
    && (
      !latestCheckinAt
      || latestPromptDiagnosis.createdAt.getTime() >= latestCheckinAt.getTime()
    )
  )

  return {
    activeContactConsent: notifications.proactive_contact_enabled === true,
    maxDailyContacts: contactCadenceLimit(cadence),
    noResponsePauseAfter: Math.max(1, Number(notifications.proactive_contact_pause_after || 3)),
    unansweredCount,
    awaitingReplyUntil,
    sentTodayCount,
    sentForRuleTodayCount,
    goal,
    currentAction,
    actionWindowState,
    todayActionCompleted: Boolean(completedAction),
    completedActionGoalId: completedAction?.goalId || '',
    openGapCount,
    recentActivityCount,
    recentFeedbackAt,
    recentFeedbackResult: recentFeedback.result || '',
    recentFeedbackCooldownMinutes: Math.max(0, Number(notifications.proactive_contact_feedback_cooldown_minutes || 180)),
    promptSignalActive,
    promptSignalCategory: latestPromptDiagnosis?.category || '',
    promptSignalAdjustmentType: latestPromptDiagnosis?.adjustmentType || '',
    promptSignalCreatedAt: latestPromptDiagnosis?.createdAt || null,
    promptSignalEvidence: latestPromptDiagnosis?.evidence || '',
    promptSignalProposedNextAction: latestPromptDiagnosis?.proposedNextAction || '',
    latestInboundAt: recentInbound?.createdAt || null,
    sourceMessageId: latestInboundPayload.id || recentInbound?.replyMessageId || '',
    c2cWakeupEligible: wakeupCount < 4,
    userOptedOut,
    cadence,
  }
}

function formatScheduledMessage(reminderType, rawMessage, action) {
  if (!action) return rawMessage

  const title = action.title || '今天的下一步'
  const doneWhen = action.doneWhen || '留下一个可以证明推进过的结果。'
  const minimumStep = action.minimumStep || '先做最小启动版本。'
  const fallbackAction = action.fallbackAction || '如果状态差，就把动作缩小。'

  if (reminderType === 'morning_planning') {
    return [
      `早上好。今天只做：${title}`,
      `完成标准：${doneWhen}`,
      `最小启动：${minimumStep}`,
      '',
      rawMessage,
    ].filter(Boolean).join('\n')
  }

  if (reminderType === 'midday_check') {
    return [
      `中午检查一下：今天这一步是「${title}」。`,
      '现在是：已开始、已完成、还没开始，还是需要缩小？',
      `做不动的话就执行：${fallbackAction}`,
      '',
      rawMessage,
    ].filter(Boolean).join('\n')
  }

  if (reminderType === 'evening_review') {
    return [
      `晚上复盘：今天这一步是「${title}」。`,
      '完成了吗？如果没完成，更像是动机、能力、提醒，还是路径问题？',
      `完成标准：${doneWhen}`,
      '',
      rawMessage,
    ].filter(Boolean).join('\n')
  }

  return rawMessage
}

function fallbackReminderText(reminderType, goalContext) {
  if (reminderType === 'morning_planning') {
    return `早上好。我们今天只确认一件事：基于当前目标，今天最小可推进的一步是什么？\n\n${trimForPrompt(goalContext, 500)}`
  }
  if (reminderType === 'midday_check') {
    return '中午检查一下：今天那一步现在是已经开始、还没开始，还是需要缩小？只回复一个状态就行。'
  }
  if (reminderType === 'evening_review') {
    return '晚上复盘一下：今天那一步完成了吗？如果没完成，更像是目标不想做、动作太难、提醒不对，还是路径设计错了？'
  }
  return '本周复盘：这周真正推进了哪个目标条件？下周只保留一个最关键动作，会是什么？'
}

async function generateReminderText(userId, reminderType) {
  const goalContext = await buildGoalContext(userId)
  const modelConfig = await prisma.modelConfig.findFirst({
    where: { userId, isDefault: true },
    orderBy: { createdAt: 'asc' },
  })
  const apiKey = resolveModelApiKey(modelConfig)
  if (!apiKey) return fallbackReminderText(reminderType, goalContext)

  const modelName = String(modelConfig?.model || process.env.GOAL_MATE_MODEL || 'gpt-5-nano')
  const modelApiBase = String(modelConfig?.apiBase || process.env.GOAL_MATE_MODEL_API_BASE || 'https://api.b.ai').replace(/\/+$/, '')
  const reminderInstruction = {
    morning_planning: '早晨规划：只问今天最小可推进的一步。',
    midday_check: '中午检查：只判断是否偏离，以及要不要缩小动作。',
    evening_review: '晚上复盘：只问完成情况和未完成原因。',
    weekly_review: '周复盘：只问本周推进了哪个条件，以及下周保留哪个关键动作。',
  }[reminderType] || '目标推进提醒：只问一个关键问题。'

  try {
    const response = await fetchModelProvider(chatCompletionsUrl(modelApiBase), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: modelName,
        temperature: modelConfig?.temperature ?? 0.3,
        max_tokens: 260,
        messages: [
          {
            role: 'system',
            content: [
              '你是 Goal Mate 的主动推进秘书。',
              '输出要像真人助手发 QQ 消息，不要像系统通知。',
              '一次只问一个关键问题。',
              '不要说你已经修改了目标、日志或设置。',
              reminderInstruction,
              '',
              '当前上下文：',
              goalContext,
            ].join('\n'),
          },
        ],
      }),
    })
    if (!response.ok) return fallbackReminderText(reminderType, goalContext)
    const data = await response.json()
    return data?.choices?.[0]?.message?.content?.trim() || fallbackReminderText(reminderType, goalContext)
  } catch {
    return fallbackReminderText(reminderType, goalContext)
  }
}

async function findOrCreateSchedulerThread(userId, binding) {
  const title = `QQ scheduler ${binding.contextType} ${binding.contextId}`
  const existing = await prisma.agentThread.findFirst({ where: { userId, title, status: 'ACTIVE' } })
  if (existing) return existing
  const goal = await prisma.goal.findFirst({ where: { userId, isCurrentFocus: true } })
  return prisma.agentThread.create({ data: { userId, goalId: goal?.id, title } })
}

async function createPendingEvent(rule, info, now = new Date()) {
  try {
    return await prisma.schedulerEvent.create({
      data: {
        userId: rule.userId,
        reminderRuleId: rule.id,
        eventType: rule.reminderType,
        channel: rule.channel,
        dueKey: info.dueKey,
        scheduledFor: now,
        status: 'pending',
        payload: { schedule: rule.schedule, timezone: info.timezone, localDate: info.localDate },
      },
    })
  } catch (error) {
    if (error?.code === 'P2002') return null
    throw error
  }
}

function evaluateRuleContactPolicy({
  rule,
  binding,
  info,
  now,
  contactContext,
  authorizedContextId,
  authorizedContextType,
  contextAuthorizationAmbiguous,
}) {
  return evaluateQqContactPolicy({
    now,
    rule,
    binding,
    authorizedContextId,
    authorizedContextType,
    contextAuthorizationAmbiguous,
    activeContactConsent: contactContext.activeContactConsent,
    inQuietHours: info.quiet,
    quietHoursEndAt: info.quietHoursEndAt,
    localWeekday: info.localWeekday,
    cadence: contactContext.cadence,
    goal: contactContext.goal,
    currentAction: contactContext.currentAction,
    actionWindowState: contactContext.actionWindowState,
    todayActionCompleted: contactContext.todayActionCompleted,
    completedActionGoalId: contactContext.completedActionGoalId,
    openGapCount: contactContext.openGapCount,
    recentActivityCount: contactContext.recentActivityCount,
    recentFeedbackAt: contactContext.recentFeedbackAt,
    recentFeedbackResult: contactContext.recentFeedbackResult,
    recentFeedbackCooldownMinutes: contactContext.recentFeedbackCooldownMinutes,
    promptSignalActive: contactContext.promptSignalActive,
    promptSignalCategory: contactContext.promptSignalCategory,
    promptSignalAdjustmentType: contactContext.promptSignalAdjustmentType,
    promptSignalCreatedAt: contactContext.promptSignalCreatedAt,
    promptSignalEvidence: contactContext.promptSignalEvidence,
    promptSignalProposedNextAction: contactContext.promptSignalProposedNextAction,
    sentTodayCount: contactContext.sentTodayCount,
    sentForRuleTodayCount: contactContext.sentForRuleTodayCount,
    maxDailyContacts: contactContext.maxDailyContacts,
    unansweredCount: contactContext.unansweredCount,
    noResponsePauseAfter: contactContext.noResponsePauseAfter,
    awaitingReplyUntil: contactContext.awaitingReplyUntil,
    latestInboundAt: contactContext.latestInboundAt,
    sourceMessageId: contactContext.sourceMessageId,
    c2cWakeupEligible: contactContext.c2cWakeupEligible,
    userOptedOut: contactContext.userOptedOut,
  })
}

async function processRule(rule, options = {}) {
  const now = options.now || new Date()
  const retryEvent = options.retryEvent || null
  const info = retryEvent
    ? deferredDueInfo(rule, retryEvent, now)
    : dueInfo(rule, now, options.forceReminderType || '')
  if (!info.due) return null

  const event = retryEvent || await createPendingEvent(rule, info, now)
  if (!event) return null

  const ruleMetadata = asRecord(rule.metadata)
  const authorizedContextId = String(
    ruleMetadata.qqContextId
      || asRecord(ruleMetadata.contactConsent).qqContextId
      || asRecord(ruleMetadata.contactConsent).contextId
      || '',
  )
  const authorizedContextType = String(
    ruleMetadata.qqContextType
      || asRecord(ruleMetadata.contactConsent).qqContextType
      || asRecord(ruleMetadata.contactConsent).contextType
      || '',
  ).toLowerCase()
  const candidateBindings = authorizedContextId
    ? await prisma.qqChatBinding.findMany({
        where: {
          userId: rule.userId,
          status: 'ENABLED',
          contextId: authorizedContextId,
          ...(authorizedContextType ? { contextType: authorizedContextType } : {}),
        },
        orderBy: { updatedAt: 'desc' },
        take: 2,
      })
    : []
  const contextAuthorizationAmbiguous = !authorizedContextType && candidateBindings.length > 1
  const binding = contextAuthorizationAmbiguous ? null : candidateBindings[0] || null
  let contactContext = await loadContactContext(rule, binding, info, now)
  let contactPolicy = evaluateRuleContactPolicy({
    rule,
    binding,
    info,
    now,
    contactContext,
    authorizedContextId,
    authorizedContextType,
    contextAuthorizationAmbiguous,
  })

  if (
    shouldEnsureTodayAction(rule.reminderType)
    && contactPolicy.action === QQ_CONTACT_ACTION.SKIP
    && contactPolicy.reasonCode === 'no_current_action'
  ) {
    await ensureTodayAction(prisma, rule.userId)
    contactContext = await loadContactContext(rule, binding, info, now)
    contactPolicy = evaluateRuleContactPolicy({
      rule,
      binding,
      info,
      now,
      contactContext,
      authorizedContextId,
      authorizedContextType,
      contextAuthorizationAmbiguous,
    })
  }

  const previousEventPayload = asRecord(event.payload)
  const eventPayloadWithoutRetry = { ...previousEventPayload }
  delete eventPayloadWithoutRetry.retry
  const previousContactPolicy = asRecord(previousEventPayload.contact_policy)
  const existingDeferHistory = Array.isArray(previousEventPayload.defer_history)
    ? previousEventPayload.defer_history
    : []
  const deferHistory = Object.keys(previousContactPolicy).length
    ? [
        ...existingDeferHistory,
        {
          evaluatedAt: asDate(event.updatedAt || event.createdAt || now)?.toISOString() || now.toISOString(),
          scheduledFor: asDate(event.scheduledFor)?.toISOString() || null,
          contactPolicy: previousContactPolicy,
        },
      ]
    : existingDeferHistory
  const schedulerPayload = {
    ...eventPayloadWithoutRetry,
    contact_policy: contactPolicy,
    ...(deferHistory.length ? { defer_history: deferHistory } : {}),
    contact_context: {
      cadence: contactContext.cadence,
      sentTodayCount: contactContext.sentTodayCount,
      sentForRuleTodayCount: contactContext.sentForRuleTodayCount,
      unansweredCount: contactContext.unansweredCount,
      todayActionCompleted: contactContext.todayActionCompleted,
      completedActionGoalId: contactContext.completedActionGoalId,
      goalId: contactContext.goal?.id || null,
      goalStatus: contactContext.goal?.status || null,
      currentActionId: contactContext.currentAction?.id || null,
      currentActionStatus: contactContext.currentAction?.status || null,
      actionWindowState: contactContext.actionWindowState,
      openGapCount: contactContext.openGapCount,
      recentActivityCount: contactContext.recentActivityCount,
      recentFeedbackAt: contactContext.recentFeedbackAt,
      promptSignalActive: contactContext.promptSignalActive,
      promptSignalCategory: contactContext.promptSignalCategory || null,
      promptSignalAdjustmentType: contactContext.promptSignalAdjustmentType || null,
      promptSignalCreatedAt: contactContext.promptSignalCreatedAt || null,
      promptSignalProposedNextAction: contactContext.promptSignalProposedNextAction || null,
      authorizedContextId: authorizedContextId || null,
      authorizedContextType: authorizedContextType || null,
      contextAuthorizationAmbiguous,
      hasRecentInbound: Boolean(contactContext.latestInboundAt),
    },
  }

  await recordAgentToolActionWithPrisma(prisma, {
    context: { userId: rule.userId, source: 'scheduler' },
    toolName: 'reminder.evaluate',
    permission: 'execute',
    inputSummary: `${rule.reminderType} -> ${contactPolicy.action}:${contactPolicy.reasonCode}`,
    input: { reminderRuleId: rule.id, schedulerEventId: event.id },
    result: { contact_policy: contactPolicy },
    targetType: 'reminder',
    targetId: rule.id,
    riskLevel: 'low',
    requiresConfirmation: false,
    status: 'executed',
  })

  if (contactPolicy.action !== QQ_CONTACT_ACTION.SEND) {
    const retryAt = contactPolicy.action === QQ_CONTACT_ACTION.DEFER
      ? deferredRetryAt(contactPolicy, now)
      : null
    const finalPayload = retryAt
      ? {
          ...schedulerPayload,
          retry: {
            scheduledFor: retryAt.toISOString(),
            reasonCode: contactPolicy.reasonCode,
            recheckFullContactPolicy: true,
          },
        }
      : schedulerPayload
    await prisma.schedulerEvent.update({
      where: { id: event.id },
      data: {
        status: contactPolicy.action === QQ_CONTACT_ACTION.DEFER ? 'deferred' : 'skipped',
        ...(retryAt ? { scheduledFor: retryAt } : {}),
        payload: finalPayload,
        errorMessage: null,
      },
    })
    if (contactPolicy.shouldPauseAll) {
      await pauseQqProactiveContact(prisma, rule.userId, {
        reasonCode: contactPolicy.reasonCode,
        now,
      })
    }
    console.log(`[scheduler] ${contactPolicy.action} ${rule.reminderType}; reason=${contactPolicy.reasonCode}`)
    return { eventId: event.id, contactPolicy }
  }

  const thread = await findOrCreateSchedulerThread(rule.userId, binding)
  const interventionDecision = await planIntervention(prisma, rule.userId, {
    reminderType: rule.reminderType,
    reminderRule: rule,
    now,
    contactPolicy,
    contactContext,
  })
  const todayAction = contactContext.actionWindowState === 'today'
    ? contactContext.currentAction
    : null
  const rawMessageText = interventionDecision.question_or_message || await generateReminderText(rule.userId, rule.reminderType)
  const messageText = formatScheduledMessage(rule.reminderType, rawMessageText, todayAction)
  const sentSchedulerPayload = {
    ...schedulerPayload,
    intervention_decision: interventionDecision,
  }
  const assistantMessage = await prisma.agentMessage.create({
    data: {
      userId: rule.userId,
      threadId: thread.id,
      role: 'ASSISTANT',
      content: messageText,
      structuredOutputType: 'scheduler_reminder',
      structuredOutput: {
        reminderType: rule.reminderType,
        reminderRuleId: rule.id,
        schedulerEventId: event.id,
        channel: rule.channel,
        channel_mode: contactPolicy.channelMode,
        planner_source: interventionDecision.planner_source,
        contact_policy: contactPolicy,
        intervention_decision: interventionDecision,
      },
    },
  })
  await prisma.agentThread.update({ where: { id: thread.id }, data: { updatedAt: new Date() } })

  try {
    const sent = await sendQqMessage(binding, messageText, contactPolicy)
    await prisma.schedulerEvent.update({
      where: { id: event.id },
      data: {
        status: 'sent',
        messageText,
        sentAt: new Date(),
        agentThreadId: thread.id,
        agentMessageId: assistantMessage.id,
        externalMessageId: String(sent?.id || sent?.message_id || sent?.data?.id || ''),
        payload: sentSchedulerPayload,
        errorMessage: null,
      },
    })
    await recordAgentToolActionWithPrisma(prisma, {
      context: { userId: rule.userId, source: 'scheduler', agentThreadId: thread.id, agentMessageId: assistantMessage.id },
      toolName: 'reminder.send',
      permission: 'execute',
      inputSummary: `${rule.reminderType} -> qq:${contactPolicy.channelMode}`,
      input: { reminderRuleId: rule.id, schedulerEventId: event.id, contact_policy: contactPolicy, intervention_decision: interventionDecision },
      result: { qq: sent || {}, contact_policy: contactPolicy, intervention_decision: interventionDecision },
      targetType: 'reminder',
      targetId: rule.id,
      riskLevel: 'low',
      requiresConfirmation: false,
      status: 'executed',
    })
    console.log(`[scheduler] sent ${rule.reminderType} to qq:${binding.contextType}:${binding.contextId}`)
    return { eventId: event.id, contactPolicy, sent }
  } catch (error) {
    await prisma.schedulerEvent.update({
      where: { id: event.id },
      data: {
        status: 'failed',
        messageText,
        agentThreadId: thread.id,
        agentMessageId: assistantMessage.id,
        payload: sentSchedulerPayload,
        errorMessage: error instanceof Error ? error.message : String(error),
      },
    })
    await recordAgentToolActionWithPrisma(prisma, {
      context: { userId: rule.userId, source: 'scheduler', agentThreadId: thread.id, agentMessageId: assistantMessage.id },
      toolName: 'reminder.send',
      permission: 'execute',
      inputSummary: `${rule.reminderType} -> qq:${contactPolicy.channelMode}`,
      input: { reminderRuleId: rule.id, schedulerEventId: event.id, contact_policy: contactPolicy, intervention_decision: interventionDecision },
      targetType: 'reminder',
      targetId: rule.id,
      riskLevel: 'low',
      requiresConfirmation: false,
      status: 'failed',
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    console.error(`[scheduler] failed ${rule.reminderType}`, error)
    return { eventId: event.id, contactPolicy, error }
  }
}

async function processDueDeferredEvents(options = {}) {
  const now = options.now || new Date()
  const deferredEvents = await prisma.schedulerEvent.findMany({
    where: {
      channel: 'qq',
      status: 'deferred',
      scheduledFor: { lte: now },
      ...(options.userId ? { userId: options.userId } : {}),
    },
    orderBy: { scheduledFor: 'asc' },
    take: 100,
  })

  for (const event of deferredEvents) {
    const claim = await prisma.schedulerEvent.updateMany({
      where: {
        id: event.id,
        status: 'deferred',
        scheduledFor: { lte: now },
      },
      data: { status: 'pending' },
    })
    if (claim.count !== 1) continue

    const rule = event.reminderRuleId
      ? await prisma.reminderRule.findFirst({
          where: { id: event.reminderRuleId, userId: event.userId },
        })
      : null
    if (!rule) {
      await prisma.schedulerEvent.update({
        where: { id: event.id },
        data: {
          status: 'skipped',
          payload: {
            ...asRecord(event.payload),
            contact_policy: {
              action: 'skip',
              reasonCode: 'rule_missing',
              channelMode: null,
              nextEligibleAt: null,
              shouldPauseAll: false,
              sendOptions: null,
              evidence: {},
            },
          },
        },
      })
      continue
    }

    try {
      await processRule(rule, {
        ...options,
        retryEvent: { ...event, status: 'pending' },
      })
    } catch (error) {
      const retryAt = new Date(now.getTime() + 60 * 60 * 1000)
      await prisma.schedulerEvent.update({
        where: { id: event.id },
        data: {
          status: 'deferred',
          scheduledFor: retryAt,
          errorMessage: error instanceof Error ? error.message : String(error),
          payload: {
            ...asRecord(event.payload),
            retry: {
              scheduledFor: retryAt.toISOString(),
              reasonCode: 'retry_processing_failed',
              recheckFullContactPolicy: true,
            },
          },
        },
      })
      console.error(`[scheduler] deferred retry failed for ${event.id}`, error)
    }
  }
}

async function tick(options = {}) {
  await touchRuntimeHeartbeat(prisma, {
    service: 'scheduler-worker',
    status: options.forceReminderType ? 'forced_tick' : 'running',
    detail: options.forceReminderType ? `强制触发 ${options.forceReminderType}` : 'Scheduler Worker 正在扫描提醒规则。',
    payload: { tickSeconds, timezone: defaultTimezone, forceReminderType: options.forceReminderType || '' },
  })
  await ensureDefaultRulesForBoundUsers()
  await processDueDeferredEvents(options)
  const rules = await prisma.reminderRule.findMany({
    where: {
      enabled: true,
      channel: 'qq',
      ...(options.userId ? { userId: options.userId } : {}),
    },
    orderBy: { createdAt: 'asc' },
  })
  for (const rule of rules) {
    await processRule(rule, options)
  }
}

async function main() {
  console.log(`[scheduler] started; tick=${tickSeconds}s timezone=${defaultTimezone}${runOnce ? ' mode=once' : ''}${forcedReminderType ? ` force=${forcedReminderType}` : ''}`)
  await touchRuntimeHeartbeat(prisma, {
    service: 'scheduler-worker',
    status: runOnce ? 'run_once' : 'started',
    detail: runOnce ? 'Scheduler Worker 正在执行一次性验证。' : 'Scheduler Worker 已启动。',
    payload: { tickSeconds, timezone: defaultTimezone, runOnce, forcedReminderType },
  })
  if (runOnce) {
    await tick({ forceReminderType: forcedReminderType })
    await touchRuntimeHeartbeat(prisma, {
      service: 'scheduler-worker',
      status: 'run_once_done',
      detail: 'Scheduler Worker 一次性验证已结束。',
      payload: { forcedReminderType },
    })
    await prisma.$disconnect()
    return
  }
  while (!stopping) {
    try {
      await tick()
    } catch (error) {
      console.error('[scheduler] tick failed', error)
    }
    await sleep(Math.max(5, tickSeconds) * 1000)
  }
}

function isDirectRun() {
  const entry = process.argv[1]
  return Boolean(entry && import.meta.url === pathToFileURL(resolvePath(entry)).href)
}

export {
  dueInfo,
  processRule,
  tick,
}

export async function closeSchedulerWorker() {
  await prisma.$disconnect()
}

if (isDirectRun()) {
  process.on('SIGINT', async () => {
    stopping = true
    await touchRuntimeHeartbeat(prisma, {
      service: 'scheduler-worker',
      status: 'stopping',
      detail: 'Scheduler Worker 正在停止。',
    })
    await prisma.$disconnect()
    process.exit(0)
  })

  process.on('SIGTERM', async () => {
    stopping = true
    await touchRuntimeHeartbeat(prisma, {
      service: 'scheduler-worker',
      status: 'stopping',
      detail: 'Scheduler Worker 正在停止。',
    })
    await prisma.$disconnect()
    process.exit(0)
  })

  main().catch(async (error) => {
    console.error('[scheduler] fatal', error)
    await prisma.$disconnect()
    process.exit(1)
  })
}
