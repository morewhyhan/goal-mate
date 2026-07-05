import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '../../validator'
import { prisma } from '@/lib/db'
import { defaultChatModel, defaultUserSettings, getCurrentUserId, unauthorized } from '../../context'
import { AGENT_SYSTEM_PROMPT_VERSION } from '@/lib/agent-prompts'
import { maskModelConfig, resolveModelApiKey } from '@/lib/model-secret.mjs'
import { chatCompletionsUrl } from '@/lib/model-endpoint.mjs'
import { fetchModelProvider } from '@/lib/model-provider-http.mjs'
import { classifyModelProviderFailure, parseModelProviderError } from '@/lib/model-provider-errors'
import { findQqBotAccount, issueQqBindingCode, maskQqBotConfig, resolveQqBotConfig, saveQqBotConfig } from '@/lib/qq-bot-config.mjs'
import { summarizeRuntimeHeartbeat, touchRuntimeHeartbeat } from '@/lib/runtime-heartbeat.mjs'

const settingsSchema = z.object({
  general: z.record(z.string(), z.unknown()).optional(),
  goals: z.record(z.string(), z.unknown()).optional(),
  logs: z.record(z.string(), z.unknown()).optional(),
  today: z.record(z.string(), z.unknown()).optional(),
  agent: z.record(z.string(), z.unknown()).optional(),
  notifications: z.record(z.string(), z.unknown()).optional(),
  dataPrivacy: z.record(z.string(), z.unknown()).optional(),
})

const reminderRuleInputSchema = z.object({
  id: z.string().uuid().optional(),
  reminderType: z.string().min(1),
  channel: z.string().min(1).default('qq'),
  schedule: z.string().min(1),
  timezone: z.string().min(1).default('Asia/Shanghai'),
  maxPerDay: z.number().int().min(1).max(8).default(1),
  quietHours: z.string().min(1).default('23:00-07:30'),
  enabled: z.boolean().default(true),
})

const reminderRulesSchema = z.object({
  rules: z.array(reminderRuleInputSchema).min(1),
})

const qqBotConfigSchema = z.object({
  appId: z.string().trim().optional().default(''),
  token: z.string().trim().optional().default(''),
  apiBase: z.string().trim().optional().default('https://api.sgroup.qq.com'),
  intents: z.coerce.number().int().positive().default(33554432),
  allowedContextIds: z.string().trim().optional().default(''),
  enabled: z.boolean().default(true),
})

const DEFAULT_QQ_MESSAGE_API_BASE = 'https://api.sgroup.qq.com'
const DEFAULT_QQ_TOKEN_API_BASE = 'https://bots.qq.com'

const defaultReminderRules = [
  { reminderType: 'morning_planning', channel: 'qq', schedule: '08:30', timezone: 'Asia/Shanghai', maxPerDay: 1, quietHours: '23:00-07:30', enabled: true },
  { reminderType: 'midday_check', channel: 'qq', schedule: '12:30', timezone: 'Asia/Shanghai', maxPerDay: 1, quietHours: '23:00-07:30', enabled: true },
  { reminderType: 'evening_review', channel: 'qq', schedule: '21:30', timezone: 'Asia/Shanghai', maxPerDay: 1, quietHours: '23:00-07:30', enabled: true },
  { reminderType: 'weekly_review', channel: 'qq', schedule: 'SUN 21:00', timezone: 'Asia/Shanghai', maxPerDay: 1, quietHours: '23:00-07:30', enabled: true },
]

function modelForSettings(config: any) {
  if (!config) return null
  return maskModelConfig(config)
}

function maskContextId(contextId: string) {
  if (!contextId) return ''
  if (contextId.length <= 10) return contextId
  return `${contextId.slice(0, 4)}...${contextId.slice(-6)}`
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function readBooleanSetting(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback
}

function envConfigured(key: string) {
  return typeof process.env[key] === 'string' && process.env[key]!.trim().length > 0
}

function maskEnvValue(value?: string) {
  if (!value) return ''
  if (value.length <= 10) return 'configured'
  return `${value.slice(0, 4)}...${value.slice(-4)}`
}

function deploymentEnvConfig() {
  const minimumRequired = [
    {
      key: 'DATABASE_URL',
      label: '数据库文件',
      configured: envConfigured('DATABASE_URL'),
      secret: false,
      value: process.env.DATABASE_URL || 'file:./goal-mate.db',
      reason: '保存目标、日志、对话、提醒和审计。',
    },
    {
      key: 'NEXT_PUBLIC_APP_URL',
      label: 'Web 访问地址',
      configured: envConfigured('NEXT_PUBLIC_APP_URL'),
      secret: false,
      value: process.env.NEXT_PUBLIC_APP_URL || 'http://服务器IP:3000',
      reason: '登录、前端 API 和回调统一使用这一项。',
    },
    {
      key: 'GOAL_MATE_SECRET',
      label: '本机加密密钥',
      configured: envConfigured('GOAL_MATE_SECRET'),
      secret: true,
      value: maskEnvValue(process.env.GOAL_MATE_SECRET),
      reason: '用于加密 Settings 中保存的模型密钥和机器人 token。',
    },
  ]

  return {
    profile: 'single-server-systemd',
    minimumRequired,
    missingKeys: minimumRequired.filter((item) => !item.configured).map((item) => item.key),
    uiManaged: [
      '模型 provider/model/apiBase/temperature',
      '每个用户自己的模型 API Key',
      'QQ Bot App ID / Token / API Base / Gateway intents',
      '早中晚和周复盘提醒时间',
      'Agent 读取 Goals/Logs/Memory 权限',
      'Check-in/Review 自动写入日志',
      '导出、清除记忆和清除工作区数据',
    ],
    defaulted: [
      { key: 'PORT', value: process.env.PORT || '3000' },
      { key: 'HOSTNAME', value: process.env.HOSTNAME || '0.0.0.0' },
      { key: 'GOAL_MATE_MODEL_API_BASE', value: process.env.GOAL_MATE_MODEL_API_BASE || 'https://api.b.ai' },
      { key: 'GOAL_MATE_MODEL', value: process.env.GOAL_MATE_MODEL || 'gpt-5-nano' },
      { key: 'QQ_BOT_API_BASE', value: process.env.QQ_BOT_API_BASE || 'https://api.sgroup.qq.com' },
      { key: 'QQ_BOT_INTENTS', value: process.env.QQ_BOT_INTENTS || '33554432' },
      { key: 'SCHEDULER_TICK_SECONDS', value: process.env.SCHEDULER_TICK_SECONDS || '60' },
      { key: 'SCHEDULER_TIMEZONE', value: process.env.SCHEDULER_TIMEZONE || 'Asia/Shanghai' },
    ],
    optionalOverrides: [
      'BETTER_AUTH_URL',
      'NEXT_PUBLIC_BETTER_AUTH_URL',
      'QQ_ALLOWED_CONTEXT_IDS',
      'QQ_SCHEDULER_REPLY_WINDOW_HOURS',
    ],
  }
}

async function ensureDefaultModel(userId: string) {
  const existingDefault = await prisma.modelConfig.findFirst({ where: { userId, isDefault: true, usage: defaultChatModel.usage }, orderBy: { updatedAt: 'desc' } })
  if (existingDefault) return existingDefault
  const existing = await prisma.modelConfig.findFirst({ where: { userId, provider: defaultChatModel.provider, usage: defaultChatModel.usage }, orderBy: { updatedAt: 'desc' } })
  if (existing) return existing
  return prisma.modelConfig.create({ data: { ...defaultChatModel, userId } })
}

async function ensureDefaultReminderRules(userId: string) {
  for (const rule of defaultReminderRules) {
    const existing = await prisma.reminderRule.findFirst({
      where: { userId, reminderType: rule.reminderType, channel: rule.channel },
    })
    if (!existing) await prisma.reminderRule.create({ data: { userId, ...rule, quietHours: { range: rule.quietHours }, metadata: { source: 'settings_default' } } })
  }
}

async function probeModelConnection(model: any) {
  const apiKey = resolveModelApiKey(model)
  const apiBase = String(model?.apiBase || defaultChatModel.apiBase).replace(/\/+$/, '')
  const modelName = String(model?.model || defaultChatModel.model)
  const provider = model?.provider || defaultChatModel.provider

  if (!apiKey) {
    return {
      ok: false,
      provider,
      model: modelName,
      reason: 'missing_api_key',
      message: '当前用户没有配置模型 API Key，无法测试连接。',
    }
  }

  try {
    const response = await fetchModelProvider(chatCompletionsUrl(apiBase), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: modelName,
        messages: [{ role: 'user', content: '请只回复 OK，不要解释。' }],
        temperature: 0,
        max_tokens: 300,
      }),
    })

  if (!response.ok) {
    const text = await response.text()
    const rawMessage = parseModelProviderError(text)
    const failure = classifyModelProviderFailure(response.status, rawMessage)
    return {
      ok: false,
        provider,
        model: modelName,
        status: response.status,
        reason: failure.reason,
        message: failure.message,
        rawMessage: rawMessage.slice(0, 240),
      }
    }

    return {
      ok: true,
      provider,
      model: modelName,
      reason: 'ok',
      message: `${provider} 连接成功。`,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      provider,
      model: modelName,
      reason: 'network_error',
      message: `模型连接失败：${message}`,
    }
  }
}

async function probeQqBotConnection(userId: string) {
  const config = await resolveQqBotConfig(prisma, userId)
  if (!config.configured) {
    return {
      ok: false,
      status: 'missing_config',
      message: 'QQ Bot 还没有配置 App ID 和 Token。',
    }
  }

  try {
    const apiBase = String(config.apiBase || DEFAULT_QQ_MESSAGE_API_BASE).replace(/\/+$/, '')
    const tokenBase = apiBase === DEFAULT_QQ_MESSAGE_API_BASE ? DEFAULT_QQ_TOKEN_API_BASE : apiBase
    const tokenResponse = await fetch(`${tokenBase}/app/getAppAccessToken`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ appId: config.appId, clientSecret: config.token }),
    })
    const tokenText = await tokenResponse.text()
    let tokenData: any = null
    try {
      tokenData = tokenText ? JSON.parse(tokenText) : null
    } catch {
      tokenData = tokenText
    }

    if (!tokenResponse.ok || !tokenData?.access_token) {
      return {
        ok: false,
        status: tokenResponse.status,
        message: `QQ access token 获取失败：${tokenText.slice(0, 180)}`,
      }
    }

    const binding = await prisma.qqChatBinding.findFirst({
      where: { userId, status: 'ENABLED' },
      orderBy: { updatedAt: 'desc' },
    })

    if (!binding) {
      return {
        ok: true,
        status: 'token_ok_no_binding',
        message: 'QQ 配置有效。还没有绑定会话，请先在 Settings 生成绑定码，再在 QQ 里发送绑定命令。',
      }
    }

    return {
      ok: true,
      status: 'ready',
      message: `QQ 配置有效，最近绑定：${binding.contextType}:${maskContextId(binding.contextId)}。`,
    }
  } catch (error) {
    return {
      ok: false,
      status: 'request_failed',
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

async function deleteWorkspaceData(userId: string) {
  const [
    externalActionRequests,
    schedulerEvents,
    reminderRules,
    agentToolActions,
    qqMessageEvents,
    qqChatBindings,
    telegramUpdateEvents,
    telegramChatBindings,
    integrationAccounts,
    userSetting,
    modelConfigs,
    markdownDocumentLinks,
    markdownDocuments,
    agentMessages,
    agentThreads,
    reviews,
    diagnoses,
    checkins,
    dailyActions,
    stagePlans,
    conditions,
    keyResults,
    reasoningCards,
    logEntries,
    goals,
  ] = await prisma.$transaction([
    prisma.externalActionRequest.deleteMany({ where: { userId } }),
    prisma.schedulerEvent.deleteMany({ where: { userId } }),
    prisma.reminderRule.deleteMany({ where: { userId } }),
    prisma.agentToolAction.deleteMany({ where: { userId } }),
    prisma.qqMessageEvent.deleteMany({ where: { userId } }),
    prisma.qqChatBinding.deleteMany({ where: { userId } }),
    prisma.telegramUpdateEvent.deleteMany({ where: { userId } }),
    prisma.telegramChatBinding.deleteMany({ where: { userId } }),
    prisma.integrationAccount.deleteMany({ where: { userId } }),
    prisma.userSetting.deleteMany({ where: { userId } }),
    prisma.modelConfig.deleteMany({ where: { userId } }),
    prisma.markdownDocumentLink.deleteMany({ where: { userId } }),
    prisma.markdownDocument.deleteMany({ where: { userId } }),
    prisma.agentMessage.deleteMany({ where: { userId } }),
    prisma.agentThread.deleteMany({ where: { userId } }),
    prisma.review.deleteMany({ where: { userId } }),
    prisma.diagnosis.deleteMany({ where: { userId } }),
    prisma.checkin.deleteMany({ where: { userId } }),
    prisma.dailyAction.deleteMany({ where: { userId } }),
    prisma.stagePlan.deleteMany({ where: { userId } }),
    prisma.goalCondition.deleteMany({ where: { userId } }),
    prisma.keyResult.deleteMany({ where: { userId } }),
    prisma.goalReasoningCard.deleteMany({ where: { userId } }),
    prisma.logEntry.deleteMany({ where: { userId } }),
    prisma.goal.deleteMany({ where: { userId } }),
  ])

  return {
    externalActionRequests: externalActionRequests.count,
    schedulerEvents: schedulerEvents.count,
    reminderRules: reminderRules.count,
    agentToolActions: agentToolActions.count,
    qqMessageEvents: qqMessageEvents.count,
    qqChatBindings: qqChatBindings.count,
    telegramUpdateEvents: telegramUpdateEvents.count,
    telegramChatBindings: telegramChatBindings.count,
    integrationAccounts: integrationAccounts.count,
    userSettings: userSetting.count,
    modelConfigs: modelConfigs.count,
    markdownDocumentLinks: markdownDocumentLinks.count,
    markdownDocuments: markdownDocuments.count,
    agentMessages: agentMessages.count,
    agentThreads: agentThreads.count,
    reviews: reviews.count,
    diagnoses: diagnoses.count,
    checkins: checkins.count,
    dailyActions: dailyActions.count,
    stagePlans: stagePlans.count,
    conditions: conditions.count,
    keyResults: keyResults.count,
    reasoningCards: reasoningCards.count,
    logEntries: logEntries.count,
    goals: goals.count,
  }
}

const app = new Hono()
  .basePath('/settings')
  .get('/control-center', async (c) => {
    const userId = await getCurrentUserId(c)
    if (!userId) return unauthorized(c)
    await touchRuntimeHeartbeat(prisma, {
      service: 'web',
      status: 'ok',
      detail: 'Web/API 正常响应。',
      payload: { route: '/api/settings/control-center' },
    })

    const [settings, model, runtimeHeartbeats] = await Promise.all([
      prisma.userSetting.findUnique({ where: { userId } }),
      ensureDefaultModel(userId),
      prisma.runtimeHeartbeat.findMany(),
      ensureDefaultReminderRules(userId),
    ])
    const heartbeatByService = Object.fromEntries(runtimeHeartbeats.map((item) => [item.service, summarizeRuntimeHeartbeat(item)]))

    const [reminderRules, qqBindings, toolActions, schedulerEvents, recentQqEvent, qqBotAccount] = await Promise.all([
      prisma.reminderRule.findMany({ where: { userId }, orderBy: [{ channel: 'asc' }, { reminderType: 'asc' }] }),
      prisma.qqChatBinding.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' } }),
      prisma.agentToolAction.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 12 }),
      prisma.schedulerEvent.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 8 }),
      prisma.qqMessageEvent.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } }),
      findQqBotAccount(prisma, userId),
    ])
    const modelStatus = modelForSettings(model)
    const qqBotConfig = maskQqBotConfig(qqBotAccount)
    const enabledQqBindings = qqBindings.filter((binding) => binding.status === 'ENABLED')
    const pendingToolActions = toolActions.filter((action) => action.status === 'pending_confirmation')
    const failedToolActions = toolActions.filter((action) => action.status === 'failed')
    const failedSchedulerEvents = schedulerEvents.filter((event) => event.status === 'failed')
    const latestSchedulerEvent = schedulerEvents[0]
    const deploymentConfig = deploymentEnvConfig()
    const recentQqPayload = recentQqEvent?.payload
    const recentQqPayloadRecord =
      recentQqPayload && typeof recentQqPayload === 'object' && !Array.isArray(recentQqPayload)
        ? recentQqPayload as Record<string, unknown>
        : {}
    const recentQqErrorMessage = [
      recentQqPayloadRecord.errorMessage,
      recentQqPayloadRecord.error,
      recentQqPayloadRecord.message,
    ].find((value): value is string => typeof value === 'string' && value.trim().length > 0)
    const recentErrors = [
      ...failedToolActions.map((action) => ({
        source: 'agent_tool',
        id: action.id,
        label: action.toolName,
        message: action.errorMessage || '工具动作失败。',
        createdAt: action.createdAt,
      })),
      ...failedSchedulerEvents.map((event) => ({
        source: 'scheduler',
        id: event.id,
        label: `${event.eventType}/${event.channel}`,
        message: event.errorMessage || '调度事件失败。',
        createdAt: event.createdAt,
      })),
      ...(recentQqEvent?.status === 'failed' ? [{
        source: 'qq',
        id: recentQqEvent.id,
        label: recentQqEvent.eventType,
        message: recentQqErrorMessage || 'QQ 消息处理失败。',
        createdAt: recentQqEvent.createdAt,
      }] : []),
    ].slice(0, 8)

    return c.json({
      data: {
        settings: settings || { userId, ...defaultUserSettings },
        model: modelStatus,
        reminderRules,
        qqBindings: qqBindings.map((binding) => ({
          ...binding,
          contextIdMasked: maskContextId(binding.contextId),
        })),
        toolActions,
        schedulerEvents,
        runtimeStatus: {
          web: {
            ...(heartbeatByService.web || summarizeRuntimeHeartbeat(null)),
            label: heartbeatByService.web?.label || 'Web/API 正常响应',
          },
          qqWorker: heartbeatByService['qq-worker'] || summarizeRuntimeHeartbeat(null),
          schedulerWorker: heartbeatByService['scheduler-worker'] || summarizeRuntimeHeartbeat(null),
          model: {
            status: modelStatus?.apiKeyConfigured ? 'configured' : 'missing_key',
            label: modelStatus?.apiKeyConfigured ? '模型密钥已配置' : '模型密钥缺失',
            evidence: modelStatus ? `${modelStatus.provider}/${modelStatus.model}` : 'missing model config',
          },
          qq: {
            status: qqBotConfig.configured ? enabledQqBindings.length ? 'bound' : 'configured' : 'missing_config',
            label: qqBotConfig.configured ? enabledQqBindings.length ? 'QQ 已配置并已绑定' : 'QQ 已配置，等待绑定码确认' : 'QQ Bot 未配置',
            evidence: recentQqEvent ? `last=${recentQqEvent.status} ${recentQqEvent.eventType}` : `config=${qqBotConfig.source}`,
            lastEventAt: recentQqEvent?.createdAt,
          },
          scheduler: {
            status: latestSchedulerEvent?.status || 'idle',
            label: latestSchedulerEvent ? `Scheduler ${latestSchedulerEvent.status}` : '暂无调度事件',
            evidence: latestSchedulerEvent ? `${latestSchedulerEvent.eventType} ${latestSchedulerEvent.channel}` : 'no scheduler event',
            lastEventAt: latestSchedulerEvent?.createdAt,
          },
          tools: {
            status: failedToolActions.length ? 'failed' : pendingToolActions.length ? 'pending' : 'ok',
            label: failedToolActions.length ? '存在失败工具动作' : pendingToolActions.length ? '存在待确认动作' : '工具审计正常',
            evidence: `pending=${pendingToolActions.length}; failed=${failedToolActions.length}; recent=${toolActions.length}`,
          },
          prompt: {
            status: 'ok',
            label: 'Agent Prompt 已版本化',
            evidence: AGENT_SYSTEM_PROMPT_VERSION,
          },
          deployment: {
            status: deploymentConfig.missingKeys.length ? 'missing' : 'ready',
            label: deploymentConfig.missingKeys.length ? '部署参数未齐' : '部署参数已齐',
            evidence: deploymentConfig.missingKeys.length ? deploymentConfig.missingKeys.join(', ') : `${deploymentConfig.minimumRequired.length}/${deploymentConfig.minimumRequired.length} ready`,
          },
          recentErrors: {
            status: recentErrors.length ? 'attention' : 'ok',
            label: recentErrors.length ? '存在最近错误' : '暂无最近错误',
            evidence: `count=${recentErrors.length}`,
          },
        },
        deploymentConfig,
        qqBotConfig,
        recentErrors,
        permissionPolicy: {
          read: '直接执行',
          draft: '生成草稿',
          execute: '默认需要确认',
          highRisk: '只生成草稿，不自动执行',
        },
      },
    })
  })
  .put('/qq-bot', zValidator('json', qqBotConfigSchema), async (c) => {
    const userId = await getCurrentUserId(c)
    if (!userId) return unauthorized(c)

    const input = c.req.valid('json')
    const saved = await saveQqBotConfig(prisma, userId, input)
    return c.json({ data: saved })
  })
  .post('/qq-bot/binding-code', async (c) => {
    const userId = await getCurrentUserId(c)
    if (!userId) return unauthorized(c)

    const qqBotAccount = await findQqBotAccount(prisma, userId)
    const qqBotConfig = maskQqBotConfig(qqBotAccount)
    if (!qqBotConfig.configured) {
      return c.json({
        error: {
          code: 'QQ_BOT_CONFIG_REQUIRED',
          message: '请先保存 QQ Bot App ID 和 Token，再生成绑定码。',
        },
      }, 400)
    }

    return c.json({ data: await issueQqBindingCode(prisma, userId) })
  })
  .put('/reminders', zValidator('json', reminderRulesSchema), async (c) => {
    const userId = await getCurrentUserId(c)
    if (!userId) return unauthorized(c)

    const input = c.req.valid('json')
    const saved = []
    for (const rule of input.rules) {
      const existing = rule.id
        ? await prisma.reminderRule.findFirst({ where: { id: rule.id, userId } })
        : await prisma.reminderRule.findFirst({ where: { userId, reminderType: rule.reminderType, channel: rule.channel } })

      const data = {
        reminderType: rule.reminderType,
        channel: rule.channel,
        schedule: rule.schedule,
        timezone: rule.timezone,
        maxPerDay: rule.maxPerDay,
        quietHours: { range: rule.quietHours },
        enabled: rule.enabled,
        metadata: { source: 'settings_ui' },
      }

      const nextRule = existing
        ? await prisma.reminderRule.update({ where: { id: existing.id }, data })
        : await prisma.reminderRule.create({ data: { userId, ...data } })
      saved.push(nextRule)
    }

    return c.json({ data: saved })
  })
  .get('/', async (c) => {
    const userId = await getCurrentUserId(c)
    if (!userId) return unauthorized(c)

    const settings = await prisma.userSetting.findUnique({ where: { userId } })
    return c.json({ data: settings || { userId, ...defaultUserSettings } })
  })
  .put('/', zValidator('json', settingsSchema), async (c) => {
    const userId = await getCurrentUserId(c)
    if (!userId) return unauthorized(c)

    const input = c.req.valid('json')
    const merged = {
      general: {
        ...defaultUserSettings.general,
        ...(input.general || {}),
        locale: defaultUserSettings.general.locale,
        timezone: defaultUserSettings.general.timezone,
        week_start: defaultUserSettings.general.week_start,
      },
      goals: { ...defaultUserSettings.goals, ...(input.goals || {}), max_active_goals: 1 },
      logs: {
        ...defaultUserSettings.logs,
        ...(input.logs || {}),
        vault_root: defaultUserSettings.logs.vault_root,
        naming_pattern: defaultUserSettings.logs.naming_pattern,
        preserve_user_edits: true,
      },
      today: { ...defaultUserSettings.today, ...(input.today || {}), generate_time: defaultUserSettings.today.generate_time },
      agent: { ...defaultUserSettings.agent, ...(input.agent || {}) },
      notifications: {
        ...defaultUserSettings.notifications,
        ...(input.notifications || {}),
        channel: defaultUserSettings.notifications.channel,
        max_daily_prompts: defaultUserSettings.notifications.max_daily_prompts,
        morning_checkin_time: defaultUserSettings.notifications.morning_checkin_time,
        evening_review_time: defaultUserSettings.notifications.evening_review_time,
      },
      dataPrivacy: {
        ...defaultUserSettings.dataPrivacy,
        ...(input.dataPrivacy || {}),
        redact_secrets: true,
        local_first_mode: false,
        backup_location: 'export',
      },
    }

    const settings = await prisma.userSetting.upsert({ where: { userId }, update: merged, create: { userId, ...merged } })
    return c.json({ data: settings })
  })
  .post('/models/test', async (c) => {
    const userId = await getCurrentUserId(c)
    if (!userId) return unauthorized(c)
    const model = await prisma.modelConfig.findFirst({ where: { userId, isDefault: true }, orderBy: { createdAt: 'asc' } })
    return c.json({ data: await probeModelConnection(model) })
  })
  .post('/qq-bot/test', async (c) => {
    const userId = await getCurrentUserId(c)
    if (!userId) return unauthorized(c)
    return c.json({ data: await probeQqBotConnection(userId) })
  })
  .delete('/agent-memory', async (c) => {
    const userId = await getCurrentUserId(c)
    if (!userId) return unauthorized(c)

    const [messages, threads] = await prisma.$transaction([
      prisma.agentMessage.deleteMany({ where: { userId } }),
      prisma.agentThread.deleteMany({ where: { userId } }),
    ])

    return c.json({
      data: {
        deletedMessages: messages.count,
        deletedThreads: threads.count,
        retainedAudit: true,
      },
    })
  })
  .delete('/workspace-data', async (c) => {
    const userId = await getCurrentUserId(c)
    if (!userId) return unauthorized(c)

    return c.json({
      data: {
        deleted: await deleteWorkspaceData(userId),
        retainedAccount: true,
      },
    })
  })
  .get('/export', async (c) => {
    const userId = await getCurrentUserId(c)
    if (!userId) return unauthorized(c)

    const settings = await prisma.userSetting.findUnique({ where: { userId } })
    const dataPrivacy = { ...defaultUserSettings.dataPrivacy, ...asRecord(settings?.dataPrivacy) }
    const exportMarkdown = readBooleanSetting(dataPrivacy.export_markdown, defaultUserSettings.dataPrivacy.export_markdown)

    const [goals, logs, markdownDocuments, markdownLinks, threads, models, reminderRules, toolActions, schedulerEvents, qqChatBindings] = await Promise.all([
      prisma.goal.findMany({ where: { userId }, include: { keyResults: true, conditions: true, stagePlans: true, dailyActions: true, reviews: true } }),
      prisma.logEntry.findMany({ where: { userId }, orderBy: { path: 'asc' } }),
      exportMarkdown ? prisma.markdownDocument.findMany({ where: { userId }, orderBy: { path: 'asc' } }) : Promise.resolve([]),
      exportMarkdown ? prisma.markdownDocumentLink.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }) : Promise.resolve([]),
      prisma.agentThread.findMany({ where: { userId }, include: { messages: true } }),
      prisma.modelConfig.findMany({ where: { userId } }),
      prisma.reminderRule.findMany({ where: { userId } }),
      prisma.agentToolAction.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }),
      prisma.schedulerEvent.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }),
      prisma.qqChatBinding.findMany({ where: { userId } }),
    ])

    return c.json({
      data: {
        exportedAt: new Date().toISOString(),
        exportPolicy: {
          exportMarkdown,
          redactSecrets: true,
          requestedRedactSecrets: readBooleanSetting(dataPrivacy.redact_secrets, defaultUserSettings.dataPrivacy.redact_secrets),
        },
        goals,
        logs,
        markdownDocuments,
        markdownLinks,
        agentThreads: threads,
        models: models.map(maskModelConfig),
        settings,
        reminderRules,
        toolActions,
        schedulerEvents,
        qqChatBindings: qqChatBindings.map((binding) => ({ ...binding, contextId: maskContextId(binding.contextId) })),
      },
    })
  })

export default app
