import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '../../validator'
import { prisma } from '@/lib/db'
import { defaultUserSettings, getCurrentUserId, unauthorized } from '../../context'
import { buildCheckinLogBlock, buildDailyLogPath } from '@/lib/goal-mate-log-format'
import { inferDiagnosis } from '@/lib/goal-mate-diagnosis'
import { upsertMarkdownDocument } from '@/lib/markdown-document-store'

const checkinSchema = z.object({
  actionId: z.string().uuid(),
  result: z.enum(['done', 'partial', 'not_done', 'skipped']),
  userFeedback: z.string().optional(),
})

const resultToActionStatus = {
  done: 'DONE',
  partial: 'PARTIAL',
  not_done: 'NOT_DONE',
  skipped: 'SKIPPED',
} as const

const resultToCheckin = {
  done: 'DONE',
  partial: 'PARTIAL',
  not_done: 'NOT_DONE',
  skipped: 'NO_RESPONSE',
} as const

const resultLabel = {
  done: '完成',
  partial: '部分完成',
  not_done: '没做',
  skipped: '跳过',
} as const

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function readBooleanSetting(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback
}

async function shouldAutoWriteCheckin(userId: string) {
  const settings = await prisma.userSetting.findUnique({ where: { userId } })
  const logs = { ...defaultUserSettings.logs, ...asRecord(settings?.logs) }
  return readBooleanSetting(logs.auto_write_checkin, defaultUserSettings.logs.auto_write_checkin)
}

const app = new Hono()
  .basePath('/today')
  .get('/', async (c) => {
    const userId = await getCurrentUserId(c)
    if (!userId) return unauthorized(c)

    const goal = await prisma.goal.findFirst({
      where: { userId, isCurrentFocus: true },
      include: {
        keyResults: true,
        conditions: true,
        reasoningCards: { where: { status: 'CONFIRMED' }, orderBy: { version: 'desc' }, take: 1 },
        dailyActions: {
          where: { status: 'PLANNED' },
          orderBy: { actionDate: 'asc' },
          take: 1,
          include: { condition: true },
        },
      },
    })

    if (!goal) {
      return c.json(
        { error: { code: 'ACTIVE_GOAL_REQUIRED', message: '还没有当前主目标。' } },
        404,
      )
    }

    return c.json({ data: { goal, action: goal.dailyActions[0] || null } })
  })
  .post('/checkin', zValidator('json', checkinSchema), async (c) => {
    const userId = await getCurrentUserId(c)
    if (!userId) return unauthorized(c)

    const input = c.req.valid('json')
    const action = await prisma.dailyAction.findFirst({
      where: { id: input.actionId, userId },
      include: { goal: true, condition: true },
    })

    if (!action) {
      return c.json({ error: { code: 'NOT_FOUND', message: '今日行动不存在。' } }, 404)
    }

    const updatedAction = await prisma.dailyAction.update({
      where: { id: action.id },
      data: { status: resultToActionStatus[input.result] },
    })

    const checkin = await prisma.checkin.create({
      data: {
        userId,
        goalId: action.goalId,
        actionId: action.id,
        result: resultToCheckin[input.result],
        userFeedback: input.userFeedback,
      },
    })

    let diagnosis = null
    if (input.result === 'not_done' || input.result === 'partial') {
      const recentMisses = await prisma.checkin.findMany({
        where: {
          userId,
          goalId: action.goalId,
          result: { in: ['NOT_DONE', 'PARTIAL'] },
        },
        orderBy: { createdAt: 'desc' },
        take: 3,
      })
      const inferred = inferDiagnosis({
        feedback: input.userFeedback,
        consecutiveMissCount: recentMisses.length,
        estimatedMinutes: action.estimatedMinutes,
      })

      diagnosis = await prisma.diagnosis.create({
        data: {
          userId,
          goalId: action.goalId,
          actionId: action.id,
          checkinId: checkin.id,
          category: inferred.category,
          evidence: inferred.evidence,
          adjustmentType: inferred.adjustmentType,
          nextQuestion: inferred.nextQuestion,
          proposedNextAction: inferred.proposedNextAction,
        },
      })
    }

    let logEntry = null
    let markdownDocument = null
    const autoWriteCheckin = await shouldAutoWriteCheckin(userId)

    if (autoWriteCheckin) {
      const logPath = buildDailyLogPath(action.actionDate)
      const logBlock = buildCheckinLogBlock({
        goalTitle: action.goal.title,
        actionTitle: action.title,
        linkedCondition: action.condition.title,
        result: resultLabel[input.result],
        doneWhen: action.doneWhen,
        minimumStep: action.minimumStep,
        userFeedback: input.userFeedback,
        diagnosisQuestion: diagnosis?.nextQuestion,
        createdAt: new Date(),
      })

      const existingLog = await prisma.logEntry.findUnique({ where: { userId_path: { userId, path: logPath } } })
      logEntry = await prisma.logEntry.upsert({
        where: { userId_path: { userId, path: logPath } },
        update: {
          content: existingLog ? `${existingLog.content}\n\n${logBlock}` : logBlock,
          linkedGoalIds: [action.goalId],
          linkedActionIds: [action.id],
        },
        create: {
          userId,
          periodType: 'DAY',
          title: logPath.split('/').pop() || logPath,
          path: logPath,
          content: logBlock,
          linkedGoalIds: [action.goalId],
          linkedActionIds: [action.id],
        },
      })

      markdownDocument = await upsertMarkdownDocument(prisma, {
        userId,
        type: 'DAY',
        title: logPath.split('/').pop() || logPath,
        path: logPath,
        content: logEntry.content,
        linkedGoalIds: [action.goalId],
        linkedActionIds: [action.id],
        source: 'AGENT',
        frontmatter: {
          kind: 'checkin',
          goalTitle: action.goal.title,
          actionTitle: action.title,
        },
      })
    }

    return c.json({ data: { action: updatedAction, checkin, diagnosis, logEntry, markdownDocument, autoWriteCheckin } })
  })

export default app
