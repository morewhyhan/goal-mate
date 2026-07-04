import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '../../validator'
import { prisma } from '@/lib/db'
import { getCurrentUserId, notFound, unauthorized } from '../../context'

const reasoningDraftSchema = z.object({
  goalId: z.string().uuid(),
  purposeSummary: z.string().min(1),
  successSignals: z.array(z.string()).min(1),
  sufficientConditionSet: z.string().min(1),
  currentGapConditionId: z.string().uuid().optional(),
  recommendedFocus: z.string().min(1),
  confidenceScore: z.number().min(0).max(1).default(0.6),
  evidence: z.array(z.string()).default([]),
})

const app = new Hono()
  .basePath('/goals')
  .get('/', async (c) => {
    const userId = await getCurrentUserId(c)
    if (!userId) return unauthorized(c)

    const goals = await prisma.goal.findMany({
      where: { userId },
      orderBy: [{ isCurrentFocus: 'desc' }, { updatedAt: 'desc' }],
      include: {
        keyResults: true,
        conditions: true,
        stagePlans: true,
        dailyActions: { orderBy: { actionDate: 'desc' }, take: 1 },
        checkins: { orderBy: { createdAt: 'desc' }, take: 5 },
        diagnoses: { orderBy: { createdAt: 'desc' }, take: 5 },
        reasoningCards: { where: { status: 'CONFIRMED' }, orderBy: { version: 'desc' }, take: 1 },
      },
    })

    return c.json({ data: goals })
  })
  .get('/:id', async (c) => {
    const userId = await getCurrentUserId(c)
    if (!userId) return unauthorized(c)

    const goal = await prisma.goal.findFirst({
      where: { id: c.req.param('id'), userId },
      include: {
        keyResults: true,
        conditions: true,
        stagePlans: { orderBy: { sortOrder: 'asc' } },
        dailyActions: { orderBy: { actionDate: 'desc' } },
        checkins: { orderBy: { createdAt: 'desc' }, take: 20 },
        diagnoses: { orderBy: { createdAt: 'desc' }, take: 20 },
        reviews: { orderBy: { periodStart: 'desc' } },
        reasoningCards: { orderBy: { version: 'desc' } },
      },
    })

    if (!goal) return notFound(c, '目标不存在。')
    return c.json({ data: goal })
  })
  .post('/reasoning-card/draft', zValidator('json', reasoningDraftSchema), async (c) => {
    const userId = await getCurrentUserId(c)
    if (!userId) return unauthorized(c)

    const input = c.req.valid('json')
    const goal = await prisma.goal.findFirst({ where: { id: input.goalId, userId } })
    if (!goal) return notFound(c, '目标不存在。')

    const lastCard = await prisma.goalReasoningCard.findFirst({
      where: { goalId: input.goalId, userId },
      orderBy: { version: 'desc' },
    })

    const card = await prisma.goalReasoningCard.create({
      data: {
        userId,
        goalId: input.goalId,
        version: (lastCard?.version || 0) + 1,
        purposeSummary: input.purposeSummary,
        successSignals: input.successSignals,
        sufficientConditionSet: input.sufficientConditionSet,
        currentGapConditionId: input.currentGapConditionId,
        recommendedFocus: input.recommendedFocus,
        confidenceScore: input.confidenceScore,
        evidence: input.evidence,
        status: 'PENDING_USER_CONFIRMATION',
      },
    })

    return c.json({ data: card })
  })
  .post('/reasoning-card/:id/confirm', async (c) => {
    const userId = await getCurrentUserId(c)
    if (!userId) return unauthorized(c)

    const id = c.req.param('id')
    const card = await prisma.goalReasoningCard.findFirst({ where: { id, userId } })
    if (!card) return notFound(c, '目标推理卡不存在。')

    await prisma.goalReasoningCard.updateMany({
      where: { goalId: card.goalId, userId, status: 'CONFIRMED' },
      data: { status: 'STALE' },
    })

    const confirmed = await prisma.goalReasoningCard.update({ where: { id }, data: { status: 'CONFIRMED' } })
    await prisma.goal.updateMany({
      where: { id: card.goalId, userId },
      data: { status: 'CONFIRMED', currentReasoningCardId: id },
    })

    return c.json({ data: confirmed })
  })

export default app
