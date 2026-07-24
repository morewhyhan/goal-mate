import WebSocket from 'ws'
import { PrismaClient } from '@prisma/client'
import { existsSync, readFileSync } from 'node:fs'
import {
  detectConfirmToolMessage,
  formatAgentToolReply,
} from '../lib/agent-tool-shared.mjs'
import {
  executeAgentToolWithPrisma,
} from '../lib/agent-tool-executor.mjs'
import {
  evaluateFirstGoalTurnWithPrisma,
  generateAgentToolIntentWithPrisma,
  generateAssistantReplyWithPrisma,
} from '../lib/agent-runtime-shared.mjs'
import {
  clearQqBindingCode,
  findQqAccountByBindingCode,
  normalizeQqBindingCode,
  resolveQqBotConfig,
} from '../lib/qq-bot-config.mjs'
import {
  findRecentQqSchedulerEvent,
  processQqSchedulerReply,
} from '../lib/qq-scheduler-reply.mjs'
import {
  buildQqReminderControlToolInput,
  detectQqReminderControlIntent,
  renderQqModelFailure,
  renderQqModelReply,
  renderQqReminderControlResult,
  renderQqToolExecution,
  selectQqReminderRulesForControl,
  shouldPauseAllQqProactiveRules,
} from '../lib/qq-message-renderer.mjs'
import { touchRuntimeHeartbeat } from '../lib/runtime-heartbeat.mjs'

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

let lastSeq = null
let heartbeatTimer = null
let cachedAccessToken = ''
let accessTokenExpiresAt = 0
let currentQqConfig = null
let currentQqConfigSignature = ''
let lastMissingConfigLogAt = 0

function qqConfigSignature(config) {
  return JSON.stringify({
    source: config?.source || '',
    appId: config?.appId || '',
    token: config?.token || '',
    apiBase: config?.apiBase || '',
    intents: config?.intents || '',
    allowedContextIds: config?.allowedContextIds || [],
  })
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function refreshQqConfig() {
  const config = await resolveQqBotConfig(prisma)
  if (!config.configured) {
    await touchRuntimeHeartbeat(prisma, {
      service: 'qq-worker',
      status: 'waiting_config',
      detail: 'QQ Worker 在线，等待 Settings 保存 QQ 配置。',
      payload: { source: config.source || 'settings_required' },
    })
    currentQqConfig = null
    currentQqConfigSignature = ''
    cachedAccessToken = ''
    accessTokenExpiresAt = 0
    const now = Date.now()
    if (now - lastMissingConfigLogAt > 60_000) {
      console.warn('[qq] QQ Bot config missing; worker is alive and waiting for Settings -> QQ configuration.')
      lastMissingConfigLogAt = now
    }
    return null
  }

  const nextSignature = qqConfigSignature(config)
  if (nextSignature !== currentQqConfigSignature) {
    cachedAccessToken = ''
    accessTokenExpiresAt = 0
    currentQqConfigSignature = nextSignature
    console.log(`[qq] loaded config from ${config.source}; apiBase=${config.apiBase}; intents=${config.intents}`)
  }
  await touchRuntimeHeartbeat(prisma, {
    service: 'qq-worker',
    status: 'configured',
    detail: 'QQ Worker 已读取 QQ 配置，准备连接 Gateway。',
    payload: { source: config.source, apiBase: config.apiBase, intents: config.intents },
  })
  currentQqConfig = config
  return config
}

async function requireQqConfig() {
  return currentQqConfig || await refreshQqConfig()
}

const isConfirmToolMessage = detectConfirmToolMessage

const qqDefaultAgentSettings = {
  can_read_goals: true,
  can_read_logs: true,
  memory_enabled: true,
}

const qqDefaultChatModel = {
  provider: process.env.GOAL_MATE_MODEL_PROVIDER || 'B.AI',
  model: process.env.GOAL_MATE_MODEL || 'gpt-5-nano',
  apiBase: process.env.GOAL_MATE_MODEL_API_BASE || 'https://api.b.ai',
  temperature: 0.3,
}

async function getAppAccessToken() {
  if (cachedAccessToken && Date.now() < accessTokenExpiresAt - 60_000) return cachedAccessToken
  const config = await requireQqConfig()
  if (!config) throw new Error('QQ Bot config missing')

  const response = await fetch('https://bots.qq.com/app/getAppAccessToken', {
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

async function getAuthHeader() {
  const accessToken = await getAppAccessToken()
  return `QQBot ${accessToken}`
}

function stripBotMention(content = '') {
  return content
    .replace(/<@!?[0-9A-Za-z_-]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function readReferenceMessageId(payload) {
  return String(
    payload?.message_reference?.message_id
      || payload?.message_reference?.messageId
      || payload?.reply_to?.message_id
      || payload?.reply_to?.id
      || '',
  )
}

async function qqRequest(method, path, body) {
  const config = await requireQqConfig()
  if (!config) throw new Error('QQ Bot config missing')
  const authorization = await getAuthHeader()
  const response = await fetch(`${config.apiBase}${path}`, {
    method,
    headers: {
      authorization,
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

async function getGatewayUrl() {
  const data = await qqRequest('GET', '/gateway')
  if (!data?.url) throw new Error(`QQ gateway url missing: ${JSON.stringify(data)}`)
  return data.url
}

function extractContext(eventType, payload) {
  if (!payload) return null
  if (eventType === 'C2C_MESSAGE_CREATE') {
    const contextId = payload.author?.user_openid || payload.author?.id || payload.openid
    if (!contextId) return null
    return {
      contextType: 'c2c',
      contextId: String(contextId),
      text: stripBotMention(payload.content || ''),
      messageId: payload.id,
      referenceMessageId: readReferenceMessageId(payload),
    }
  }
  if (eventType === 'GROUP_AT_MESSAGE_CREATE' || eventType === 'GROUP_MESSAGE_CREATE') {
    const contextId = payload.group_openid || payload.group_id || payload.group?.id
    if (!contextId) return null
    return {
      contextType: 'group',
      contextId: String(contextId),
      text: stripBotMention(payload.content || ''),
      messageId: payload.id,
      referenceMessageId: readReferenceMessageId(payload),
    }
  }
  if (eventType === 'AT_MESSAGE_CREATE' || eventType === 'DIRECT_MESSAGE_CREATE') {
    const contextId = payload.channel_id || payload.guild_id
    if (!contextId) return null
    return {
      contextType: 'channel',
      contextId: String(contextId),
      text: stripBotMention(payload.content || ''),
      messageId: payload.id,
      referenceMessageId: readReferenceMessageId(payload),
    }
  }
  return null
}

function isAllowedContext(contextId) {
  const allowedContextIds = new Set((currentQqConfig?.allowedContextIds || []).map((item) => String(item)))
  return allowedContextIds.size === 0 || allowedContextIds.has(String(contextId))
}

function readQqUserProfile(payload) {
  return {
    username: payload.author?.username || payload.member?.nick || payload.author?.id || '',
    nickname: payload.author?.nickname || payload.member?.nick || payload.author?.username || '',
  }
}

async function bindContextToUser(userId, contextType, contextId, payload) {
  const profile = readQqUserProfile(payload)
  await prisma.qqChatBinding.upsert({
    where: { contextType_contextId: { contextType, contextId } },
    update: {
      userId,
      username: profile.username,
      nickname: profile.nickname,
      status: 'ENABLED',
    },
    create: {
      userId,
      contextType,
      contextId,
      username: profile.username,
      nickname: profile.nickname,
      status: 'ENABLED',
    },
  })

  await prisma.integrationAccount.upsert({
    where: { id: `qq-${userId}-${contextType}-${contextId}` },
    update: {
      accountLabel: `${contextType}:${contextId}`,
      status: 'ENABLED',
      permissions: { contextType, contextId, canReceiveMessage: true, canSendMessage: true },
    },
    create: {
      id: `qq-${userId}-${contextType}-${contextId}`,
      userId,
      provider: 'qq',
      accountLabel: `${contextType}:${contextId}`,
      status: 'ENABLED',
      permissions: { contextType, contextId, canReceiveMessage: true, canSendMessage: true },
    },
  })
}

async function resolveUser(contextType, contextId, payload, text) {
  const existing = await prisma.qqChatBinding.findUnique({ where: { contextType_contextId: { contextType, contextId } } })
  if (existing?.status === 'ENABLED') return { userId: existing.userId, justBound: false }

  const bindingCode = normalizeQqBindingCode(text)
  if (!bindingCode) return { userId: null, justBound: false, reason: 'missing_binding_code' }

  const qqBotAccount = await findQqAccountByBindingCode(prisma, bindingCode)
  if (!qqBotAccount) return { userId: null, justBound: false, reason: 'invalid_or_expired_binding_code' }

  const user = await prisma.user.findUnique({ where: { id: qqBotAccount.userId } })
  if (!user) return { userId: null, justBound: false, reason: 'binding_user_missing' }

  await bindContextToUser(user.id, contextType, contextId, payload)
  await clearQqBindingCode(prisma, qqBotAccount.id, { contextType, contextId })

  return { userId: user.id, justBound: true, bindingCode }
}

async function findOrCreateThread(userId, contextType, contextId) {
  const title = `QQ ${contextType} ${contextId}`
  const existing = await prisma.agentThread.findFirst({ where: { userId, title, status: 'ACTIVE' } })
  if (existing) return existing
  const goal = await prisma.goal.findFirst({ where: { userId, isCurrentFocus: true } })
  return prisma.agentThread.create({ data: { userId, goalId: goal?.id, title } })
}

async function executeQqAgentTool({ userId, confirmed, agentThreadId, agentMessageId, source = 'qq' }, toolName, rawInput) {
  // qq-scheduler-reply.mjs calls this adapter with source: 'scheduler' so the shared audit remains channel-correct.
  return executeAgentToolWithPrisma(
    prisma,
    { userId, source, confirmed, agentThreadId, agentMessageId },
    toolName,
    rawInput,
  )
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function formatQqToolReply(toolName, execution) {
  return renderQqToolExecution(toolName, execution) || formatAgentToolReply(toolName, execution)
}

async function applyQqReminderControl({ userId, thread, userMessage, context, intent, recentSchedulerEvent }) {
  if (shouldPauseAllQqProactiveRules(intent)) {
    const execution = await executeQqAgentTool(
      {
        userId,
        source: 'qq',
        confirmed: false,
        agentThreadId: thread.id,
        agentMessageId: userMessage.id,
      },
      'reminder.schedule',
      {
        mode: 'pause',
        enabled: false,
        reason: 'user_requested_pause',
      },
    )
    const disabledRuleIds = Array.isArray(execution?.result?.disabledRuleIds)
      ? execution.result.disabledRuleIds
      : []
    if (recentSchedulerEvent) {
      await prisma.schedulerEvent.update({
        where: { id: recentSchedulerEvent.id },
        data: {
          status: 'responded',
          payload: {
            ...asRecord(recentSchedulerEvent.payload),
            reminderControl: {
              action: 'pause',
              text: context.text,
              processedAt: new Date().toISOString(),
            },
          },
        },
      })
    }
    return {
      action: 'pause',
      count: disabledRuleIds.length,
      global: true,
      results: [execution],
    }
  }

  if (intent.action === 'resume') {
    const execution = await executeQqAgentTool(
      {
        userId,
        source: 'qq',
        confirmed: false,
        agentThreadId: thread.id,
        agentMessageId: userMessage.id,
      },
      'reminder.schedule',
      {
        ...buildQqReminderControlToolInput(intent),
        qqContextId: context.contextId,
        qqContextType: context.contextType,
      },
    )
    return {
      action: 'resume',
      count: 0,
      pendingConfirmation: execution?.needsConfirmation === true,
      results: [execution],
    }
  }

  const allRules = await prisma.reminderRule.findMany({
    where: { userId, channel: 'qq' },
    orderBy: { updatedAt: 'desc' },
  })
  const rules = selectQqReminderRulesForControl(allRules, intent, recentSchedulerEvent)

  const results = []
  for (const rule of rules) {
    const metadata = {
      ...asRecord(rule.metadata),
      pausedBy: intent.action === 'pause' ? 'qq_user' : null,
      pausedAt: intent.action === 'pause' ? new Date().toISOString() : null,
      pauseReason: intent.action === 'pause' ? intent.reason : null,
      resumedAt: intent.action === 'resume' ? new Date().toISOString() : null,
      sourceMessageId: context.messageId,
    }
    const execution = await executeQqAgentTool(
      {
        userId,
        source: 'qq',
        confirmed: true,
        agentThreadId: thread.id,
        agentMessageId: userMessage.id,
      },
      'reminder.schedule',
      {
        ruleId: rule.id,
        goalId: rule.goalId || '',
        reminderType: rule.reminderType,
        channel: rule.channel,
        schedule: rule.schedule,
        timezone: rule.timezone,
        maxPerDay: rule.maxPerDay,
        quietHours: rule.quietHours || undefined,
        enabled: intent.action === 'resume',
        metadata,
      },
    )
    results.push(execution)
  }

  if (recentSchedulerEvent) {
    await prisma.schedulerEvent.update({
      where: { id: recentSchedulerEvent.id },
      data: {
        status: 'responded',
        payload: {
          ...asRecord(recentSchedulerEvent.payload),
          reminderControl: {
            action: 'pause',
            text: context.text,
            processedAt: new Date().toISOString(),
          },
        },
      },
    })
  }

  return {
    action: intent.action,
    count: results.filter((execution) => execution?.action?.status !== 'failed').length,
    results,
  }
}

async function sendQqMessage(contextType, contextId, content, sourceMessageId) {
  if (contextType === 'c2c') {
    return qqRequest('POST', `/v2/users/${contextId}/messages`, {
      msg_type: 0,
      content,
      msg_id: sourceMessageId,
    })
  }
  if (contextType === 'group') {
    return qqRequest('POST', `/v2/groups/${contextId}/messages`, {
      msg_type: 0,
      content,
      msg_id: sourceMessageId,
    })
  }
  return qqRequest('POST', `/channels/${contextId}/messages`, {
    content,
    msg_id: sourceMessageId,
  })
}

async function processDispatch(eventType, payload) {
  const context = extractContext(eventType, payload)
  if (!context?.text) return

  const eventId = String(payload.id || `${eventType}:${context.contextType}:${context.contextId}:${Date.now()}`)
  const existing = await prisma.qqMessageEvent.findUnique({ where: { eventId } })
  if (existing) return

  if (!isAllowedContext(context.contextId)) {
    await prisma.qqMessageEvent.create({
      data: {
        eventId,
        eventType,
        contextType: context.contextType,
        contextId: context.contextId,
        messageText: context.text,
        payload,
        status: 'IGNORED',
      },
    })
    return
  }

  const resolvedUser = await resolveUser(context.contextType, context.contextId, payload, context.text)
  if (!resolvedUser.userId) {
    const prompt = resolvedUser.reason === 'invalid_or_expired_binding_code'
      ? '这条绑定码无效或已过期。请在 Goal Mate 网页 Settings -> QQ 主动助手重新生成绑定码，然后发送：绑定 GM-XXXXXX。'
      : '我还没有绑定到你的 Goal Mate 账号。请打开 Goal Mate 网页 Settings -> QQ 主动助手，生成绑定码，然后在这里发送：绑定 GM-XXXXXX。'
    let sent = null
    let status = 'REPLIED'
    let errorMessage = ''
    try {
      sent = await sendQqMessage(context.contextType, context.contextId, prompt, context.messageId)
    } catch (error) {
      status = 'FAILED'
      errorMessage = error instanceof Error ? error.message : String(error)
    }

    await prisma.qqMessageEvent.create({
      data: {
        eventId,
        eventType,
        contextType: context.contextType,
        contextId: context.contextId,
        messageText: context.text,
        payload: { ...payload, bindingResolution: resolvedUser.reason || 'missing_binding_code', errorMessage },
        status,
        replyMessageId: String(sent?.id || sent?.message_id || sent?.data?.id || ''),
      },
    })
    return
  }
  const userId = resolvedUser.userId

  const thread = await findOrCreateThread(userId, context.contextType, context.contextId)
  const userMessage = await prisma.agentMessage.create({
    data: { userId, threadId: thread.id, role: 'USER', content: context.text },
  })

  let reply = ''
  let structuredOutputType = 'qq_reply'
  let structuredOutput = {
    eventType,
    eventId,
    contextType: context.contextType,
    contextId: context.contextId,
    turnType: 'user_initiated',
  }

  const recentSchedulerEvent = resolvedUser.justBound
    ? null
    : await findRecentQqSchedulerEvent(prisma, userId)
  const reminderControlIntent = resolvedUser.justBound
    ? null
    : detectQqReminderControlIntent(context.text)
  const pendingAction = isConfirmToolMessage(context.text)
    ? await prisma.agentToolAction.findFirst({
        where: { userId, source: 'qq', agentThreadId: thread.id, status: 'pending_confirmation' },
        orderBy: { createdAt: 'desc' },
      })
    : null

  if (resolvedUser.justBound) {
    reply = '绑定成功。以后直接在这里说目标、问下一步或反馈进度就行；绑定本身不会替你自动开启提醒。'
    structuredOutputType = 'qq_binding'
    structuredOutput = {
      ...structuredOutput,
      turnType: 'binding_welcome',
      bound: true,
    }
  } else if (reminderControlIntent) {
    const controlResult = await applyQqReminderControl({
      userId,
      thread,
      userMessage,
      context,
      intent: reminderControlIntent,
      recentSchedulerEvent,
    })
    reply = renderQqReminderControlResult(controlResult)
    structuredOutputType = 'qq_reminder_control'
    structuredOutput = {
      ...structuredOutput,
      turnType: 'reminder_control',
      reminderControl: {
        action: reminderControlIntent.action,
        reminderType: reminderControlIntent.reminderType || null,
        affectedRules: controlResult.count,
      },
    }
  } else if (pendingAction) {
    await prisma.agentToolAction.update({ where: { id: pendingAction.id }, data: { status: 'approved' } })
    const execution = await executeQqAgentTool(
      { userId, confirmed: true, agentThreadId: thread.id, agentMessageId: userMessage.id },
      pendingAction.toolName,
      pendingAction.input,
    )
    reply = formatQqToolReply(pendingAction.toolName, execution)
    structuredOutputType = 'qq_tool_result'
    structuredOutput = {
      ...structuredOutput,
      turnType: 'tool_confirmation',
      confirmedActionId: pendingAction.id,
      executedActionId: execution.action?.id,
      toolName: pendingAction.toolName,
      needsConfirmation: execution.needsConfirmation,
    }
  } else {
    const schedulerReply = await processQqSchedulerReply(prisma, {
      userId,
      thread,
      userMessage,
      context,
      executeAgentTool: executeQqAgentTool,
      schedulerEvent: recentSchedulerEvent,
    })
    if (schedulerReply) {
      reply = schedulerReply.reply
      structuredOutputType = 'qq_scheduler_reply'
      structuredOutput = {
        ...structuredOutput,
        turnType: 'scheduler_feedback',
        handledAsSchedulerReply: true,
        feedback: schedulerReply.feedback,
        schedulerEventId: schedulerReply.schedulerEventId,
      }
    } else {
      const firstGoalTurn = await evaluateFirstGoalTurnWithPrisma(prisma, userId, context.text)
      if (firstGoalTurn?.kind === 'clarification') {
        reply = firstGoalTurn.content
        structuredOutputType = 'qq_first_goal_clarification'
        structuredOutput = {
          ...structuredOutput,
          turnType: 'first_goal_clarification',
          missing: 'first_goal_required_fact',
        }
      }
      const toolIntent = firstGoalTurn?.kind === 'tool_intent'
        ? firstGoalTurn.toolIntent
        : !reply
          ? await generateAgentToolIntentWithPrisma(prisma, {
              userId,
              latestUserContent: context.text,
              defaultAgentSettings: qqDefaultAgentSettings,
              defaultChatModel: qqDefaultChatModel,
            })
          : null
      if (toolIntent) {
        const toolInput = toolIntent.toolName === 'reminder.schedule'
          && toolIntent.input?.enabled !== false
          && String(toolIntent.input?.mode || '').toLowerCase() !== 'pause'
          ? {
              ...toolIntent.input,
              qqContextId: context.contextId,
              qqContextType: context.contextType,
            }
          : toolIntent.input
        const execution = await executeQqAgentTool(
          { userId, confirmed: false, agentThreadId: thread.id, agentMessageId: userMessage.id },
          toolIntent.toolName,
          toolInput,
        )
        let activationExecution = null
        if (toolIntent.toolName === 'goal.create_draft' && execution?.result?.goal?.id) {
          activationExecution = await executeQqAgentTool(
            { userId, confirmed: false, agentThreadId: thread.id, agentMessageId: userMessage.id },
            'goal.update',
            { goalId: execution.result.goal.id, status: 'ACTIVE', isCurrentFocus: true },
          )
        }
        reply = formatQqToolReply(toolIntent.toolName, execution)
        structuredOutputType = 'qq_tool_result'
        structuredOutput = {
          ...structuredOutput,
          turnType: toolIntent.toolName === 'goal.create_draft' ? 'first_goal_draft' : 'tool_execution',
          toolIntent: { ...toolIntent, input: toolInput },
          toolActionId: activationExecution?.action?.id || execution.action?.id,
          needsConfirmation: activationExecution?.needsConfirmation || execution.needsConfirmation,
          activationResult: activationExecution,
        }
      }
    }
  }

  if (!reply) {
    const modelReply = await generateAssistantReplyWithPrisma(prisma, {
      userId,
      threadId: thread.id,
      latestUserContent: context.text,
      defaultAgentSettings: qqDefaultAgentSettings,
      defaultChatModel: qqDefaultChatModel,
      channel: 'qq',
    })
    const modelFailureReason = modelReply?.structuredOutput?.model?.error
    reply = modelReply.ok
      ? renderQqModelReply(modelReply.content)
      : renderQqModelFailure(modelFailureReason)
    structuredOutput = {
      ...structuredOutput,
      ...modelReply.structuredOutput,
      eventType,
      eventId,
      contextType: context.contextType,
      contextId: context.contextId,
      turnType: 'user_initiated',
    }
  }

  const assistantMessage = await prisma.agentMessage.create({
    data: {
      userId,
      threadId: thread.id,
      role: 'ASSISTANT',
      content: reply,
      structuredOutputType,
      structuredOutput,
    },
  })
  await prisma.agentThread.update({ where: { id: thread.id }, data: { updatedAt: new Date() } })

  let sent = null
  try {
    sent = await sendQqMessage(context.contextType, context.contextId, reply, context.messageId)
  } catch (error) {
    await prisma.qqMessageEvent.create({
      data: {
        userId,
        eventId,
        eventType,
        contextType: context.contextType,
        contextId: context.contextId,
        messageText: context.text,
        payload,
        status: 'FAILED',
        agentThreadId: thread.id,
        agentMessageId: assistantMessage.id,
      },
    })
    throw error
  }

  await prisma.qqMessageEvent.create({
    data: {
      userId,
      eventId,
      eventType,
      contextType: context.contextType,
      contextId: context.contextId,
      messageText: context.text,
      payload,
      status: 'REPLIED',
      agentThreadId: thread.id,
      agentMessageId: assistantMessage.id,
      replyMessageId: String(sent?.id || sent?.message_id || sent?.data?.id || ''),
    },
  })

  console.log(`[qq] replied ${eventType} ${context.contextType}:${context.contextId}`)
}

async function connectGateway() {
  const config = await refreshQqConfig()
  if (!config) {
    await sleep(15_000)
    return connectGateway()
  }
  const gatewayUrl = await getGatewayUrl()
  console.log(`[qq] connecting gateway ${gatewayUrl}`)
  await touchRuntimeHeartbeat(prisma, {
    service: 'qq-worker',
    status: 'connecting',
    detail: 'QQ Worker 正在连接 Gateway。',
    payload: { apiBase: config.apiBase, intents: config.intents },
  })

  const ws = new WebSocket(gatewayUrl)

  ws.on('open', () => {
    touchRuntimeHeartbeat(prisma, {
      service: 'qq-worker',
      status: 'connected',
      detail: 'QQ Worker Gateway WebSocket 已连接。',
      payload: { apiBase: config.apiBase, intents: config.intents },
    })
  })

  ws.on('message', async (raw) => {
    try {
      const packet = JSON.parse(String(raw))
      if (typeof packet.s === 'number') lastSeq = packet.s

      if (packet.op === 10) {
        const interval = packet.d?.heartbeat_interval || 45000
        heartbeatTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ op: 1, d: lastSeq }))
            touchRuntimeHeartbeat(prisma, {
              service: 'qq-worker',
              status: 'heartbeat',
              detail: 'QQ Worker Gateway 心跳正常。',
              payload: { lastSeq },
            })
          }
        }, interval)
        ws.send(JSON.stringify({
          op: 2,
          d: {
            token: await getAuthHeader(),
            intents: config.intents,
            shard: [0, 1],
            properties: { os: 'linux', browser: 'goal-mate', device: 'goal-mate' },
          },
        }))
        return
      }

      if (packet.op === 0 && packet.t) {
        await processDispatch(packet.t, packet.d)
      }

      if (packet.op === 7 || packet.op === 9) {
        ws.close()
      }
    } catch (error) {
      console.error('[qq] packet error', error)
    }
  })

  ws.on('close', async () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer)
    console.error('[qq] gateway closed; reconnecting in 5s')
    await touchRuntimeHeartbeat(prisma, {
      service: 'qq-worker',
      status: 'reconnecting',
      detail: 'QQ Worker Gateway 已断开，准备重连。',
    })
    await sleep(5000)
    connectGateway().catch((error) => console.error('[qq] reconnect failed', error))
  })

  ws.on('error', (error) => {
    console.error('[qq] websocket error', error)
    touchRuntimeHeartbeat(prisma, {
      service: 'qq-worker',
      status: 'error',
      detail: error instanceof Error ? error.message : String(error),
    })
  })
}

process.on('SIGINT', async () => {
  if (heartbeatTimer) clearInterval(heartbeatTimer)
  await touchRuntimeHeartbeat(prisma, {
    service: 'qq-worker',
    status: 'stopping',
    detail: 'QQ Worker 正在停止。',
  })
  await prisma.$disconnect()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  if (heartbeatTimer) clearInterval(heartbeatTimer)
  await touchRuntimeHeartbeat(prisma, {
    service: 'qq-worker',
    status: 'stopping',
    detail: 'QQ Worker 正在停止。',
  })
  await prisma.$disconnect()
  process.exit(0)
})

async function main() {
  await touchRuntimeHeartbeat(prisma, {
    service: 'qq-worker',
    status: 'started',
    detail: 'QQ Worker 已启动。',
  })
  while (true) {
    try {
      await connectGateway()
      return
    } catch (error) {
      console.error('[qq] connect failed; retrying in 15s', error)
      await sleep(15_000)
    }
  }
}

main().catch(async (error) => {
  console.error('[qq] fatal', error)
  await prisma.$disconnect()
  process.exit(1)
})
