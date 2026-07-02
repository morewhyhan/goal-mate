import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '../../validator'
import { prisma } from '@/lib/db'
import { defaultDeepSeekModel, defaultUserSettings, getCurrentUserId, unauthorized } from '../../context'

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
  enabled: z.boolean().default(true),
})

const reminderRulesSchema = z.object({
  rules: z.array(reminderRuleInputSchema).min(1),
})

const defaultReminderRules = [
  { reminderType: 'morning_planning', channel: 'qq', schedule: '08:30', timezone: 'Asia/Shanghai', maxPerDay: 1, enabled: true },
  { reminderType: 'midday_check', channel: 'qq', schedule: '12:30', timezone: 'Asia/Shanghai', maxPerDay: 1, enabled: true },
  { reminderType: 'evening_review', channel: 'qq', schedule: '21:30', timezone: 'Asia/Shanghai', maxPerDay: 1, enabled: true },
  { reminderType: 'weekly_review', channel: 'qq', schedule: 'SUN 21:00', timezone: 'Asia/Shanghai', maxPerDay: 1, enabled: true },
]

function redactModel(config: any) {
  return { ...config, apiKeyRef: config.apiKeyRef ? 'sk-••••••••••••' : '' }
}

function modelForSettings(config: any) {
  if (!config) return null
  return {
    ...config,
    apiKeyRef: config.apiKeyRef || 'DEEPSEEK_API_KEY',
    apiKeyConfigured: Boolean(process.env[config.apiKeyRef || 'DEEPSEEK_API_KEY'] || process.env.DEEPSEEK_API_KEY),
  }
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

async function ensureDefaultModel(userId: string) {
  const existing = await prisma.modelConfig.findFirst({ where: { userId, provider: defaultDeepSeekModel.provider, usage: defaultDeepSeekModel.usage } })
  if (existing) return existing
  return prisma.modelConfig.create({ data: { ...defaultDeepSeekModel, userId } })
}

async function ensureDefaultReminderRules(userId: string) {
  for (const rule of defaultReminderRules) {
    const existing = await prisma.reminderRule.findFirst({
      where: { userId, reminderType: rule.reminderType, channel: rule.channel },
    })
    if (!existing) await prisma.reminderRule.create({ data: { userId, ...rule, metadata: { source: 'settings_default' } } })
  }
}

async function probeModelConnection(model: any) {
  const apiKey = process.env.DEEPSEEK_API_KEY
  const apiBase = String(model?.apiBase || defaultDeepSeekModel.apiBase).replace(/\/+$/, '')
  const modelName = String(model?.model || defaultDeepSeekModel.model)

  if (!apiKey) {
    return {
      ok: false,
      provider: model?.provider || defaultDeepSeekModel.provider,
      model: modelName,
      message: '缺少 DEEPSEEK_API_KEY，无法测试模型连接。',
    }
  }

  try {
    const response = await fetch(`${apiBase}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: modelName,
        messages: [{ role: 'user', content: 'ping' }],
        temperature: 0,
        max_tokens: 1,
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      return {
        ok: false,
        provider: model?.provider || defaultDeepSeekModel.provider,
        model: modelName,
        status: response.status,
        message: text.slice(0, 240),
      }
    }

    return {
      ok: true,
      provider: model?.provider || defaultDeepSeekModel.provider,
      model: modelName,
      message: 'DeepSeek 连接成功。',
    }
  } catch (error) {
    return {
      ok: false,
      provider: model?.provider || defaultDeepSeekModel.provider,
      model: modelName,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

const app = new Hono()
  .basePath('/settings')
  .get('/control-center', async (c) => {
    const userId = await getCurrentUserId(c)
    if (!userId) return unauthorized(c)

    const [settings, model] = await Promise.all([
      prisma.userSetting.findUnique({ where: { userId } }),
      ensureDefaultModel(userId),
      ensureDefaultReminderRules(userId),
    ])

    const [reminderRules, qqBindings, toolActions, schedulerEvents, recentQqEvent] = await Promise.all([
      prisma.reminderRule.findMany({ where: { userId }, orderBy: [{ channel: 'asc' }, { reminderType: 'asc' }] }),
      prisma.qqChatBinding.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' } }),
      prisma.agentToolAction.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 12 }),
      prisma.schedulerEvent.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 8 }),
      prisma.qqMessageEvent.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } }),
    ])
    const modelStatus = modelForSettings(model)
    const enabledQqBindings = qqBindings.filter((binding) => binding.status === 'ENABLED')
    const pendingToolActions = toolActions.filter((action) => action.status === 'pending_confirmation')
    const failedToolActions = toolActions.filter((action) => action.status === 'failed')
    const latestSchedulerEvent = schedulerEvents[0]

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
            status: 'ok',
            label: 'Web/API 正常响应',
            evidence: 'Settings Control Center loaded.',
          },
          model: {
            status: modelStatus?.apiKeyConfigured ? 'configured' : 'missing_key',
            label: modelStatus?.apiKeyConfigured ? '模型密钥已配置' : '模型密钥缺失',
            evidence: modelStatus ? `${modelStatus.provider}/${modelStatus.model}` : 'missing model config',
          },
          qq: {
            status: enabledQqBindings.length ? 'bound' : 'not_bound',
            label: enabledQqBindings.length ? 'QQ 已绑定' : 'QQ 未绑定',
            evidence: recentQqEvent ? `last=${recentQqEvent.status} ${recentQqEvent.eventType}` : 'no qq message event',
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
        },
        permissionPolicy: {
          read: '直接执行',
          draft: '生成草稿',
          execute: '默认需要确认',
          highRisk: '只生成草稿，不自动执行',
        },
      },
    })
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
      general: { ...defaultUserSettings.general, ...(input.general || {}) },
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
      notifications: { ...defaultUserSettings.notifications, ...(input.notifications || {}) },
      dataPrivacy: { ...defaultUserSettings.dataPrivacy, ...(input.dataPrivacy || {}), redact_secrets: true },
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
        models: models.map(redactModel),
        settings,
        reminderRules,
        toolActions,
        schedulerEvents,
        qqChatBindings: qqChatBindings.map((binding) => ({ ...binding, contextId: maskContextId(binding.contextId) })),
      },
    })
  })

export default app
