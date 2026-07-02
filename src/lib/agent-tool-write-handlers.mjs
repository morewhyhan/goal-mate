import {
  formatAgentToolDatePath,
  normalizeAgentToolActionStatus,
  normalizeAgentToolCheckinResult,
  readAgentToolBoolean,
  readAgentToolNumber,
  readAgentToolString,
  toAgentToolDateInput,
} from './agent-tool-shared.mjs'
import {
  getOrCreateSharedCondition,
  getSharedCurrentGoal,
} from './agent-tool-business-helpers.mjs'

const goalStatuses = new Set(['DRAFT', 'CLARIFYING', 'CONFIRMED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ABANDONED', 'ARCHIVED'])
const DAY_MS = 24 * 60 * 60 * 1000

function normalizeGoalStatus(value, fallback) {
  const normalized = String(value || '').trim().toUpperCase()
  return goalStatuses.has(normalized) ? normalized : fallback
}

function pad(value) {
  return String(value).padStart(2, '0')
}

function getWeekNumber(date) {
  const copied = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = copied.getUTCDay() || 7
  copied.setUTCDate(copied.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(copied.getUTCFullYear(), 0, 1))
  return Math.ceil((((copied.getTime() - yearStart.getTime()) / DAY_MS) + 1) / 7)
}

function buildSharedDailyLogPath(date = new Date()) {
  const year = date.getFullYear()
  const month = `${year}-${pad(date.getMonth() + 1)}`
  const quarter = `Q${Math.floor(date.getMonth() / 3) + 1}`
  const week = `W${pad(getWeekNumber(date))}`
  const day = `${year}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  return `logs/${year}/${quarter}/${month}/${week}/${day}.md`
}

function inferSharedDiagnosis(input) {
  const feedback = String(input.feedback || '').toLowerCase()

  if (input.consecutiveMissCount >= 3) {
    return {
      category: 'PATH',
      adjustmentType: 'REBUILD_PATH',
      evidence: input.feedback || '用户连续多次未完成或部分完成，问题可能不只是行动难度。',
      nextQuestion: '这已经连续几次没有稳定发生了。你觉得是这一步没对准关键条件，还是这个目标本身还没被澄清？',
      proposedNextAction: '暂停继续加任务，先重新判断当前缺口和行动设计是否正确。',
    }
  }

  if (feedback.includes('太难') || feedback.includes('不会') || feedback.includes('累') || feedback.includes('没时间') || (input.estimatedMinutes || 0) > 60) {
    return {
      category: 'ABILITY',
      adjustmentType: 'SIMPLIFY',
      evidence: input.feedback || '行动耗时较长或用户反馈执行成本过高。',
      nextQuestion: '这一步是太大、太难，还是不知道从哪里开始？',
      proposedNextAction: '把下一步缩小到 10 到 20 分钟内可以完成的版本。',
    }
  }

  if (feedback.includes('忘') || feedback.includes('提醒') || feedback.includes('时间不对') || feedback.includes('太晚') || feedback.includes('太早')) {
    return {
      category: 'PROMPT',
      adjustmentType: 'RESCHEDULE',
      evidence: input.feedback || '用户反馈更接近提醒时机或触达问题。',
      nextQuestion: '提醒应该改到哪个时间点，才更接近你真的能行动的窗口？',
      proposedNextAction: '调整提醒时间和话术，不增加提醒频率。',
    }
  }

  if (feedback.includes('不想') || feedback.includes('没意义') || feedback.includes('不重要') || feedback.includes('没动力')) {
    return {
      category: 'MOTIVATION',
      adjustmentType: 'REFRAME_GOAL',
      evidence: input.feedback || '用户反馈目标吸引力不足。',
      nextQuestion: '这个目标现在仍然是你真正想要的吗，还是它更像一个应该做但不想做的目标？',
      proposedNextAction: '重新审查目标动机，而不是继续催促。',
    }
  }

  if (feedback.includes('方向') || feedback.includes('目标') || feedback.includes('不知道为什么') || feedback.includes('不确定')) {
    return {
      category: 'GOAL',
      adjustmentType: 'REFRAME_GOAL',
      evidence: input.feedback || '用户反馈目标或目的不清楚。',
      nextQuestion: '如果这个目标 7 天后真的推进了，你最希望看到的具体变化是什么？',
      proposedNextAction: '回到目标澄清，而不是继续拆任务。',
    }
  }

  return {
    category: 'UNKNOWN',
    adjustmentType: 'SIMPLIFY',
    evidence: input.feedback || '信息不足，需要继续追问未完成原因。',
    nextQuestion: '今天没推进，更接近动作太大、提醒不合适，还是目标吸引力不足？',
    proposedNextAction: '先用一个诊断问题收集原因，再决定缩小、改提醒或重建路径。',
  }
}

function buildSharedCheckinLogBlock(input) {
  const createdAt = input.createdAt || new Date()
  const time = `${pad(createdAt.getHours())}:${pad(createdAt.getMinutes())}`
  return [
    `## Check-in ${time}`,
    '',
    `- 目标：${input.goalTitle}`,
    `- 行动：${input.actionTitle}`,
    input.linkedCondition ? `- 关联条件：${input.linkedCondition}` : undefined,
    input.doneWhen ? `- 完成标准：${input.doneWhen}` : undefined,
    input.minimumStep ? `- 最小启动：${input.minimumStep}` : undefined,
    `- 结果：${input.resultLabel}`,
    input.userFeedback ? `- 用户反馈：${input.userFeedback}` : '- 用户反馈：',
    input.diagnosisQuestion ? `- 诊断问题：${input.diagnosisQuestion}` : undefined,
    input.proposedNextAction ? `- 调整建议：${input.proposedNextAction}` : undefined,
    '',
  ].filter(Boolean).join('\n')
}

export const sharedWriteToolNames = [
  'goal.update',
  'today.set_next_action',
  'checkin.submit',
  'log.write_daily',
  'reminder.schedule',
  'settings.model.update',
]

export function canHandleSharedWriteTool(toolName) {
  return sharedWriteToolNames.includes(toolName)
}

export async function runSharedWriteToolHandler(prisma, userId, toolName, input = {}) {
  if (toolName === 'goal.update') {
    const goal = await getSharedCurrentGoal(prisma, userId, readAgentToolString(input, 'goalId'))
    const isCurrentFocus = readAgentToolBoolean(input, 'isCurrentFocus')
    const nextStatus = normalizeGoalStatus(readAgentToolString(input, 'status', goal.status), goal.status)
    const shouldConfirmReasoning = nextStatus === 'ACTIVE' || nextStatus === 'CONFIRMED' || isCurrentFocus === true

    const result = await prisma.$transaction(async (tx) => {
      if (isCurrentFocus) {
        await tx.goal.updateMany({ where: { userId }, data: { isCurrentFocus: false } })
      }

      const latestCard = shouldConfirmReasoning
        ? await tx.goalReasoningCard.findFirst({
            where: { userId, goalId: goal.id },
            orderBy: { version: 'desc' },
          })
        : null
      if (shouldConfirmReasoning && !latestCard) throw new Error('目标缺少推理卡，不能进入当前推进。')

      const confirmedCard = latestCard
        ? await tx.goalReasoningCard.update({
            where: { id: latestCard.id },
            data: { status: 'CONFIRMED' },
          })
        : null

      const firstStage = shouldConfirmReasoning
        ? await tx.stagePlan.findFirst({ where: { userId, goalId: goal.id }, orderBy: { sortOrder: 'asc' } })
        : null
      if (firstStage && firstStage.status === 'DRAFT') {
        await tx.stagePlan.update({ where: { id: firstStage.id }, data: { status: 'ACTIVE' } })
      }

      const updated = await tx.goal.update({
        where: { id: goal.id },
        data: {
          title: readAgentToolString(input, 'title', goal.title),
          interpretedGoal: readAgentToolString(input, 'interpretedGoal', goal.interpretedGoal || '') || goal.interpretedGoal,
          status: nextStatus,
          isCurrentFocus: typeof isCurrentFocus === 'boolean' ? isCurrentFocus : goal.isCurrentFocus,
          currentReasoningCardId: confirmedCard?.id || goal.currentReasoningCardId,
        },
      })

      return {
        goal: updated,
        reasoningCard: confirmedCard,
        activatedStagePlanId: firstStage?.id || null,
      }
    })
    return { targetId: result.goal.id, result }
  }

  if (toolName === 'today.set_next_action') {
    const title = readAgentToolString(input, 'title')
    if (!title) throw new Error('缺少行动标题。')

    const goal = await getSharedCurrentGoal(prisma, userId, readAgentToolString(input, 'goalId'))
    const condition = await getOrCreateSharedCondition(prisma, userId, goal.id, input)
    const action = await prisma.dailyAction.create({
      data: {
        userId,
        goalId: goal.id,
        conditionId: condition.id,
        actionDate: toAgentToolDateInput(readAgentToolString(input, 'actionDate')),
        title,
        reason: readAgentToolString(input, 'reason', '由 Agent 根据当前推进状态设置。'),
        doneWhen: readAgentToolString(input, 'doneWhen', '用户明确回复已完成，并说明完成结果。'),
        minimumStep: readAgentToolString(input, 'minimumStep', title),
        estimatedMinutes: Math.round(readAgentToolNumber(input, 'estimatedMinutes', 20)),
        fallbackAction: readAgentToolString(input, 'fallbackAction', '如果今天状态很差，只完成最小启动动作。'),
        checkinQuestion: readAgentToolString(input, 'checkinQuestion', '这一步现在能开始吗？'),
        status: 'PLANNED',
      },
    })
    return { targetId: action.id, result: action }
  }

  if (toolName === 'checkin.submit') {
    const actionId = readAgentToolString(input, 'actionId')
    const action = actionId
      ? await prisma.dailyAction.findFirst({ where: { id: actionId, userId }, include: { goal: true, condition: true } })
      : await prisma.dailyAction.findFirst({ where: { userId }, orderBy: { actionDate: 'desc' }, include: { goal: true, condition: true } })
    if (!action) throw new Error('没有找到可提交的今日行动。')

    const result = normalizeAgentToolCheckinResult(readAgentToolString(input, 'result', 'no_response'))
    const userFeedback = readAgentToolString(input, 'userFeedback')
    const resultLabel = result === 'DONE' ? '完成' : result === 'PARTIAL' ? '部分完成' : result === 'NOT_DONE' ? '没做' : '未回应'

    const output = await prisma.$transaction(async (tx) => {
      const checkin = await tx.checkin.create({
        data: {
          userId,
          goalId: action.goalId,
          actionId: action.id,
          result,
          reasonCategory: readAgentToolString(input, 'reasonCategory') || undefined,
          userFeedback,
          adjustment: readAgentToolString(input, 'adjustment'),
        },
      })
      const updatedAction = await tx.dailyAction.update({ where: { id: action.id }, data: { status: normalizeAgentToolActionStatus(result) } })

      let diagnosis = null
      if (result === 'NOT_DONE' || result === 'PARTIAL') {
        const recentMisses = await tx.checkin.findMany({
          where: {
            userId,
            goalId: action.goalId,
            result: { in: ['NOT_DONE', 'PARTIAL'] },
          },
          orderBy: { createdAt: 'desc' },
          take: 3,
        })
        const inferred = inferSharedDiagnosis({
          feedback: userFeedback,
          consecutiveMissCount: recentMisses.length,
          estimatedMinutes: action.estimatedMinutes,
        })
        diagnosis = await tx.diagnosis.create({
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

      const logPath = buildSharedDailyLogPath(action.actionDate)
      const logTitle = logPath.split('/').pop() || logPath
      const logBlock = buildSharedCheckinLogBlock({
        goalTitle: action.goal.title,
        actionTitle: action.title,
        linkedCondition: action.condition.title,
        resultLabel,
        doneWhen: action.doneWhen,
        minimumStep: action.minimumStep,
        userFeedback,
        diagnosisQuestion: diagnosis?.nextQuestion,
        proposedNextAction: diagnosis?.proposedNextAction,
        createdAt: new Date(),
      })

      const existingLog = await tx.logEntry.findUnique({ where: { userId_path: { userId, path: logPath } } })
      const logEntry = await tx.logEntry.upsert({
        where: { userId_path: { userId, path: logPath } },
        update: {
          title: logTitle,
          content: existingLog ? `${existingLog.content}\n\n${logBlock}` : logBlock,
          linkedGoalIds: [action.goalId],
          linkedActionIds: [action.id],
        },
        create: {
          userId,
          periodType: 'DAY',
          title: logTitle,
          path: logPath,
          content: logBlock,
          linkedGoalIds: [action.goalId],
          linkedActionIds: [action.id],
        },
      })

      const markdownDocument = await tx.markdownDocument.upsert({
        where: { userId_path: { userId, path: logPath } },
        update: {
          title: logTitle,
          content: logEntry.content,
          linkedGoalIds: [action.goalId],
          linkedActionIds: [action.id],
          source: 'AGENT',
          frontmatter: {
            kind: 'checkin',
            goalTitle: action.goal.title,
            actionTitle: action.title,
          },
        },
        create: {
          userId,
          type: 'DAY',
          title: logTitle,
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
        },
      })

      return { action: updatedAction, checkin, diagnosis, logEntry, markdownDocument }
    })

    return { targetId: output.checkin.id, result: output }
  }

  if (toolName === 'log.write_daily') {
    const content = readAgentToolString(input, 'content')
    if (!content) throw new Error('缺少日志内容。')

    const date = toAgentToolDateInput(readAgentToolString(input, 'date'))
    const dateInfo = formatAgentToolDatePath(date)
    const title = readAgentToolString(input, 'title', dateInfo.title)
    const linkedGoalIds = input.linkedGoalIds || []
    const linkedActionIds = input.linkedActionIds || []
    const document = await prisma.markdownDocument.upsert({
      where: { userId_path: { userId, path: dateInfo.path } },
      update: {
        title,
        content,
        linkedGoalIds,
        linkedActionIds,
        source: 'AGENT',
      },
      create: {
        userId,
        type: 'DAY',
        title,
        path: dateInfo.path,
        content,
        linkedGoalIds,
        linkedActionIds,
        source: 'AGENT',
      },
    })
    await prisma.logEntry.upsert({
      where: { userId_path: { userId, path: dateInfo.path } },
      update: {
        title,
        content,
        linkedGoalIds,
        linkedActionIds,
      },
      create: {
        userId,
        periodType: 'DAY',
        title,
        path: dateInfo.path,
        content,
        linkedGoalIds,
        linkedActionIds,
      },
    })
    return { targetId: document.id, result: document }
  }

  if (toolName === 'reminder.schedule') {
    const reminderType = readAgentToolString(input, 'reminderType', 'morning_planning')
    const schedule = readAgentToolString(input, 'schedule', '08:30')
    const ruleId = readAgentToolString(input, 'ruleId')
    const data = {
      goalId: readAgentToolString(input, 'goalId') || null,
      reminderType,
      channel: readAgentToolString(input, 'channel', 'qq'),
      schedule,
      timezone: readAgentToolString(input, 'timezone', 'Asia/Shanghai'),
      maxPerDay: Math.round(readAgentToolNumber(input, 'maxPerDay', 2)),
      quietHours: input.quietHours || undefined,
      enabled: readAgentToolBoolean(input, 'enabled') ?? true,
      metadata: input.metadata || undefined,
    }
    const rule = ruleId
      ? await prisma.reminderRule.update({ where: { id: ruleId }, data })
      : await prisma.reminderRule.create({ data: { userId, ...data } })
    return { targetId: rule.id, result: rule }
  }

  if (toolName === 'settings.model.update') {
    const existing = await prisma.modelConfig.findFirst({ where: { userId, isDefault: true }, orderBy: { createdAt: 'asc' } })
    const data = {
      provider: readAgentToolString(input, 'provider', existing?.provider || 'deepseek'),
      model: readAgentToolString(input, 'model', existing?.model || 'deepseek-v4-flash'),
      reasoningModel: readAgentToolString(input, 'reasoningModel', existing?.reasoningModel || ''),
      apiBase: readAgentToolString(input, 'apiBase', existing?.apiBase || 'https://api.deepseek.com'),
      apiKeyRef: readAgentToolString(input, 'apiKeyRef', existing?.apiKeyRef || 'DEEPSEEK_API_KEY'),
      usage: 'CHAT',
      isDefault: true,
      temperature: readAgentToolNumber(input, 'temperature', existing?.temperature ?? 0.3),
    }
    const modelConfig = existing
      ? await prisma.modelConfig.update({ where: { id: existing.id }, data })
      : await prisma.modelConfig.create({ data: { userId, ...data } })
    return { targetId: modelConfig.id, result: modelConfig }
  }

  throw new Error(`共享执行工具暂不支持：${toolName}`)
}
