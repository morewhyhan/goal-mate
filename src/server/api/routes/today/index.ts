import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '../../validator'
import { prisma } from '@/lib/db'
import { getCurrentUserId, unauthorized } from '../../context'
import { ensureTodayAction } from '@/lib/today-action-planner.mjs'
import { submitControlLoopFeedback } from '@/lib/control-loop-episode.mjs'

const checkinSchema = z.object({
  actionId: z.string().uuid(),
  result: z.enum(['done', 'partial', 'not_done', 'skipped']),
  userFeedback: z.string().optional(),
})

const checkinHeatmapLevel = {
  DONE: 4,
  PARTIAL: 2,
  NOT_DONE: 1,
  NO_RESPONSE: 1,
} as const

function localDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function buildMomentumDays(checkins: Array<{ createdAt: Date; result: keyof typeof checkinHeatmapLevel }>) {
  const dayMap = new Map<string, { date: string; count: number; level: number }>()
  for (const checkin of checkins) {
    const date = localDateKey(checkin.createdAt)
    const previous = dayMap.get(date) || { date, count: 0, level: 0 }
    dayMap.set(date, {
      date,
      count: previous.count + 1,
      level: Math.max(previous.level, checkinHeatmapLevel[checkin.result] || 0),
    })
  }
  return [...dayMap.values()].sort((left, right) => left.date.localeCompare(right.date))
}

const app = new Hono()
  .basePath('/today')
  .get('/', async (c) => {
    const userId = await getCurrentUserId(c)
    if (!userId) return unauthorized(c)

    const today = await ensureTodayAction(prisma, userId)
    const since = new Date()
    since.setDate(since.getDate() - 370)
    const checkins = await prisma.checkin.findMany({
      where: { userId, createdAt: { gte: since } },
      select: { createdAt: true, result: true },
      orderBy: { createdAt: 'asc' },
    })
    const momentum = buildMomentumDays(checkins)

    if (!today.goal) {
      return c.json(
        { error: { code: 'ACTIVE_GOAL_REQUIRED', message: '还没有当前主目标。' } },
        404,
      )
    }

    return c.json({ data: { ...today, momentum } })
  })
  .post('/checkin', zValidator('json', checkinSchema), async (c) => {
    const userId = await getCurrentUserId(c)
    if (!userId) return unauthorized(c)

    const input = c.req.valid('json')
    const output = await submitControlLoopFeedback(prisma, userId, {
      source: 'today.checkin',
      trigger: 'today_page',
      actionId: input.actionId,
      result: input.result,
      userFeedback: input.userFeedback,
    })

    return c.json({ data: output.result })
  })

export default app
