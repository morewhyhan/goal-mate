import { PrismaClient } from '@prisma/client'
import { existsSync, readFileSync } from 'node:fs'
import {
  recordAgentToolActionWithPrisma,
} from '../lib/agent-tool-executor.mjs'
import { planIntervention } from '../lib/intervention-planner.mjs'
import { resolveModelApiKey } from '../lib/model-secret.mjs'

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

const apiBase = (process.env.QQ_BOT_API_BASE || 'https://api.sgroup.qq.com').replace(/\/+$/, '')
const appId = process.env.QQ_BOT_APP_ID || ''
const token = process.env.QQ_BOT_TOKEN || ''
const tickSeconds = Number(process.env.SCHEDULER_TICK_SECONDS || '60')
const defaultTimezone = process.env.SCHEDULER_TIMEZONE || 'Asia/Shanghai'
const runOnce = process.argv.includes('--once') || process.env.SCHEDULER_RUN_ONCE === '1'
const forceReminderArg = process.argv.find((arg) => arg.startsWith('--force-reminder='))
const forcedReminderType = forceReminderArg?.split('=')[1] || process.env.SCHEDULER_FORCE_REMINDER || ''
const defaultRules = [
  { reminderType: 'morning_planning', schedule: process.env.SCHEDULER_MORNING_TIME || '08:30', maxPerDay: 1, quietHours: '23:00-07:30' },
  { reminderType: 'midday_check', schedule: process.env.SCHEDULER_MIDDAY_TIME || '12:30', maxPerDay: 1, quietHours: '23:00-07:30' },
  { reminderType: 'evening_review', schedule: process.env.SCHEDULER_EVENING_TIME || '21:30', maxPerDay: 1, quietHours: '23:00-07:30' },
  { reminderType: 'weekly_review', schedule: process.env.SCHEDULER_WEEKLY_TIME || 'SUN 21:00', maxPerDay: 1, quietHours: '23:00-07:30' },
]

let cachedAccessToken = ''
let accessTokenExpiresAt = 0
let stopping = false

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function trimForPrompt(value, max = 900) {
  return value.length > max ? `${value.slice(0, max)}...` : value
}

function assertConfig() {
  if (!appId || !token) {
    throw new Error('QQ_BOT_APP_ID and QQ_BOT_TOKEN are required')
  }
}

function hasQqConfig() {
  return Boolean(appId && token)
}

async function getAppAccessToken() {
  if (cachedAccessToken && Date.now() < accessTokenExpiresAt - 60_000) return cachedAccessToken

  const response = await fetch('https://bots.qq.com/app/getAppAccessToken', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ appId, clientSecret: token }),
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

async function qqRequest(method, path, body) {
  const accessToken = await getAppAccessToken()
  const response = await fetch(`${apiBase}${path}`, {
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

function messageBody(content, sourceMessageId) {
  const body = {
    msg_type: 0,
    content,
    msg_seq: Math.floor(Date.now() % 2_000_000_000),
  }
  if (sourceMessageId) body.msg_id = sourceMessageId
  return body
}

async function sendQqMessage(binding, content) {
  const latestEvent = await prisma.qqMessageEvent.findFirst({
    where: { contextType: binding.contextType, contextId: binding.contextId },
    orderBy: { createdAt: 'desc' },
  })
  const sourceMessageId = latestEvent?.payload?.id || latestEvent?.replyMessageId || undefined

  if (binding.contextType === 'c2c') {
    return qqRequest('POST', `/v2/users/${binding.contextId}/messages`, messageBody(content, sourceMessageId))
  }
  if (binding.contextType === 'group') {
    return qqRequest('POST', `/v2/groups/${binding.contextId}/messages`, messageBody(content, sourceMessageId))
  }
  return qqRequest('POST', `/channels/${binding.contextId}/messages`, {
    content,
    msg_id: sourceMessageId,
  })
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
  if (forceReminderType && forceReminderType === rule.reminderType) {
    return {
      due: true,
      dueKey: `${dateKey}:${rule.reminderType}:forced:${Date.now()}`,
      localDate: dateKey,
      timezone,
      forced: true,
      quiet,
    }
  }
  return {
    due,
    dueKey: `${dateKey}:${rule.reminderType}`,
    localDate: dateKey,
    timezone,
    quiet,
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
          metadata: { source: 'scheduler_default' },
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

  const modelName = String(modelConfig?.model || process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash')
  const modelApiBase = String(modelConfig?.apiBase || process.env.DEEPSEEK_API_BASE || 'https://api.deepseek.com').replace(/\/+$/, '')
  const reminderInstruction = {
    morning_planning: '早晨规划：只问今天最小可推进的一步。',
    midday_check: '中午检查：只判断是否偏离，以及要不要缩小动作。',
    evening_review: '晚上复盘：只问完成情况和未完成原因。',
    weekly_review: '周复盘：只问本周推进了哪个条件，以及下周保留哪个关键动作。',
  }[reminderType] || '目标推进提醒：只问一个关键问题。'

  try {
    const response = await fetch(`${modelApiBase}/chat/completions`, {
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

async function createPendingEvent(rule, info) {
  try {
    return await prisma.schedulerEvent.create({
      data: {
        userId: rule.userId,
        reminderRuleId: rule.id,
        eventType: rule.reminderType,
        channel: rule.channel,
        dueKey: info.dueKey,
        scheduledFor: new Date(),
        status: 'pending',
        payload: { schedule: rule.schedule, timezone: info.timezone, localDate: info.localDate },
      },
    })
  } catch (error) {
    if (error?.code === 'P2002') return null
    throw error
  }
}

async function processRule(rule, options = {}) {
  const info = dueInfo(rule, new Date(), options.forceReminderType || '')
  if (!info.due) return
  if (info.quiet && !info.forced) {
    console.log(`[scheduler] skipped ${rule.reminderType}; quietHours=${quietHoursRange(rule.quietHours)}`)
    return
  }

  const sentSince = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const sentCount = await prisma.schedulerEvent.count({
    where: {
      userId: rule.userId,
      reminderRuleId: rule.id,
      channel: rule.channel,
      status: 'sent',
      sentAt: { gte: sentSince },
    },
  })
  if (sentCount >= Math.max(1, rule.maxPerDay || 1) && !info.forced) {
    console.log(`[scheduler] skipped ${rule.reminderType}; maxPerDay=${rule.maxPerDay}`)
    return
  }

  const event = await createPendingEvent(rule, info)
  if (!event) return

  const binding = await prisma.qqChatBinding.findFirst({
    where: { userId: rule.userId, status: 'ENABLED' },
    orderBy: { updatedAt: 'desc' },
  })
  if (!binding) {
    await prisma.schedulerEvent.update({
      where: { id: event.id },
      data: { status: 'failed', errorMessage: 'No enabled QQ binding.' },
    })
    return
  }

  const thread = await findOrCreateSchedulerThread(rule.userId, binding)
  const interventionDecision = await planIntervention(prisma, rule.userId, {
    reminderType: rule.reminderType,
    reminderRule: rule,
    now: new Date(),
  })
  const messageText = interventionDecision.question_or_message || await generateReminderText(rule.userId, rule.reminderType)
  const schedulerPayload = {
    ...(event.payload || {}),
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
        planner_source: interventionDecision.planner_source,
        intervention_decision: interventionDecision,
      },
    },
  })
  await prisma.agentThread.update({ where: { id: thread.id }, data: { updatedAt: new Date() } })

  try {
    const sent = await sendQqMessage(binding, messageText)
    await prisma.schedulerEvent.update({
      where: { id: event.id },
      data: {
        status: 'sent',
        messageText,
        sentAt: new Date(),
        agentThreadId: thread.id,
        agentMessageId: assistantMessage.id,
        externalMessageId: String(sent?.id || sent?.message_id || sent?.data?.id || ''),
        payload: schedulerPayload,
      },
    })
    await recordAgentToolActionWithPrisma(prisma, {
      context: { userId: rule.userId, source: 'scheduler', agentThreadId: thread.id, agentMessageId: assistantMessage.id },
      toolName: 'reminder.send',
      permission: 'execute',
      inputSummary: `${rule.reminderType} -> qq`,
      input: { reminderRuleId: rule.id, schedulerEventId: event.id, intervention_decision: interventionDecision },
      result: { qq: sent || {}, intervention_decision: interventionDecision },
      targetType: 'reminder',
      targetId: rule.id,
      riskLevel: 'low',
      requiresConfirmation: false,
      status: 'executed',
    })
    console.log(`[scheduler] sent ${rule.reminderType} to qq:${binding.contextType}:${binding.contextId}`)
  } catch (error) {
    await prisma.schedulerEvent.update({
      where: { id: event.id },
      data: {
        status: 'failed',
        messageText,
        agentThreadId: thread.id,
        agentMessageId: assistantMessage.id,
        payload: schedulerPayload,
        errorMessage: error instanceof Error ? error.message : String(error),
      },
    })
    await recordAgentToolActionWithPrisma(prisma, {
      context: { userId: rule.userId, source: 'scheduler', agentThreadId: thread.id, agentMessageId: assistantMessage.id },
      toolName: 'reminder.send',
      permission: 'execute',
      inputSummary: `${rule.reminderType} -> qq`,
      input: { reminderRuleId: rule.id, schedulerEventId: event.id, intervention_decision: interventionDecision },
      targetType: 'reminder',
      targetId: rule.id,
      riskLevel: 'low',
      requiresConfirmation: false,
      status: 'failed',
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    console.error(`[scheduler] failed ${rule.reminderType}`, error)
  }
}

async function tick(options = {}) {
  await ensureDefaultRulesForBoundUsers()
  const rules = await prisma.reminderRule.findMany({
    where: { enabled: true, channel: 'qq' },
    orderBy: { createdAt: 'asc' },
  })
  for (const rule of rules) {
    await processRule(rule, options)
  }
}

async function main() {
  if (!runOnce || !forcedReminderType) {
    assertConfig()
  } else if (!hasQqConfig()) {
    console.warn('[scheduler] QQ config missing; forced one-shot run can still record no-binding failures, but send attempts will fail.')
  }
  console.log(`[scheduler] started; tick=${tickSeconds}s timezone=${defaultTimezone}${runOnce ? ' mode=once' : ''}${forcedReminderType ? ` force=${forcedReminderType}` : ''}`)
  if (runOnce) {
    await tick({ forceReminderType: forcedReminderType })
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

process.on('SIGINT', async () => {
  stopping = true
  await prisma.$disconnect()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  stopping = true
  await prisma.$disconnect()
  process.exit(0)
})

main().catch(async (error) => {
  console.error('[scheduler] fatal', error)
  await prisma.$disconnect()
  process.exit(1)
})
