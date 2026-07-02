import WebSocket from 'ws'
import { PrismaClient } from '@prisma/client'
import { existsSync, readFileSync } from 'node:fs'
import {
  asAgentToolRecord,
  compactAgentToolSummary,
  detectConfirmToolMessage,
  formatAgentToolDatePath,
  formatAgentToolReply,
  parseAgentToolIntentJson,
  readAgentToolString,
  sharedAgentToolCatalog,
} from '../lib/agent-tool-shared.mjs'
import {
  canHandleSharedReadDraftTool,
  runSharedReadDraftToolHandler,
} from '../lib/agent-tool-read-handlers.mjs'
import {
  canHandleSharedWriteTool,
  runSharedWriteToolHandler,
} from '../lib/agent-tool-write-handlers.mjs'

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

const isConfirmToolMessage = detectConfirmToolMessage

const qqToolCatalog = sharedAgentToolCatalog

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

async function runQqToolHandler(userId, toolName, input) {
  if (canHandleSharedReadDraftTool(toolName)) {
    return runSharedReadDraftToolHandler(prisma, userId, toolName, input)
  }
  if (canHandleSharedWriteTool(toolName)) {
    return runSharedWriteToolHandler(prisma, userId, toolName, input)
  }

  throw new Error(`未知 Agent 工具：${toolName}`)
}

async function executeQqAgentTool({ userId, confirmed, agentThreadId, agentMessageId }, toolName, rawInput) {
  const definition = qqToolCatalog.find((item) => item.name === toolName)
  if (!definition) throw new Error(`未知 Agent 工具：${toolName}`)
  const input = asAgentToolRecord(rawInput)
  const requiresConfirmation = definition.permission === 'execute' && !confirmed

  if (requiresConfirmation) {
    const action = await prisma.agentToolAction.create({
      data: {
        userId,
        source: 'qq',
        toolName: definition.name,
        permission: definition.permission,
        inputSummary: compactAgentToolSummary(input),
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
        inputSummary: compactAgentToolSummary(input),
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
        inputSummary: compactAgentToolSummary(input),
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
      title: formatAgentToolDatePath(new Date()).title,
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
