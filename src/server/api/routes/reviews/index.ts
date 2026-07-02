import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '../../validator'
import { prisma } from '@/lib/db'
import { getCurrentUserId, notFound, unauthorized } from '../../context'
import { buildReviewLogPath, buildReviewMarkdown, reviewTypeToPeriodType, reviewTypeToPrismaType } from '@/lib/goal-mate-review-format'
import { upsertMarkdownDocument } from '@/lib/markdown-document-store'

const generateReviewSchema = z.object({
  goalId: z.string().uuid().optional(),
  type: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'goal_cycle']).default('weekly'),
  periodStart: z.string().optional(),
  periodEnd: z.string().optional(),
})

const app = new Hono()
  .basePath('/reviews')
  .post('/generate', zValidator('json', generateReviewSchema), async (c) => {
    const userId = await getCurrentUserId(c)
    if (!userId) return unauthorized(c)

    const input = c.req.valid('json')
    const goal = await prisma.goal.findFirst({
      where: input.goalId ? { id: input.goalId, userId } : { userId, isCurrentFocus: true },
      include: {
        keyResults: true,
        conditions: true,
        checkins: { orderBy: { createdAt: 'desc' }, take: 50 },
        diagnoses: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    })

    if (!goal) return notFound(c, '目标不存在。')

    const periodEnd = input.periodEnd ? new Date(input.periodEnd) : new Date()
    const periodStart = input.periodStart ? new Date(input.periodStart) : new Date(periodEnd.getTime() - 7 * 24 * 60 * 60 * 1000)
    const markdown = buildReviewMarkdown({
      type: input.type,
      goalTitle: goal.title,
      keyResults: goal.keyResults,
      conditions: goal.conditions,
      checkins: goal.checkins,
      diagnoses: goal.diagnoses,
    })

    const logPath = buildReviewLogPath(input.type, periodEnd)
    const existingLog = await prisma.logEntry.findUnique({ where: { userId_path: { userId, path: logPath } } })
    const logEntry = await prisma.logEntry.upsert({
      where: { userId_path: { userId, path: logPath } },
      update: { content: existingLog ? `${existingLog.content}\n\n${markdown}` : markdown, linkedGoalIds: [goal.id] },
      create: {
        userId,
        periodType: reviewTypeToPeriodType(input.type),
        title: logPath.split('/').pop() || logPath,
        path: logPath,
        content: markdown,
        linkedGoalIds: [goal.id],
        linkedActionIds: [],
      },
    })

    const markdownDocument = await upsertMarkdownDocument(prisma, {
      userId,
      type: reviewTypeToPeriodType(input.type),
      title: logPath.split('/').pop() || logPath,
      path: logPath,
      content: logEntry.content,
      linkedGoalIds: [goal.id],
      linkedActionIds: [],
      source: 'AGENT',
      frontmatter: {
        kind: 'review',
        reviewType: input.type,
        goalTitle: goal.title,
      },
    })

    const review = await prisma.review.create({
      data: {
        userId,
        goalId: goal.id,
        type: reviewTypeToPrismaType(input.type),
        periodStart,
        periodEnd,
        progressSummary: `本周期围绕「${goal.title}」生成复盘草案。`,
        conditionChanges: goal.conditions.map((condition) => ({ title: condition.title, status: condition.status })),
        blockerSummary: goal.diagnoses[0]?.nextQuestion || '暂无明确阻塞。',
        nextFocus: goal.conditions.find((condition) => condition.status !== 'SATISFIED')?.title || '继续保持当前节奏。',
        logEntryId: logEntry.id,
      },
    })

    return c.json({ data: { review, logEntry, markdownDocument, markdown } })
  })

export default app
