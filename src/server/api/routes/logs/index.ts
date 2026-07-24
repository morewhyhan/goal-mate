import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '../../validator'
import { prisma } from '@/lib/db'
import { getCurrentUserId, notFound, unauthorized } from '../../context'
import { upsertMarkdownDocument } from '@/lib/markdown-document-store'

const updateLogSchema = z.object({ content: z.string() })
const patchLogSchema = z.object({
  targetLog: z.string().min(1),
  writeMode: z.enum(['append', 'replace_system_block', 'create']).default('append'),
  markdownContent: z.string().min(1),
  sourceContext: z.array(z.string()).default([]),
})

function isSafeLogPath(path: string) {
  return path.startsWith('logs/')
    && !path.includes('..')
    && !path.includes('\\')
    && !path.startsWith('/')
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

const app = new Hono()
  .basePath('/logs')
  .get('/tree', async (c) => {
    const userId = await getCurrentUserId(c)
    if (!userId) return unauthorized(c)

    const logs = await prisma.markdownDocument.findMany({ where: { userId }, orderBy: { path: 'asc' } })
    return c.json({ data: logs.map((log) => ({ id: log.id, title: log.title, path: log.path, periodType: log.type })) })
  })
  .get('/:id', async (c) => {
    const userId = await getCurrentUserId(c)
    if (!userId) return unauthorized(c)

    const log = await prisma.markdownDocument.findFirst({ where: { id: c.req.param('id'), userId } })
    if (!log) return notFound(c, '日志不存在。')
    return c.json({ data: log })
  })
  .put('/:id', zValidator('json', updateLogSchema), async (c) => {
    const userId = await getCurrentUserId(c)
    if (!userId) return unauthorized(c)

    const id = c.req.param('id')
    const existing = await prisma.markdownDocument.findFirst({ where: { id, userId } })
    if (!existing) return notFound(c, '日志不存在。')

    const log = await upsertMarkdownDocument(prisma, {
      userId,
      path: existing.path,
      title: existing.title,
      type: existing.type,
      content: c.req.valid('json').content,
      frontmatter: asRecord(existing.frontmatter),
      linkedGoalIds: existing.linkedGoalIds as string[] | undefined,
      linkedActionIds: existing.linkedActionIds as string[] | undefined,
      source: 'USER',
    })
    return c.json({ data: log })
  })
  .post('/patch', zValidator('json', patchLogSchema), async (c) => {
    const userId = await getCurrentUserId(c)
    if (!userId) return unauthorized(c)

    const input = c.req.valid('json')
    if (!isSafeLogPath(input.targetLog)) {
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: '日志路径必须位于 logs/ 下，且不能包含路径穿越。' } },
        422,
      )
    }

    const existing = await prisma.markdownDocument.findUnique({ where: { userId_path: { userId, path: input.targetLog } } })
    const nextContent = existing && input.writeMode === 'append'
      ? `${existing.content}\n\n${input.markdownContent}`
      : input.markdownContent

    const log = await upsertMarkdownDocument(prisma, {
      userId,
      path: input.targetLog,
      title: input.targetLog.split('/').pop() || input.targetLog,
      type: 'DAY',
      content: nextContent,
      linkedGoalIds: [],
      linkedActionIds: [],
      source: 'AGENT',
    })

    return c.json({ data: log })
  })

export default app
