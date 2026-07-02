import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '../../validator'
import { prisma } from '@/lib/db'
import { defaultDeepSeekModel, getCurrentUserId, notFound, unauthorized } from '../../context'

const modelSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  reasoningModel: z.string().optional(),
  apiBase: z.string().min(1),
  apiKeyRef: z.string().min(1),
  usage: z.enum(['CHAT', 'REASONING', 'SUMMARY', 'EMBEDDING']).default('CHAT'),
  isDefault: z.boolean().default(false),
  temperature: z.number().min(0).max(2).optional(),
})

function maskModelConfig(config: any) {
  return { ...config, apiKeyRef: config.apiKeyRef ? 'sk-••••••••••••' : '' }
}

async function ensureDefaultModel(userId: string) {
  const existing = await prisma.modelConfig.findFirst({ where: { userId, provider: defaultDeepSeekModel.provider, usage: defaultDeepSeekModel.usage } })
  if (existing) return existing
  return prisma.modelConfig.create({ data: { ...defaultDeepSeekModel, userId } })
}

const app = new Hono()
  .basePath('/models')
  .get('/', async (c) => {
    const userId = await getCurrentUserId(c)
    if (!userId) return unauthorized(c)

    await ensureDefaultModel(userId)
    const configs = await prisma.modelConfig.findMany({ where: { userId }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] })
    return c.json({ data: configs.map(maskModelConfig) })
  })
  .post('/', zValidator('json', modelSchema), async (c) => {
    const userId = await getCurrentUserId(c)
    if (!userId) return unauthorized(c)

    const input = c.req.valid('json')
    if (input.isDefault) await prisma.modelConfig.updateMany({ where: { userId, usage: input.usage }, data: { isDefault: false } })
    const config = await prisma.modelConfig.create({ data: { ...input, userId } })
    return c.json({ data: maskModelConfig(config) })
  })
  .put('/:id', zValidator('json', modelSchema.partial()), async (c) => {
    const userId = await getCurrentUserId(c)
    if (!userId) return unauthorized(c)

    const id = c.req.param('id')
    const existing = await prisma.modelConfig.findFirst({ where: { id, userId } })
    if (!existing) return notFound(c, '模型配置不存在。')

    const input = c.req.valid('json')
    if (input.isDefault) await prisma.modelConfig.updateMany({ where: { userId, usage: input.usage || existing.usage }, data: { isDefault: false } })
    const config = await prisma.modelConfig.update({ where: { id }, data: input })
    return c.json({ data: maskModelConfig(config) })
  })

export default app
