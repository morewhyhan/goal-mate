import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '../../validator'
import { prisma } from '@/lib/db'
import { defaultUserSettings, getCurrentUserId, notFound, unauthorized } from '../../context'
import { buildReviewLogPath, buildReviewMarkdown, reviewTypeToPeriodType, reviewTypeToPrismaType } from '@/lib/goal-mate-review-format'
import { upsertMarkdownDocument } from '@/lib/markdown-document-store'
import { ensureLogPeriodRollups } from '@/lib/log-period-rollup.mjs'
import { applyReviewStateUpdate } from '@/lib/review-state-update.mjs'
import {
  buildMetaCognitionFromReview,
  evaluateInterventionEffectiveness,
  evaluateMetaCognitionHypotheses,
  loadMetaCognitionHypotheses,
  persistMetaCognitionEvaluations,
  persistMetaCognitionHypothesis,
} from '@/lib/meta-cognition-layer.mjs'

const generateReviewSchema = z.object({
  goalId: z.string().uuid().optional(),
  type: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'goal_cycle']).optional(),
  periodStart: z.string().optional(),
  periodEnd: z.string().optional(),
})

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function readBooleanSetting(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback
}

function normalizeReviewCadence(value: unknown) {
  const normalized = String(value || '').toLowerCase()
  if (normalized === 'daily') return 'daily'
  if (normalized === 'monthly') return 'monthly'
  if (normalized === 'quarterly') return 'quarterly'
  if (normalized === 'yearly') return 'yearly'
  if (normalized === 'goal_cycle') return 'goal_cycle'
  return 'weekly'
}

async function readReviewSettings(userId: string) {
  const settings = await prisma.userSetting.findUnique({ where: { userId } })
  const logs = { ...defaultUserSettings.logs, ...asRecord(settings?.logs) }
  const goals = { ...defaultUserSettings.goals, ...asRecord(settings?.goals) }
  return {
    autoWriteReview: readBooleanSetting(logs.auto_write_review, defaultUserSettings.logs.auto_write_review),
    reviewType: normalizeReviewCadence(goals.review_cadence),
  }
}

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
        stagePlans: { orderBy: { sortOrder: 'asc' } },
        reasoningCards: { orderBy: { version: 'desc' }, take: 1 },
        checkins: { orderBy: { createdAt: 'desc' }, take: 50 },
        diagnoses: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    })

    if (!goal) return notFound(c, '目标不存在。')

    const reviewSettings = await readReviewSettings(userId)
    const reviewType = input.type || reviewSettings.reviewType
    const periodEnd = input.periodEnd ? new Date(input.periodEnd) : new Date()
    const periodStart = input.periodStart ? new Date(input.periodStart) : new Date(periodEnd.getTime() - 7 * 24 * 60 * 60 * 1000)
    const autoWriteReview = reviewSettings.autoWriteReview
    const { review, logEntry, markdownDocument, markdown, stateUpdate, interventionEffectiveness, metaCognition, metaEvaluations, metaCognitionEvaluationWrite } = await prisma.$transaction(async (tx) => {
      const stateUpdate = await applyReviewStateUpdate(tx, userId, goal.id)
      const latestSchedulerEvent = await tx.schedulerEvent.findFirst({
        where: { userId, status: { in: ['sent', 'responded', 'failed'] } },
        orderBy: { createdAt: 'desc' },
      })
      const interventionDecision = asRecord(latestSchedulerEvent?.payload).intervention_decision
      const interventionEffectiveness = evaluateInterventionEffectiveness({
        interventionDecision,
        checkins: goal.checkins,
        diagnoses: goal.diagnoses,
      })
      const activeMetaCognition = await loadMetaCognitionHypotheses(tx, userId, { goalId: goal.id })
      const metaEvaluations = evaluateMetaCognitionHypotheses(activeMetaCognition, {
        checkin: goal.checkins[0],
        diagnosis: goal.diagnoses[0],
        interventionDecision,
      })
      const metaCognitionEvaluationWrite = await persistMetaCognitionEvaluations(tx, userId, metaEvaluations, {
        goalId: goal.id,
        source: 'review.generate',
      })
      const metaHypothesis = buildMetaCognitionFromReview({
        userId,
        goal,
        checkins: goal.checkins,
        diagnoses: goal.diagnoses,
        interventionDecision,
        interventionEvaluation: interventionEffectiveness,
      })
      const metaCognition = await persistMetaCognitionHypothesis(tx, userId, metaHypothesis, {
        goalId: goal.id,
        source: 'review.generate',
        evaluations: metaEvaluations,
      })
      const markdown = buildReviewMarkdown({
        type: reviewType,
        goalTitle: goal.title,
        keyResults: goal.keyResults,
        conditions: goal.conditions,
        checkins: goal.checkins,
        diagnoses: goal.diagnoses,
        interventionEffectiveness,
        metaEvaluations,
      })
      let logEntry = null
      let markdownDocument = null
      if (autoWriteReview) {
        const logPath = buildReviewLogPath(reviewType, periodEnd)
        const existingLog = await tx.logEntry.findUnique({ where: { userId_path: { userId, path: logPath } } })
        logEntry = await tx.logEntry.upsert({
          where: { userId_path: { userId, path: logPath } },
          update: { content: existingLog ? `${existingLog.content}\n\n${markdown}` : markdown, linkedGoalIds: [goal.id] },
          create: {
            userId,
            periodType: reviewTypeToPeriodType(reviewType),
            title: logPath.split('/').pop() || logPath,
            path: logPath,
            content: markdown,
            linkedGoalIds: [goal.id],
            linkedActionIds: [],
          },
        })

        markdownDocument = await upsertMarkdownDocument(tx, {
          userId,
          type: reviewTypeToPeriodType(reviewType),
          title: logPath.split('/').pop() || logPath,
          path: logPath,
          content: logEntry.content,
          linkedGoalIds: [goal.id],
          linkedActionIds: [],
          source: 'AGENT',
          frontmatter: {
            kind: 'review',
            reviewType,
            goalTitle: goal.title,
            interventionEffectiveness,
            metaCognitionEvaluations: metaEvaluations,
            metaCognitionHypothesis: metaCognition.saved ? metaCognition.hypothesis : null,
          },
        })

        await ensureLogPeriodRollups(tx, {
          userId,
          date: periodEnd,
          sourcePath: logPath,
          sourceKind: `${reviewType}_review`,
          goalId: goal.id,
          goalTitle: goal.title,
          resultLabel: '复盘已生成',
          conditionTitle: goal.conditions.find((condition) => condition.status !== 'SATISFIED')?.title,
          diagnosisQuestion: goal.diagnoses[0]?.nextQuestion,
        })
      }

      const review = await tx.review.create({
        data: {
          userId,
          goalId: goal.id,
          type: reviewTypeToPrismaType(reviewType),
          periodStart,
          periodEnd,
          progressSummary: `本周期围绕「${goal.title}」生成复盘草案。`,
          conditionChanges: stateUpdate.conditionChanges,
          blockerSummary: stateUpdate.blockerSummary,
          nextFocus: stateUpdate.nextFocus,
          logEntryId: logEntry?.id,
        },
      })

      return { review, logEntry, markdownDocument, markdown, stateUpdate, interventionEffectiveness, metaCognition, metaEvaluations, metaCognitionEvaluationWrite }
    })

    return c.json({ data: { review, logEntry, markdownDocument, markdown, autoWriteReview, reviewType, stateUpdate, interventionEffectiveness, metaCognition, metaEvaluations, metaCognitionEvaluationWrite } })
  })

export default app
