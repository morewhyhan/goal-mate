import WebSocket from 'ws'
import { PrismaClient } from '@prisma/client'
import { existsSync, readFileSync } from 'node:fs'
import {
  detectConfirmToolMessage,
  formatAgentToolDatePath,
  formatAgentToolReply,
  parseAgentToolIntentJson,
  readAgentToolString,
  sharedAgentToolCatalog,
} from '../lib/agent-tool-shared.mjs'
import {
  executeAgentToolWithPrisma,
} from '../lib/agent-tool-executor.mjs'
import { resolveModelApiKey } from '../lib/model-secret.mjs'
import { chatCompletionsUrl } from '../lib/model-endpoint.mjs'
import { fetchModelProvider } from '../lib/model-provider-http.mjs'
import {
  clearQqBindingCode,
  findQqAccountByBindingCode,
  normalizeQqBindingCode,
  resolveQqBotConfig,
} from '../lib/qq-bot-config.mjs'
import { processQqSchedulerReply } from '../lib/qq-scheduler-reply.mjs'
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

function trimForPrompt(value, max = 900) {
  return value.length > max ? `${value.slice(0, max)}...` : value
}

const isConfirmToolMessage = detectConfirmToolMessage

const qqToolCatalog = sharedAgentToolCatalog

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
  const modelConfig = await prisma.modelConfig.findFirst({ where: { userId, isDefault: true }, orderBy: { createdAt: 'asc' } })
  const apiKey = resolveModelApiKey(modelConfig)
  if (!apiKey) return null

  const apiBaseForModel = String(modelConfig?.apiBase || process.env.GOAL_MATE_MODEL_API_BASE || 'https://api.b.ai').replace(/\/+$/, '')
  const modelName = String(modelConfig?.model || process.env.GOAL_MATE_MODEL || 'gpt-5-nano')

  try {
    const response = await fetchModelProvider(chatCompletionsUrl(apiBaseForModel), {
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
    const parsed = parseAgentToolIntentJson(content)
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

async function executeQqAgentTool({ userId, confirmed, agentThreadId, agentMessageId, source = 'qq' }, toolName, rawInput) {
  return executeAgentToolWithPrisma(
    prisma,
    { userId, source, confirmed, agentThreadId, agentMessageId },
    toolName,
    rawInput,
  )
}

const formatToolReply = formatAgentToolReply

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
  const dateInfo = formatAgentToolDatePath(new Date())
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
      { userId, source: 'scheduler', confirmed: true, agentThreadId: thread.id, agentMessageId: userMessage.id },
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
    { userId, source: 'scheduler', confirmed: true, agentThreadId: thread.id, agentMessageId: userMessage.id },
    'log.write_daily',
    {
      title: formatAgentToolDatePath(new Date()).title,
      content: logContent,
    },
  )
  toolResults.push({ toolName: 'log.write_daily', execution: logExecution })

  if (schedulerEvent.eventType === 'weekly_review') {
    const reviewExecution = await executeQqAgentTool(
      { userId, source: 'scheduler', confirmed: true, agentThreadId: thread.id, agentMessageId: userMessage.id },
      'review.generate',
      { type: 'weekly', nextFocus: feedback.adjustment },
    )
    toolResults.push({ toolName: 'review.generate', execution: reviewExecution })
  }

  if (schedulerEvent.eventType === 'evening_review') {
    const reviewExecution = await executeQqAgentTool(
      { userId, source: 'scheduler', confirmed: true, agentThreadId: thread.id, agentMessageId: userMessage.id },
      'review.generate',
      { type: 'daily', nextFocus: feedback.adjustment },
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
  const modelConfig = await prisma.modelConfig.findFirst({ where: { userId, isDefault: true }, orderBy: { createdAt: 'asc' } })
  const apiKey = resolveModelApiKey(modelConfig)
  if (!apiKey) return '当前用户还没有配置模型 API Key，所以我只能先保存你的消息。请先在 Settings 里填入自己的模型密钥。'

  const apiBaseForModel = String(modelConfig?.apiBase || process.env.GOAL_MATE_MODEL_API_BASE || 'https://api.b.ai').replace(/\/+$/, '')
  const modelName = String(modelConfig?.model || process.env.GOAL_MATE_MODEL || 'gpt-5-nano')

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

  const response = await fetchModelProvider(chatCompletionsUrl(apiBaseForModel), {
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
  let structuredOutput = { eventType, eventId, contextType: context.contextType, contextId: context.contextId }

  const pendingAction = isConfirmToolMessage(context.text)
    ? await prisma.agentToolAction.findFirst({
        where: { userId, source: 'qq', agentThreadId: thread.id, status: 'pending_confirmation' },
        orderBy: { createdAt: 'desc' },
      })
    : null

  if (resolvedUser.justBound) {
    reply = '绑定成功。以后你可以直接在 QQ 里和我说目标、反馈进度，早中晚提醒也会发到这个会话。'
    structuredOutputType = 'qq_binding'
    structuredOutput = {
      ...structuredOutput,
      bound: true,
      bindingCode: resolvedUser.bindingCode,
    }
  } else if (pendingAction) {
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
    const schedulerReply = await processQqSchedulerReply(prisma, {
      userId,
      thread,
      userMessage,
      context,
      executeAgentTool: executeQqAgentTool,
    })
    if (schedulerReply) {
      reply = schedulerReply.reply
      structuredOutputType = 'qq_scheduler_reply'
      structuredOutput = {
        ...structuredOutput,
        handledAsSchedulerReply: true,
        feedback: schedulerReply.feedback,
        schedulerEventId: schedulerReply.schedulerEventId,
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
