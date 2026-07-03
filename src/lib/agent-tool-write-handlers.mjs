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
import { ensureLogPeriodRollups } from './log-period-rollup.mjs'
import { buildMetaCognitionHypothesis, persistMetaCognitionHypothesis } from './meta-cognition-layer.mjs'
import { submitControlLoopFeedback } from './control-loop-episode.mjs'
import { modelSecretWriteData } from './model-secret.mjs'

const goalStatuses = new Set(['DRAFT', 'CLARIFYING', 'CONFIRMED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ABANDONED', 'ARCHIVED'])
const keyResultStatuses = new Set(['ACTIVE', 'ACHIEVED', 'AT_RISK', 'ABANDONED'])
const metricTypes = new Set(['BOOLEAN', 'COUNT', 'PERCENT', 'WEIGHT', 'TEXT'])
const conditionTypes = new Set(['HARD', 'ASSUMED', 'SUPPORTING'])
const conditionStatuses = new Set(['MISSING', 'PARTIAL', 'SATISFIED', 'INVALIDATED'])
const stageStatuses = new Set(['DRAFT', 'ACTIVE', 'COMPLETED', 'ADJUSTED', 'CANCELLED'])
const DAY_MS = 24 * 60 * 60 * 1000

function normalizeGoalStatus(value, fallback) {
  const normalized = String(value || '').trim().toUpperCase()
  return goalStatuses.has(normalized) ? normalized : fallback
}

function normalizeEnum(value, allowed, fallback) {
  const normalized = String(value || '').trim().toUpperCase()
  return allowed.has(normalized) ? normalized : fallback
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function readOptionalNumber(input, key) {
  const value = input?.[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return undefined
}

async function readSharedLogBooleanSetting(prisma, userId, key, fallback) {
  const settings = await prisma.userSetting.findUnique({ where: { userId } })
  const logs = asObject(settings?.logs)
  return typeof logs[key] === 'boolean' ? logs[key] : fallback
}

async function upsertGoalKeyResults(tx, userId, goalId, inputItems) {
  const updated = []
  for (const rawItem of asArray(inputItems)) {
    const item = asObject(rawItem)
    const id = readAgentToolString(item, 'id')
    const title = readAgentToolString(item, 'title')
    const existing = id
      ? await tx.keyResult.findFirst({ where: { id, userId, goalId } })
      : title
        ? await tx.keyResult.findFirst({ where: { userId, goalId, title } })
        : null
    const progress = readOptionalNumber(item, 'progress')
    const data = {
      ...(title ? { title } : {}),
      ...(readAgentToolString(item, 'metricType') ? { metricType: normalizeEnum(readAgentToolString(item, 'metricType'), metricTypes, existing?.metricType || 'TEXT') } : {}),
      ...(readAgentToolString(item, 'currentValue') ? { currentValue: readAgentToolString(item, 'currentValue') } : {}),
      ...(readAgentToolString(item, 'targetValue') ? { targetValue: readAgentToolString(item, 'targetValue') } : {}),
      ...(progress !== undefined ? { progress: Math.max(0, Math.min(1, progress)) } : {}),
      ...(readAgentToolString(item, 'status') ? { status: normalizeEnum(readAgentToolString(item, 'status'), keyResultStatuses, existing?.status || 'ACTIVE') } : {}),
      ...(readAgentToolString(item, 'whyNecessary') ? { whyNecessary: readAgentToolString(item, 'whyNecessary') } : {}),
    }
    if (existing) {
      updated.push(await tx.keyResult.update({ where: { id: existing.id }, data }))
    } else if (title) {
      updated.push(await tx.keyResult.create({
        data: {
          userId,
          goalId,
          title,
          metricType: normalizeEnum(readAgentToolString(item, 'metricType'), metricTypes, 'TEXT'),
          currentValue: readAgentToolString(item, 'currentValue') || null,
          targetValue: readAgentToolString(item, 'targetValue') || null,
          progress: Math.max(0, Math.min(1, progress ?? 0)),
          status: normalizeEnum(readAgentToolString(item, 'status'), keyResultStatuses, 'ACTIVE'),
          whyNecessary: readAgentToolString(item, 'whyNecessary') || null,
        },
      }))
    }
  }
  return updated
}

async function upsertGoalConditions(tx, userId, goalId, inputItems) {
  const updated = []
  for (const rawItem of asArray(inputItems)) {
    const item = asObject(rawItem)
    const id = readAgentToolString(item, 'id')
    const title = readAgentToolString(item, 'title')
    const existing = id
      ? await tx.goalCondition.findFirst({ where: { id, userId, goalId } })
      : title
        ? await tx.goalCondition.findFirst({ where: { userId, goalId, title } })
        : null
    const data = {
      ...(title ? { title } : {}),
      ...(readAgentToolString(item, 'type') ? { type: normalizeEnum(readAgentToolString(item, 'type'), conditionTypes, existing?.type || 'ASSUMED') } : {}),
      ...(readAgentToolString(item, 'status') ? { status: normalizeEnum(readAgentToolString(item, 'status'), conditionStatuses, existing?.status || 'MISSING') } : {}),
      ...(readAgentToolString(item, 'whyRequired') ? { whyRequired: readAgentToolString(item, 'whyRequired') } : {}),
      ...(Object.prototype.hasOwnProperty.call(item, 'evidence') ? { evidence: item.evidence } : {}),
    }
    if (existing) {
      updated.push(await tx.goalCondition.update({ where: { id: existing.id }, data }))
    } else if (title) {
      updated.push(await tx.goalCondition.create({
        data: {
          userId,
          goalId,
          title,
          type: normalizeEnum(readAgentToolString(item, 'type'), conditionTypes, 'ASSUMED'),
          status: normalizeEnum(readAgentToolString(item, 'status'), conditionStatuses, 'MISSING'),
          whyRequired: readAgentToolString(item, 'whyRequired', '由 Agent 根据路径调整补充的目标条件。'),
          evidence: item.evidence || { source: 'goal.update' },
        },
      }))
    }
  }
  return updated
}

async function upsertGoalStagePlans(tx, userId, goalId, inputItems) {
  const updated = []
  for (const rawItem of asArray(inputItems)) {
    const item = asObject(rawItem)
    const id = readAgentToolString(item, 'id')
    const title = readAgentToolString(item, 'title')
    const existing = id
      ? await tx.stagePlan.findFirst({ where: { id, userId, goalId } })
      : title
        ? await tx.stagePlan.findFirst({ where: { userId, goalId, title } })
        : null
    const sortOrder = readOptionalNumber(item, 'sortOrder')
    const data = {
      ...(title ? { title } : {}),
      ...(readAgentToolString(item, 'stageGoal') ? { stageGoal: readAgentToolString(item, 'stageGoal') } : {}),
      ...(readAgentToolString(item, 'startDate') ? { startDate: toAgentToolDateInput(readAgentToolString(item, 'startDate')) } : {}),
      ...(readAgentToolString(item, 'endDate') ? { endDate: toAgentToolDateInput(readAgentToolString(item, 'endDate')) } : {}),
      ...(asStringArray(item.linkedConditionIds).length ? { linkedConditionIds: asStringArray(item.linkedConditionIds) } : {}),
      ...(asStringArray(item.successSignals).length ? { successSignals: asStringArray(item.successSignals) } : {}),
      ...(readAgentToolString(item, 'status') ? { status: normalizeEnum(readAgentToolString(item, 'status'), stageStatuses, existing?.status || 'DRAFT') } : {}),
      ...(sortOrder !== undefined ? { sortOrder: Math.round(sortOrder) } : {}),
    }
    if (existing) {
      updated.push(await tx.stagePlan.update({ where: { id: existing.id }, data }))
    } else if (title) {
      updated.push(await tx.stagePlan.create({
        data: {
          userId,
          goalId,
          title,
          stageGoal: readAgentToolString(item, 'stageGoal', title),
          startDate: readAgentToolString(item, 'startDate') ? toAgentToolDateInput(readAgentToolString(item, 'startDate')) : new Date(),
          endDate: readAgentToolString(item, 'endDate') ? toAgentToolDateInput(readAgentToolString(item, 'endDate')) : null,
          linkedConditionIds: asStringArray(item.linkedConditionIds),
          successSignals: asStringArray(item.successSignals),
          status: normalizeEnum(readAgentToolString(item, 'status'), stageStatuses, 'DRAFT'),
          sortOrder: Math.round(sortOrder ?? 0),
        },
      }))
    }
  }
  return updated
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
      proposedNextAction: '把下一步缩小到用户当下可承受的最小版本。',
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
  const metaLines = buildSharedMetaCognitionLogLines(input.metaCognition)
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
    metaLines.length ? '' : undefined,
    ...metaLines,
    '',
  ].filter(Boolean).join('\n')
}

function readSharedReflectionString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function readSharedMetaCognitionHypothesis(value) {
  const wrapper = asObject(value)
  return asObject(wrapper.hypothesis || value)
}

function buildSharedMetaCognitionLogLines(value) {
  const hypothesis = readSharedMetaCognitionHypothesis(value)
  const self = asObject(hypothesis.ai_self_reflection)
  const claim = readSharedReflectionString(hypothesis.claim || hypothesis.hypothesis)
  const userIntervention = readSharedReflectionString(hypothesis.decision_impact)
  const aiReasoning = readSharedReflectionString(self.next_thinking_rule || self.reasoning_adjustment)
  const policyDelta = readSharedReflectionString(self.intervention_policy_delta)
  const verification = readSharedReflectionString(hypothesis.verification_signal || self.verification_signal)

  if (!claim && !userIntervention && !aiReasoning && !verification) return []

  return [
    '### System Reflection',
    '',
    claim ? `- 对用户的判断：${claim}` : undefined,
    userIntervention ? `- 下次怎么干预用户：${userIntervention}` : undefined,
    aiReasoning ? `- AI 下次怎么思考：${aiReasoning}` : undefined,
    policyDelta ? `- AI 策略权重：${policyDelta}` : undefined,
    verification ? `- 下次验证信号：${verification}` : undefined,
  ].filter(Boolean)
}

function progressSignalFromSharedResult(result) {
  if (result === 'DONE') return 1
  if (result === 'PARTIAL') return 0.5
  return null
}

function scoreSharedConditionStatus(status) {
  if (status === 'SATISFIED') return 1
  if (status === 'PARTIAL') return 0.5
  return 0
}

function nextSharedConditionStatus(currentStatus, signal) {
  if (signal === 1) return 'SATISFIED'
  if (signal === 0.5 && currentStatus !== 'SATISFIED') return 'PARTIAL'
  return currentStatus
}

function asStringArray(value) {
  if (Array.isArray(value)) return value.filter((item) => typeof item === 'string')
  return []
}

async function applySharedCheckinProgress(tx, action, result) {
  const signal = progressSignalFromSharedResult(result)
  const condition = await tx.goalCondition.findFirst({
    where: { id: action.conditionId, userId: action.userId, goalId: action.goalId },
  })
  const nextStatus = condition ? nextSharedConditionStatus(condition.status, signal) : null
  const updatedCondition = condition && nextStatus !== condition.status
    ? await tx.goalCondition.update({ where: { id: condition.id }, data: { status: nextStatus } })
    : condition

  const conditions = await tx.goalCondition.findMany({ where: { userId: action.userId, goalId: action.goalId } })
  const effectiveConditions = conditions.map((item) => item.id === updatedCondition?.id ? updatedCondition : item)
  const conditionProgress = effectiveConditions.length
    ? effectiveConditions.reduce((total, item) => total + scoreSharedConditionStatus(item.status), 0) / effectiveConditions.length
    : 0

  const keyResults = signal === null ? [] : await tx.keyResult.findMany({
    where: { userId: action.userId, goalId: action.goalId },
  })
  const updatedKeyResults = []
  for (const keyResult of keyResults) {
    const currentProgress = typeof keyResult.progress === 'number' ? keyResult.progress : 0
    const nextProgress = Math.max(currentProgress, Math.min(1, conditionProgress))
    const nextKrStatus = nextProgress >= 1 ? 'ACHIEVED' : keyResult.status === 'ACHIEVED' ? 'ACHIEVED' : 'ACTIVE'
    if (nextProgress !== currentProgress || nextKrStatus !== keyResult.status) {
      updatedKeyResults.push(await tx.keyResult.update({
        where: { id: keyResult.id },
        data: { progress: nextProgress, status: nextKrStatus },
      }))
    }
  }

  let updatedStagePlan = null
  if (action.stagePlanId) {
    const stagePlan = await tx.stagePlan.findFirst({
      where: { id: action.stagePlanId, userId: action.userId, goalId: action.goalId },
    })
    if (stagePlan) {
      const linkedConditionIds = asStringArray(stagePlan.linkedConditionIds)
      const stageConditions = effectiveConditions.filter((item) => {
        return linkedConditionIds.length ? linkedConditionIds.includes(item.id) : item.id === action.conditionId
      })
      const hasProgress = stageConditions.some((item) => ['PARTIAL', 'SATISFIED'].includes(item.status))
      const isComplete = stageConditions.length > 0 && stageConditions.every((item) => item.status === 'SATISFIED')
      const nextStageStatus = isComplete ? 'COMPLETED' : hasProgress && stagePlan.status === 'DRAFT' ? 'ACTIVE' : stagePlan.status
      if (nextStageStatus !== stagePlan.status) {
        updatedStagePlan = await tx.stagePlan.update({
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

      const updatedKeyResults = await upsertGoalKeyResults(tx, userId, goal.id, input.keyResults || input.key_results)
      const updatedConditions = await upsertGoalConditions(tx, userId, goal.id, input.conditions)
      const updatedStagePlans = await upsertGoalStagePlans(tx, userId, goal.id, input.stagePlans || input.stage_plans || input.stages)

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
        keyResults: updatedKeyResults,
        conditions: updatedConditions,
        stagePlans: updatedStagePlans,
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
    const output = await submitControlLoopFeedback(prisma, userId, {
      source: 'agent.checkin.submit',
      trigger: 'agent_tool',
      actionId,
      result: normalizeAgentToolCheckinResult(readAgentToolString(input, 'result', 'no_response')),
      reasonCategory: readAgentToolString(input, 'reasonCategory') || undefined,
      userFeedback: readAgentToolString(input, 'userFeedback'),
      adjustment: readAgentToolString(input, 'adjustment'),
    })
    return output
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
    await ensureLogPeriodRollups(prisma, {
      userId,
      date,
      sourcePath: dateInfo.path,
      sourceKind: 'manual_daily_log',
      goalId: Array.isArray(linkedGoalIds) ? linkedGoalIds[0] : undefined,
      actionId: Array.isArray(linkedActionIds) ? linkedActionIds[0] : undefined,
      resultLabel: '日志已写入',
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
    const data = modelSecretWriteData({
      provider: readAgentToolString(input, 'provider', existing?.provider || 'deepseek'),
      model: readAgentToolString(input, 'model', existing?.model || 'deepseek-v4-flash'),
      reasoningModel: readAgentToolString(input, 'reasoningModel', existing?.reasoningModel || ''),
      apiBase: readAgentToolString(input, 'apiBase', existing?.apiBase || 'https://api.deepseek.com'),
      apiKey: readAgentToolString(input, 'apiKey', ''),
      usage: 'CHAT',
      isDefault: true,
      temperature: readAgentToolNumber(input, 'temperature', existing?.temperature ?? 0.3),
    }, existing)
    const modelConfig = existing
      ? await prisma.modelConfig.update({ where: { id: existing.id }, data })
      : await prisma.modelConfig.create({ data: { userId, ...data } })
    return { targetId: modelConfig.id, result: modelConfig }
  }

  throw new Error(`共享执行工具暂不支持：${toolName}`)
}
