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

function redactModel(config: any) {
  return { ...config, apiKeyRef: config.apiKeyRef ? 'sk-••••••••••••' : '' }
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
      goals: { ...defaultUserSettings.goals, ...(input.goals || {}) },
      logs: { ...defaultUserSettings.logs, ...(input.logs || {}) },
      today: { ...defaultUserSettings.today, ...(input.today || {}) },
      agent: { ...defaultUserSettings.agent, ...(input.agent || {}) },
      notifications: { ...defaultUserSettings.notifications, ...(input.notifications || {}) },
      dataPrivacy: { ...defaultUserSettings.dataPrivacy, ...(input.dataPrivacy || {}) },
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

    const [goals, logs, markdownDocuments, markdownLinks, threads, models, settings] = await Promise.all([
      prisma.goal.findMany({ where: { userId }, include: { keyResults: true, conditions: true, stagePlans: true, dailyActions: true, reviews: true } }),
      prisma.logEntry.findMany({ where: { userId }, orderBy: { path: 'asc' } }),
      prisma.markdownDocument.findMany({ where: { userId }, orderBy: { path: 'asc' } }),
      prisma.markdownDocumentLink.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
      prisma.agentThread.findMany({ where: { userId }, include: { messages: true } }),
      prisma.modelConfig.findMany({ where: { userId } }),
      prisma.userSetting.findUnique({ where: { userId } }),
    ])

    return c.json({ data: { exportedAt: new Date().toISOString(), goals, logs, markdownDocuments, markdownLinks, agentThreads: threads, models: models.map(redactModel), settings } })
  })

export default app
