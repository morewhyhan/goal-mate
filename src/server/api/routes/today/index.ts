import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '../../validator'
import { prisma } from '@/lib/db'
import { defaultUserSettings, getCurrentUserId, unauthorized } from '../../context'
import { buildCheckinLogBlock, buildDailyLogPath } from '@/lib/goal-mate-log-format'
import { inferDiagnosis } from '@/lib/goal-mate-diagnosis'
import { upsertMarkdownDocument } from '@/lib/markdown-document-store'
import { ensureTodayAction } from '@/lib/today-action-planner.mjs'
import { ensureLogPeriodRollups } from '@/lib/log-period-rollup.mjs'

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

const checkinHeatmapLevel = {
  DONE: 4,
  PARTIAL: 2,
  NOT_DONE: 1,
  NO_RESPONSE: 1,
} as const

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function readBooleanSetting(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback
}

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

async function shouldAutoWriteCheckin(userId: string) {
  const settings = await prisma.userSetting.findUnique({ where: { userId } })
  const logs = { ...defaultUserSettings.logs, ...asRecord(settings?.logs) }
  return readBooleanSetting(logs.auto_write_checkin, defaultUserSettings.logs.auto_write_checkin)
}

function progressSignalFromResult(result: keyof typeof resultToActionStatus) {
  if (result === 'done') return 1
  if (result === 'partial') return 0.5
  return null
}

function scoreConditionStatus(status: string) {
  if (status === 'SATISFIED') return 1
  if (status === 'PARTIAL') return 0.5
  return 0
}

function nextConditionStatus(currentStatus: string, signal: number | null) {
  if (signal === 1) return 'SATISFIED'
  if (signal === 0.5 && currentStatus !== 'SATISFIED') return 'PARTIAL'
  return currentStatus
}

function asStringArray(value: unknown) {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string')
  return []
}

async function applyCheckinProgress(client: any, action: any, result: keyof typeof resultToActionStatus) {
  const signal = progressSignalFromResult(result)
  const condition = await client.goalCondition.findFirst({
    where: { id: action.conditionId, userId: action.userId, goalId: action.goalId },
  })
  const nextStatus = condition ? nextConditionStatus(condition.status, signal) : null
  const updatedCondition = condition && nextStatus !== condition.status
    ? await client.goalCondition.update({ where: { id: condition.id }, data: { status: nextStatus } })
    : condition

  const conditions = await client.goalCondition.findMany({
    where: { userId: action.userId, goalId: action.goalId },
  })
  const effectiveConditions = conditions.map((item: any) => item.id === updatedCondition?.id ? updatedCondition : item)
  const conditionProgress = effectiveConditions.length
    ? effectiveConditions.reduce((total: number, item: any) => total + scoreConditionStatus(item.status), 0) / effectiveConditions.length
    : 0

  const keyResults = signal === null ? [] : await client.keyResult.findMany({
    where: { userId: action.userId, goalId: action.goalId },
  })
  const updatedKeyResults = []
  for (const keyResult of keyResults) {
    const currentProgress = typeof keyResult.progress === 'number' ? keyResult.progress : 0
    const nextProgress = Math.max(currentProgress, Math.min(1, conditionProgress))
    const nextKrStatus = nextProgress >= 1 ? 'ACHIEVED' : keyResult.status === 'ACHIEVED' ? 'ACHIEVED' : 'ACTIVE'
    if (nextProgress !== currentProgress || nextKrStatus !== keyResult.status) {
      updatedKeyResults.push(await client.keyResult.update({
        where: { id: keyResult.id },
        data: { progress: nextProgress, status: nextKrStatus },
      }))
    }
  }

  let updatedStagePlan = null
  if (action.stagePlanId) {
    const stagePlan = await client.stagePlan.findFirst({
      where: { id: action.stagePlanId, userId: action.userId, goalId: action.goalId },
    })
    if (stagePlan) {
      const linkedConditionIds = asStringArray(stagePlan.linkedConditionIds)
      const stageConditions = effectiveConditions.filter((item: any) => {
        return linkedConditionIds.length ? linkedConditionIds.includes(item.id) : item.id === action.conditionId
      })
      const hasProgress = stageConditions.some((item: any) => ['PARTIAL', 'SATISFIED'].includes(item.status))
      const isComplete = stageConditions.length > 0 && stageConditions.every((item: any) => item.status === 'SATISFIED')
      const nextStageStatus = isComplete ? 'COMPLETED' : hasProgress && stagePlan.status === 'DRAFT' ? 'ACTIVE' : stagePlan.status
      if (nextStageStatus !== stagePlan.status) {
        updatedStagePlan = await client.stagePlan.update({
          where: { id: stagePlan.id },
          data: { status: nextStageStatus },
        })
      }
    }
  }

  return {
    condition: updatedCondition,
    keyResults: updatedKeyResults,
    stagePlan: updatedStagePlan,
    conditionProgress,
  }
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

    const progressUpdate = await applyCheckinProgress(prisma, action, input.result)

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

      await ensureLogPeriodRollups(prisma, {
        userId,
        date: action.actionDate,
        sourcePath: logPath,
        sourceKind: 'checkin',
        goalId: action.goalId,
        actionId: action.id,
        goalTitle: action.goal.title,
        actionTitle: action.title,
        resultLabel: resultLabel[input.result],
        conditionTitle: action.condition.title,
        diagnosisQuestion: diagnosis?.nextQuestion,
      })
    }

    return c.json({ data: { action: updatedAction, checkin, diagnosis, progressUpdate, logEntry, markdownDocument, autoWriteCheckin } })
  })

export default app
