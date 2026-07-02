import WebSocket from 'ws'
import { PrismaClient } from '@prisma/client'
import { existsSync, readFileSync } from 'node:fs'

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
const defaultUserEmail = process.env.QQ_DEFAULT_USER_EMAIL || 'demo@goalmate.local'
const intents = Number(process.env.QQ_BOT_INTENTS || '33554432')
const allowedContextIds = new Set(
  (process.env.QQ_ALLOWED_CONTEXT_IDS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
)

let lastSeq = null
let heartbeatTimer = null
let cachedAccessToken = ''
let accessTokenExpiresAt = 0

function assertConfig() {
  if (!appId || !token) {
    throw new Error('QQ_BOT_APP_ID and QQ_BOT_TOKEN are required')
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function trimForPrompt(value, max = 900) {
  return value.length > max ? `${value.slice(0, max)}...` : value
}

function asRecord(input) {
  return input && typeof input === 'object' && !Array.isArray(input) ? input : {}
}

function readString(input, key, fallback = '') {
  const value = input[key]
  return typeof value === 'string' ? value.trim() : fallback
}

function readNumber(input, key, fallback) {
  const value = input[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function readBoolean(input, key) {
  const value = input[key]
  return typeof value === 'boolean' ? value : undefined
}

function compactSummary(input) {
  const text = JSON.stringify(input)
  return text.length > 500 ? `${text.slice(0, 500)}...` : text
}

function toDateInput(value) {
  if (!value) return new Date()
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed
}

function formatDatePath(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return {
    title: `${year}-${month}-${day}`,
    path: `Logs/${year}/${month}/${year}-${month}-${day}.md`,
  }
}

function isConfirmToolMessage(content) {
  return /^(确认执行|确认|执行|同意|可以|就这么做|开始执行)$/i.test(String(content || '').trim())
}

function normalizeCheckinResult(value) {
  const normalized = String(value || '').toLowerCase()
  if (normalized === 'done') return 'DONE'
  if (normalized === 'partial') return 'PARTIAL'
  if (normalized === 'not_done') return 'NOT_DONE'
  return 'NO_RESPONSE'
}

function normalizeActionStatus(value) {
  const normalized = normalizeCheckinResult(value)
  if (normalized === 'DONE') return 'DONE'
  if (normalized === 'PARTIAL') return 'PARTIAL'
  if (normalized === 'NOT_DONE') return 'NOT_DONE'
  return 'PLANNED'
}

const qqToolCatalog = [
  { name: 'goal.list', description: '列出当前用户的目标摘要。', permission: 'read', targetType: 'goal', riskLevel: 'low' },
  { name: 'goal.get', description: '读取目标详情、KR、条件、阶段计划和近期行动。', permission: 'read', targetType: 'goal', riskLevel: 'low' },
  { name: 'goal.create_draft', description: '根据对话创建目标草案和目标推理卡。', permission: 'draft', targetType: 'goal', riskLevel: 'medium' },
  { name: 'goal.update', description: '更新目标基础字段或当前焦点。', permission: 'execute', targetType: 'goal', riskLevel: 'medium' },
  { name: 'today.get', description: '读取今天或最近的下一步行动。', permission: 'read', targetType: 'today', riskLevel: 'low' },
  { name: 'today.set_next_action', description: '设置今天下一步行动。', permission: 'execute', targetType: 'today', riskLevel: 'medium' },
  { name: 'checkin.submit', description: '提交今日行动的完成情况和阻塞原因。', permission: 'execute', targetType: 'checkin', riskLevel: 'low' },
  { name: 'log.write_daily', description: '写入或更新当天 Markdown 日志。', permission: 'execute', targetType: 'log', riskLevel: 'low' },
  { name: 'review.generate', description: '生成日复盘或周复盘草稿。', permission: 'draft', targetType: 'review', riskLevel: 'low' },
  { name: 'reminder.schedule', description: '创建或调整提醒规则。', permission: 'execute', targetType: 'reminder', riskLevel: 'medium' },
  { name: 'settings.model.get', description: '读取当前默认模型配置。', permission: 'read', targetType: 'settings', riskLevel: 'low' },
  { name: 'settings.model.update', description: '修改默认模型配置。', permission: 'execute', targetType: 'settings', riskLevel: 'medium' },
]

function parseToolIntentJson(value) {
  const match = String(value || '').match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    const parsed = JSON.parse(match[0])
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

async function getCurrentGoal(userId, goalId) {
  if (goalId) {
    const goal = await prisma.goal.findFirst({ where: { id: goalId, userId } })
    if (!goal) throw new Error('目标不存在。')
    return goal
  }
  const goal = await prisma.goal.findFirst({ where: { userId, isCurrentFocus: true } })
  if (!goal) throw new Error('当前没有主目标。')
  return goal
}

async function getOrCreateCondition(userId, goalId, input) {
  const conditionId = readString(input, 'conditionId')
  if (conditionId) {
    const condition = await prisma.goalCondition.findFirst({ where: { id: conditionId, userId, goalId } })
    if (!condition) throw new Error('目标条件不存在。')
    return condition
  }

  const existing = await prisma.goalCondition.findFirst({ where: { userId, goalId }, orderBy: { createdAt: 'asc' } })
  if (existing) return existing

  return prisma.goalCondition.create({
    data: {
      userId,
      goalId,
      title: readString(input, 'conditionTitle', '当前关键条件'),
      type: 'ASSUMED',
      status: 'PARTIAL',
      whyRequired: readString(input, 'conditionReason', '用于承接 QQ Agent 设置今日行动时缺失的关键条件。'),
    },
  })
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

async function qqRequest(method, path, body) {
  const authorization = await getAuthHeader()
  const response = await fetch(`${apiBase}${path}`, {
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
    return { contextType: 'c2c', contextId: String(contextId), text: stripBotMention(payload.content || ''), messageId: payload.id }
  }
  if (eventType === 'GROUP_AT_MESSAGE_CREATE' || eventType === 'GROUP_MESSAGE_CREATE') {
    const contextId = payload.group_openid || payload.group_id || payload.group?.id
    if (!contextId) return null
    return { contextType: 'group', contextId: String(contextId), text: stripBotMention(payload.content || ''), messageId: payload.id }
  }
  if (eventType === 'AT_MESSAGE_CREATE' || eventType === 'DIRECT_MESSAGE_CREATE') {
    const contextId = payload.channel_id || payload.guild_id
    if (!contextId) return null
    return { contextType: 'channel', contextId: String(contextId), text: stripBotMention(payload.content || ''), messageId: payload.id }
  }
  return null
}

function isAllowedContext(contextId) {
  return allowedContextIds.size === 0 || allowedContextIds.has(String(contextId))
}

async function resolveUser(contextType, contextId, payload) {
  const existing = await prisma.qqChatBinding.findUnique({ where: { contextType_contextId: { contextType, contextId } } })
  if (existing?.status === 'ENABLED') return existing.userId

  const user = await prisma.user.findUnique({ where: { email: defaultUserEmail } })
  if (!user) return null

  await prisma.qqChatBinding.upsert({
    where: { contextType_contextId: { contextType, contextId } },
    update: {
      userId: user.id,
      username: payload.author?.username || payload.member?.nick,
      nickname: payload.author?.nickname || payload.member?.nick,
      status: 'ENABLED',
    },
    create: {
      userId: user.id,
      contextType,
      contextId,
      username: payload.author?.username || payload.member?.nick,
      nickname: payload.author?.nickname || payload.member?.nick,
      status: 'ENABLED',
    },
  })

  await prisma.integrationAccount.upsert({
    where: { id: `qq-${user.id}-${contextType}-${contextId}` },
    update: {
      accountLabel: `${contextType}:${contextId}`,
      status: 'ENABLED',
      permissions: { contextType, contextId, canReceiveMessage: true, canSendMessage: true },
    },
    create: {
      id: `qq-${user.id}-${contextType}-${contextId}`,
      userId: user.id,
      provider: 'qq',
      accountLabel: `${contextType}:${contextId}`,
      status: 'ENABLED',
      permissions: { contextType, contextId, canReceiveMessage: true, canSendMessage: true },
    },
  })

  return user.id
}

async function findOrCreateThread(userId, contextType, contextId) {
  const title = `QQ ${contextType} ${contextId}`
  const existing = await prisma.agentThread.findFirst({ where: { userId, title, status: 'ACTIVE' } })
  if (existing) return existing
  const goal = await prisma.goal.findFirst({ where: { userId, isCurrentFocus: true } })
  return prisma.agentThread.create({ data: { userId, goalId: goal?.id, title } })
}

async function findMarkdownDocuments(userId, input) {
  const terms = (input.match(/[A-Za-z0-9_-]{2,}|[\u4e00-\u9fff]{2,}/g) || []).slice(0, 8)
  if (terms.length) {
    const matched = await prisma.markdownDocument.findMany({
      where: {
        userId,
        OR: terms.flatMap((term) => [
          { title: { contains: term } },
          { path: { contains: term } },
          { content: { contains: term } },
        ]),
      },
      orderBy: { updatedAt: 'desc' },
      take: 8,
    })
    if (matched.length) return matched
  }
  return prisma.markdownDocument.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' }, take: 8 })
}

async function generateToolIntent(userId, latestUserContent) {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) return null

  const modelConfig = await prisma.modelConfig.findFirst({ where: { userId, isDefault: true }, orderBy: { createdAt: 'asc' } })
  const apiBaseForModel = String(modelConfig?.apiBase || process.env.DEEPSEEK_API_BASE || 'https://api.deepseek.com').replace(/\/+$/, '')
  const modelName = String(modelConfig?.model || process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash')

  try {
    const response = await fetch(`${apiBaseForModel}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: modelName,
        temperature: 0,
        max_tokens: 500,
        messages: [
          {
            role: 'system',
            content: [
              '你是 Goal Mate 的 QQ 工具路由器，只判断用户是否明确要求操作系统。',
              '如果用户只是聊天、提问、讨论、解释概念，不要选择工具。',
              '只有用户明确要求查看、创建、更新、提交、写入、生成、设置时才选择工具。',
              '输出必须是 JSON，不要输出 Markdown。',
              '',
              'JSON 格式：',
              '{"toolName":null,"input":{},"confidence":0,"reason":"不需要工具"}',
              '{"toolName":"today.get","input":{},"confidence":0.95,"reason":"用户要求查看今日行动"}',
              '',
              '可用工具：',
              JSON.stringify(qqToolCatalog),
            ].join('\n'),
          },
          { role: 'user', content: latestUserContent },
        ],
      }),
    })
    if (!response.ok) return null
    const data = await response.json()
    const content = data?.choices?.[0]?.message?.content
    if (typeof content !== 'string') return null
    const parsed = parseToolIntentJson(content)
    if (!parsed) return null

    const toolName = typeof parsed.toolName === 'string' ? parsed.toolName : null
    const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0
    const input = parsed.input && typeof parsed.input === 'object' ? parsed.input : {}
    const reason = typeof parsed.reason === 'string' ? parsed.reason : ''
    if (!toolName || confidence < 0.75) return null
    if (!qqToolCatalog.some((tool) => tool.name === toolName)) return null
    return { toolName, input, confidence, reason }
  } catch {
    return null
  }
}

async function runQqToolHandler(userId, toolName, input) {
  if (toolName === 'goal.list') {
    const goals = await prisma.goal.findMany({
      where: { userId },
      orderBy: [{ isCurrentFocus: 'desc' }, { updatedAt: 'desc' }],
      include: { keyResults: true, conditions: true, dailyActions: { orderBy: { actionDate: 'desc' }, take: 1 } },
    })
    return {
      result: goals.map((goal) => ({
        id: goal.id,
        title: goal.title,
        status: goal.status,
        isCurrentFocus: goal.isCurrentFocus,
        keyResultCount: goal.keyResults.length,
        conditionCount: goal.conditions.length,
        latestAction: goal.dailyActions[0]?.title || null,
      })),
    }
  }

  if (toolName === 'goal.get') {
    const goal = await getCurrentGoal(userId, readString(input, 'goalId'))
    const detail = await prisma.goal.findFirst({
      where: { id: goal.id, userId },
      include: {
        keyResults: true,
        conditions: true,
        stagePlans: { orderBy: { sortOrder: 'asc' } },
        dailyActions: { orderBy: { actionDate: 'desc' }, take: 7 },
        reasoningCards: { orderBy: { version: 'desc' }, take: 1 },
      },
    })
    return { targetId: goal.id, result: detail }
  }

  if (toolName === 'goal.create_draft') {
    const title = readString(input, 'title')
    if (!title) throw new Error('缺少目标标题。')
    const rawInput = readString(input, 'rawInput', title)
    const goal = await prisma.goal.create({
      data: {
        userId,
        title,
        rawInput,
        interpretedGoal: readString(input, 'interpretedGoal', rawInput),
        status: 'DRAFT',
        isCurrentFocus: false,
      },
    })
    const card = await prisma.goalReasoningCard.create({
      data: {
        userId,
        goalId: goal.id,
        purposeSummary: readString(input, 'purposeSummary', rawInput),
        successSignals: input.successSignals || [],
        sufficientConditionSet: readString(input, 'sufficientConditionSet', '待 Agent 与用户继续确认。'),
        recommendedFocus: readString(input, 'recommendedFocus', '先确认这个目标怎么算真正有进展。'),
        evidence: input.evidence || {},
        status: 'DRAFT',
      },
    })
    return { targetId: goal.id, result: { goal, reasoningCard: card } }
  }

  if (toolName === 'goal.update') {
    const goal = await getCurrentGoal(userId, readString(input, 'goalId'))
    const isCurrentFocus = readBoolean(input, 'isCurrentFocus')
    if (isCurrentFocus) {
      await prisma.goal.updateMany({ where: { userId }, data: { isCurrentFocus: false } })
    }
    const updated = await prisma.goal.update({
      where: { id: goal.id },
      data: {
        title: readString(input, 'title', goal.title),
        interpretedGoal: readString(input, 'interpretedGoal', goal.interpretedGoal || '') || goal.interpretedGoal,
        status: readString(input, 'status', goal.status),
        isCurrentFocus: typeof isCurrentFocus === 'boolean' ? isCurrentFocus : goal.isCurrentFocus,
      },
    })
    return { targetId: updated.id, result: updated }
  }

  if (toolName === 'today.get') {
    const goal = await getCurrentGoal(userId, readString(input, 'goalId'))
    const actions = await prisma.dailyAction.findMany({
      where: { userId, goalId: goal.id },
      orderBy: { actionDate: 'desc' },
      take: 5,
      include: { condition: true, checkins: { orderBy: { createdAt: 'desc' }, take: 1 } },
    })
    return { targetId: actions[0]?.id, result: { goal: { id: goal.id, title: goal.title }, actions } }
  }

  if (toolName === 'today.set_next_action') {
    const title = readString(input, 'title')
    if (!title) throw new Error('缺少行动标题。')
    const goal = await getCurrentGoal(userId, readString(input, 'goalId'))
    const condition = await getOrCreateCondition(userId, goal.id, input)
    const action = await prisma.dailyAction.create({
      data: {
        userId,
        goalId: goal.id,
        conditionId: condition.id,
        actionDate: toDateInput(readString(input, 'actionDate')),
        title,
        reason: readString(input, 'reason', '由 QQ Agent 根据当前推进状态设置。'),
        doneWhen: readString(input, 'doneWhen', '用户明确回复已完成，并说明完成结果。'),
        minimumStep: readString(input, 'minimumStep', title),
        estimatedMinutes: Math.round(readNumber(input, 'estimatedMinutes', 20)),
        fallbackAction: readString(input, 'fallbackAction', '如果今天状态很差，只完成最小启动动作。'),
        checkinQuestion: readString(input, 'checkinQuestion', '这一步现在能开始吗？'),
        status: 'PLANNED',
      },
    })
    return { targetId: action.id, result: action }
  }

  if (toolName === 'checkin.submit') {
    const actionId = readString(input, 'actionId')
    const action = actionId
      ? await prisma.dailyAction.findFirst({ where: { id: actionId, userId } })
      : await prisma.dailyAction.findFirst({ where: { userId }, orderBy: { actionDate: 'desc' } })
    if (!action) throw new Error('没有找到可提交的今日行动。')
    const result = normalizeCheckinResult(readString(input, 'result', 'no_response'))
    const checkin = await prisma.checkin.create({
      data: {
        userId,
        goalId: action.goalId,
        actionId: action.id,
        result,
        reasonCategory: readString(input, 'reasonCategory') || undefined,
        userFeedback: readString(input, 'userFeedback'),
        adjustment: readString(input, 'adjustment'),
      },
    })
    await prisma.dailyAction.update({ where: { id: action.id }, data: { status: normalizeActionStatus(result) } })
    return { targetId: checkin.id, result: checkin }
  }

  if (toolName === 'log.write_daily') {
    const content = readString(input, 'content')
    if (!content) throw new Error('缺少日志内容。')
    const date = toDateInput(readString(input, 'date'))
    const dateInfo = formatDatePath(date)
    const title = readString(input, 'title', dateInfo.title)
    const linkedGoalIds = input.linkedGoalIds || []
    const linkedActionIds = input.linkedActionIds || []
    const document = await prisma.markdownDocument.upsert({
      where: { userId_path: { userId, path: dateInfo.path } },
      update: {
        title,
        content,
        linkedGoalIds,
        linkedActionIds,
        source: 'AGENT',
      },
      create: {
        userId,
        type: 'DAY',
        title,
        path: dateInfo.path,
        content,
        linkedGoalIds,
        linkedActionIds,
        source: 'AGENT',
      },
    })
    await prisma.logEntry.upsert({
      where: { userId_path: { userId, path: dateInfo.path } },
      update: { title, content, linkedGoalIds, linkedActionIds },
      create: {
        userId,
        periodType: 'DAY',
        title,
        path: dateInfo.path,
        content,
        linkedGoalIds,
        linkedActionIds,
      },
    })
    return { targetId: document.id, result: document }
  }

  if (toolName === 'review.generate') {
    const goal = await getCurrentGoal(userId, readString(input, 'goalId'))
    const recentActions = await prisma.dailyAction.findMany({
      where: { userId, goalId: goal.id },
      orderBy: { actionDate: 'desc' },
      take: 7,
      include: { checkins: { orderBy: { createdAt: 'desc' }, take: 1 } },
    })
    const lines = [
      `# ${readString(input, 'type', 'daily')} review draft`,
      '',
      `目标：${goal.title}`,
      '',
      '## 最近行动',
      ...recentActions.map((action) => `- ${action.title}：${action.status}`),
      '',
      '## 下一步',
      readString(input, 'nextFocus', '继续围绕当前最关键条件推进一个最小行动。'),
    ]
    return { targetId: goal.id, result: { markdown: lines.join('\n') } }
  }

  if (toolName === 'reminder.schedule') {
    const reminderType = readString(input, 'reminderType', 'morning_planning')
    const schedule = readString(input, 'schedule', '08:30')
    const ruleId = readString(input, 'ruleId')
    const data = {
      goalId: readString(input, 'goalId') || null,
      reminderType,
      channel: readString(input, 'channel', 'qq'),
      schedule,
      timezone: readString(input, 'timezone', 'Asia/Shanghai'),
      maxPerDay: Math.round(readNumber(input, 'maxPerDay', 2)),
      quietHours: input.quietHours || undefined,
      enabled: readBoolean(input, 'enabled') ?? true,
      metadata: input.metadata || undefined,
    }
    const rule = ruleId
      ? await prisma.reminderRule.update({ where: { id: ruleId }, data })
      : await prisma.reminderRule.create({ data: { userId, ...data } })
    return { targetId: rule.id, result: rule }
  }

  if (toolName === 'settings.model.get') {
    const modelConfig = await prisma.modelConfig.findFirst({ where: { userId, isDefault: true }, orderBy: { createdAt: 'asc' } })
    return { targetId: modelConfig?.id, result: modelConfig }
  }

  if (toolName === 'settings.model.update') {
    const existing = await prisma.modelConfig.findFirst({ where: { userId, isDefault: true }, orderBy: { createdAt: 'asc' } })
    const data = {
      provider: readString(input, 'provider', existing?.provider || 'deepseek'),
      model: readString(input, 'model', existing?.model || 'deepseek-v4-flash'),
      reasoningModel: readString(input, 'reasoningModel', existing?.reasoningModel || ''),
      apiBase: readString(input, 'apiBase', existing?.apiBase || 'https://api.deepseek.com'),
      apiKeyRef: readString(input, 'apiKeyRef', existing?.apiKeyRef || 'DEEPSEEK_API_KEY'),
      usage: 'CHAT',
      isDefault: true,
      temperature: readNumber(input, 'temperature', existing?.temperature ?? 0.3),
    }
    const modelConfig = existing
      ? await prisma.modelConfig.update({ where: { id: existing.id }, data })
      : await prisma.modelConfig.create({ data: { userId, ...data } })
    return { targetId: modelConfig.id, result: modelConfig }
  }

  throw new Error(`未知 Agent 工具：${toolName}`)
}

async function executeQqAgentTool({ userId, confirmed, agentThreadId, agentMessageId }, toolName, rawInput) {
  const definition = qqToolCatalog.find((item) => item.name === toolName)
  if (!definition) throw new Error(`未知 Agent 工具：${toolName}`)
  const input = asRecord(rawInput)
  const requiresConfirmation = definition.permission === 'execute' && !confirmed

  if (requiresConfirmation) {
    const action = await prisma.agentToolAction.create({
      data: {
        userId,
        source: 'qq',
        toolName: definition.name,
        permission: definition.permission,
        inputSummary: compactSummary(input),
        input,
        targetType: definition.targetType,
        riskLevel: definition.riskLevel,
        requiresConfirmation: true,
        status: 'pending_confirmation',
        agentThreadId,
        agentMessageId,
      },
    })
    return { needsConfirmation: true, action, result: null }
  }

  try {
    const output = await runQqToolHandler(userId, toolName, input)
    const action = await prisma.agentToolAction.create({
      data: {
        userId,
        source: 'qq',
        toolName: definition.name,
        permission: definition.permission,
        inputSummary: compactSummary(input),
        input,
        result: output.result || {},
        targetType: definition.targetType,
        targetId: output.targetId,
        riskLevel: definition.riskLevel,
        requiresConfirmation: false,
        status: definition.permission === 'draft' ? 'drafted' : 'executed',
        agentThreadId,
        agentMessageId,
      },
    })
    return { needsConfirmation: false, action, result: output.result }
  } catch (error) {
    const action = await prisma.agentToolAction.create({
      data: {
        userId,
        source: 'qq',
        toolName: definition.name,
        permission: definition.permission,
        inputSummary: compactSummary(input),
        input,
        targetType: definition.targetType,
        riskLevel: definition.riskLevel,
        requiresConfirmation,
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : String(error),
        agentThreadId,
        agentMessageId,
      },
    })
    return { needsConfirmation: false, action, result: null }
  }
}

function formatToolReply(toolName, execution) {
  const action = execution?.action
  if (action?.status === 'failed') return `这个操作没有执行成功：${action.errorMessage || '未知错误'}`
  if (execution?.needsConfirmation) {
    return [
      '我理解你要改动 Goal Mate 的系统数据。',
      `动作：${toolName}`,
      '我已经生成待确认动作。你回复“确认执行”后，我再真正执行。',
    ].join('\n')
  }

  const result = execution?.result
  if (toolName === 'goal.list' && Array.isArray(result)) {
    if (!result.length) return '当前还没有目标。你可以直接告诉我你想推进什么，我先帮你生成目标草案。'
    return ['当前目标：', ...result.map((goal) => `- ${goal.title}${goal.isCurrentFocus ? '（当前主目标）' : ''}：${goal.status}`)].join('\n')
  }
  if (toolName === 'today.get') {
    const actions = Array.isArray(result?.actions) ? result.actions : []
    if (!actions.length) return '当前还没有今日行动。你可以让我基于当前目标设置下一步。'
    const action = actions[0]
    return [`当前下一步：${action.title}`, `完成标准：${action.doneWhen}`, `最小启动：${action.minimumStep}`, `状态：${action.status}`].join('\n')
  }
  if (toolName === 'goal.create_draft') return '目标草案已经生成。下一步应该确认：这个目标怎么算真正有进展。'
  if (toolName === 'today.set_next_action') return `今日下一步已经设置：${result?.title || '新的行动'}`
  if (toolName === 'checkin.submit') return '完成情况已经记录。'
  if (toolName === 'log.write_daily') return `日志已经写入：${result?.path || '今日日志'}`
  if (toolName === 'review.generate') return result?.markdown || '复盘草稿已经生成。'
  if (toolName === 'reminder.schedule') return `提醒规则已经设置：${result?.reminderType || 'reminder'} ${result?.schedule || ''}`
  if (toolName === 'settings.model.get') return result ? `当前默认模型：${result.provider} / ${result.model}` : '当前还没有默认模型配置。'
  if (toolName === 'settings.model.update') return `默认模型已经更新为：${result?.provider || 'provider'} / ${result?.model || 'model'}`
  return `已处理：${toolName}`
}

function classifySchedulerReply(text) {
  const content = String(text || '').trim()
  const lower = content.toLowerCase()
  const done = /(完成|做完|已做|搞定|done|finished|ok了|好了)/i.test(content)
  const notDone = /(没做|没完成|未完成|没推进|没开始|失败|做不了|不想做|太难|忘了|来不及|拖延)/i.test(content)
  const partial = /(做了一点|一部分|部分|还差|进行中|started|partial)/i.test(content)

  let result = 'PARTIAL'
  if (done && !notDone) result = 'DONE'
  if (notDone) result = 'NOT_DONE'
  if (partial) result = 'PARTIAL'
  if (!done && !notDone && !partial) result = lower.length <= 6 ? 'NO_RESPONSE' : 'PARTIAL'

  let reasonCategory = 'UNKNOWN'
  if (/(不想|没意义|不重要|没动力|不值得|抗拒)/i.test(content)) reasonCategory = 'MOTIVATION'
  if (/(太难|不会|不知道怎么|做不了|累|困|没精力|时间不够|来不及)/i.test(content)) reasonCategory = 'ABILITY'
  if (/(忘|没提醒|时间不对|没看到|错过)/i.test(content)) reasonCategory = 'PROMPT'
  if (/(方向|路径|计划不对|不是关键|不知道为什么做)/i.test(content)) reasonCategory = 'PATH'

  const adjustment = result === 'DONE'
    ? '保持当前推进节奏，明天继续围绕关键条件推进下一步。'
    : reasonCategory === 'ABILITY'
      ? '明天把行动缩小到更容易开始的最小步骤。'
      : reasonCategory === 'PROMPT'
        ? '需要调整提醒时间或提醒方式。'
        : reasonCategory === 'MOTIVATION'
          ? '需要重新确认这个目标是否仍然重要。'
          : reasonCategory === 'PATH'
            ? '需要检查当前行动是否真的对应关键条件。'
            : '先记录反馈，下一步继续缩小动作并观察。'

  return { result, reasonCategory, userFeedback: content, adjustment }
}

function formatReminderType(type) {
  if (type === 'morning_planning') return '早晨规划'
  if (type === 'midday_check') return '中午检查'
  if (type === 'evening_review') return '晚上复盘'
  if (type === 'weekly_review') return '周复盘'
  return type
}

async function findRecentSchedulerEvent(userId) {
  const hours = Number(process.env.QQ_SCHEDULER_REPLY_WINDOW_HOURS || '18')
  const threshold = new Date(Date.now() - Math.max(1, hours) * 60 * 60 * 1000)
  return prisma.schedulerEvent.findFirst({
    where: {
      userId,
      channel: 'qq',
      status: 'sent',
      sentAt: { gte: threshold },
    },
    orderBy: { sentAt: 'desc' },
  })
}

async function buildSchedulerDailyLogContent(userId, schedulerEvent, feedback) {
  const dateInfo = formatDatePath(new Date())
  const existing = await prisma.markdownDocument.findUnique({ where: { userId_path: { userId, path: dateInfo.path } } })
  const section = [
    `## ${formatReminderType(schedulerEvent.eventType)}反馈`,
    '',
    `- 时间：${new Date().toISOString()}`,
    `- 用户回复：${feedback.userFeedback}`,
    `- 系统判断：${feedback.result}`,
    `- 原因分类：${feedback.reasonCategory}`,
    `- 调整建议：${feedback.adjustment}`,
  ].join('\n')

  return existing?.content ? `${existing.content}\n\n${section}` : `# ${dateInfo.title}\n\n${section}`
}

async function processSchedulerReply(userId, thread, userMessage, context) {
  const schedulerEvent = await findRecentSchedulerEvent(userId)
  if (!schedulerEvent) return null

  const feedback = classifySchedulerReply(context.text)
  const toolResults = []

  if (schedulerEvent.eventType !== 'morning_planning' && schedulerEvent.eventType !== 'weekly_review') {
    const checkinExecution = await executeQqAgentTool(
      { userId, confirmed: true, agentThreadId: thread.id, agentMessageId: userMessage.id },
      'checkin.submit',
      {
        result: feedback.result.toLowerCase(),
        reasonCategory: feedback.reasonCategory,
        userFeedback: feedback.userFeedback,
        adjustment: feedback.adjustment,
      },
    )
    toolResults.push({ toolName: 'checkin.submit', execution: checkinExecution })
  }

  const logContent = await buildSchedulerDailyLogContent(userId, schedulerEvent, feedback)
  const logExecution = await executeQqAgentTool(
    { userId, confirmed: true, agentThreadId: thread.id, agentMessageId: userMessage.id },
    'log.write_daily',
    {
      title: formatDatePath(new Date()).title,
      content: logContent,
    },
  )
  toolResults.push({ toolName: 'log.write_daily', execution: logExecution })

  if (schedulerEvent.eventType === 'weekly_review') {
    const reviewExecution = await executeQqAgentTool(
      { userId, confirmed: true, agentThreadId: thread.id, agentMessageId: userMessage.id },
      'review.generate',
      { type: 'weekly', nextFocus: feedback.adjustment },
    )
    toolResults.push({ toolName: 'review.generate', execution: reviewExecution })
  }

  await prisma.schedulerEvent.update({
    where: { id: schedulerEvent.id },
    data: {
      status: 'responded',
      payload: {
        previousPayload: schedulerEvent.payload || {},
        reply: {
          contextType: context.contextType,
          contextId: context.contextId,
          messageId: context.messageId,
          text: context.text,
          feedback,
          processedAt: new Date().toISOString(),
        },
      },
    },
  })

  const failed = toolResults.filter((item) => item.execution?.action?.status === 'failed')
  if (failed.length) {
    return [
      '我收到了这次反馈，但有一部分没有写入成功。',
      ...failed.map((item) => `- ${item.toolName}：${item.execution.action.errorMessage || '未知错误'}`),
      '已保留原始回复，后面可以继续补录。',
    ].join('\n')
  }

  if (feedback.result === 'DONE') {
    return '已记录：这一步完成了。我把反馈写入了今日日志，下一次会继续围绕当前目标推进。'
  }
  if (feedback.result === 'NOT_DONE') {
    return `已记录：今天没有完成。我的当前判断是 ${feedback.reasonCategory}，下一步建议：${feedback.adjustment}`
  }
  return `已记录这次进展反馈。当前判断：${feedback.result}；下一步：${feedback.adjustment}`
}

async function generateReply(userId, threadId, latestUserContent) {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) return '当前服务器没有配置 DEEPSEEK_API_KEY，所以我只能先保存你的消息。'

  const modelConfig = await prisma.modelConfig.findFirst({ where: { userId, isDefault: true }, orderBy: { createdAt: 'asc' } })
  const apiBaseForModel = String(modelConfig?.apiBase || process.env.DEEPSEEK_API_BASE || 'https://api.deepseek.com').replace(/\/+$/, '')
  const modelName = String(modelConfig?.model || process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash')

  const [goal, history, markdownDocuments] = await Promise.all([
    prisma.goal.findFirst({
      where: { userId, isCurrentFocus: true },
      include: {
        keyResults: true,
        conditions: true,
        dailyActions: { orderBy: { actionDate: 'desc' }, take: 3 },
        reasoningCards: { orderBy: { version: 'desc' }, take: 1 },
      },
    }),
    prisma.agentMessage.findMany({ where: { userId, threadId }, orderBy: { createdAt: 'desc' }, take: 12 }),
    findMarkdownDocuments(userId, latestUserContent),
  ])

  const goalContext = goal
    ? [
        `当前目标：${goal.title}`,
        `解释：${goal.interpretedGoal || goal.rawInput}`,
        `KR：${goal.keyResults.map((kr) => `${kr.title}(${Math.round(kr.progress * 100)}%)`).join('；')}`,
        `条件：${goal.conditions.map((condition) => `${condition.title}[${condition.status}]`).join('；')}`,
        `今日行动：${goal.dailyActions[0]?.title || '暂无'}`,
        `当前推理重点：${goal.reasoningCards[0]?.recommendedFocus || '暂无'}`,
      ].join('\n')
    : '当前还没有主目标。'
  const markdownContext = markdownDocuments.length
    ? markdownDocuments.map((document) => `- ${document.path} [${document.type}]\n${trimForPrompt(document.content, 600)}`).join('\n\n')
    : '暂无 Markdown 文档。'

  const messages = [
    {
      role: 'system',
      content: [
        '你是 Goal Mate 的 QQ 目标秘书。',
        '回答必须简洁、具体、可执行。不要声称你已经修改了目标或设置。',
        '如果需要用户补充信息，只问一个最关键的问题。',
        '',
        '目标上下文：',
        goalContext,
        '',
        '相关 Markdown 文档：',
        markdownContext,
      ].join('\n'),
    },
    ...history.reverse().map((message) => ({
      role: message.role === 'ASSISTANT' ? 'assistant' : 'user',
      content: trimForPrompt(message.content, 1600),
    })),
  ]

  const response = await fetch(`${apiBaseForModel}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: modelName,
      messages,
      temperature: modelConfig?.temperature ?? 0.3,
      max_tokens: 900,
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    return `模型调用失败：${response.status}。${trimForPrompt(text, 180)}`
  }
  const data = await response.json()
  return data?.choices?.[0]?.message?.content?.trim() || '模型返回为空，我已经保存你的消息。'
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

  const userId = await resolveUser(context.contextType, context.contextId, payload)
  if (!userId) {
    await prisma.qqMessageEvent.create({
      data: {
        eventId,
        eventType,
        contextType: context.contextType,
        contextId: context.contextId,
        messageText: context.text,
        payload,
        status: 'FAILED',
      },
    })
    return
  }

  const thread = await findOrCreateThread(userId, context.contextType, context.contextId)
  const userMessage = await prisma.agentMessage.create({
    data: { userId, threadId: thread.id, role: 'USER', content: context.text },
  })

  let reply = ''
  let structuredOutputType = 'qq_reply'
  let structuredOutput = { eventType, eventId, contextType: context.contextType, contextId: context.contextId }

  const pendingAction = isConfirmToolMessage(context.text)
    ? await prisma.agentToolAction.findFirst({
        where: { userId, source: 'qq', agentThreadId: thread.id, status: 'pending_confirmation' },
        orderBy: { createdAt: 'desc' },
      })
    : null

  if (pendingAction) {
    await prisma.agentToolAction.update({ where: { id: pendingAction.id }, data: { status: 'approved' } })
    const execution = await executeQqAgentTool(
      { userId, confirmed: true, agentThreadId: thread.id, agentMessageId: userMessage.id },
      pendingAction.toolName,
      pendingAction.input,
    )
    reply = formatToolReply(pendingAction.toolName, execution)
    structuredOutputType = 'qq_tool_result'
    structuredOutput = {
      ...structuredOutput,
      confirmedActionId: pendingAction.id,
      executedActionId: execution.action?.id,
      toolName: pendingAction.toolName,
      needsConfirmation: execution.needsConfirmation,
    }
  } else {
    const schedulerReply = await processSchedulerReply(userId, thread, userMessage, context)
    if (schedulerReply) {
      reply = schedulerReply
      structuredOutputType = 'qq_scheduler_reply'
      structuredOutput = {
        ...structuredOutput,
        handledAsSchedulerReply: true,
      }
    } else {
      const toolIntent = await generateToolIntent(userId, context.text)
      if (toolIntent) {
      const execution = await executeQqAgentTool(
        { userId, confirmed: false, agentThreadId: thread.id, agentMessageId: userMessage.id },
        toolIntent.toolName,
        toolIntent.input,
      )
      reply = formatToolReply(toolIntent.toolName, execution)
      structuredOutputType = 'qq_tool_result'
      structuredOutput = {
        ...structuredOutput,
        toolIntent,
        toolActionId: execution.action?.id,
        needsConfirmation: execution.needsConfirmation,
      }
      }
    }
  }

  if (!reply) reply = await generateReply(userId, thread.id, context.text)

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
  assertConfig()
  const gatewayUrl = await getGatewayUrl()
  console.log(`[qq] connecting gateway ${gatewayUrl}`)

  const ws = new WebSocket(gatewayUrl)

  ws.on('message', async (raw) => {
    try {
      const packet = JSON.parse(String(raw))
      if (typeof packet.s === 'number') lastSeq = packet.s

      if (packet.op === 10) {
        const interval = packet.d?.heartbeat_interval || 45000
        heartbeatTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op: 1, d: lastSeq }))
        }, interval)
        ws.send(JSON.stringify({
          op: 2,
          d: {
            token: await getAuthHeader(),
            intents,
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
    await sleep(5000)
    connectGateway().catch((error) => console.error('[qq] reconnect failed', error))
  })

  ws.on('error', (error) => {
    console.error('[qq] websocket error', error)
  })
}

process.on('SIGINT', async () => {
  if (heartbeatTimer) clearInterval(heartbeatTimer)
  await prisma.$disconnect()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  if (heartbeatTimer) clearInterval(heartbeatTimer)
  await prisma.$disconnect()
  process.exit(0)
})

connectGateway().catch(async (error) => {
  console.error('[qq] fatal', error)
  await prisma.$disconnect()
  process.exit(1)
})
