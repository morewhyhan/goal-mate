import {
  readAgentToolNumber,
  readAgentToolString,
} from './agent-tool-shared.mjs'
import {
  getSharedCurrentGoal,
} from './agent-tool-business-helpers.mjs'
import { ensureLogPeriodRollups } from './log-period-rollup.mjs'
import { applyReviewStateUpdate } from './review-state-update.mjs'
import {
  buildMetaCognitionFromReview,
  evaluateInterventionEffectiveness,
  evaluateMetaCognitionHypotheses,
  loadMetaCognitionHypotheses,
  persistMetaCognitionEvaluations,
  persistMetaCognitionHypothesis,
} from './meta-cognition-layer.mjs'
import { maskModelConfig } from './model-secret.mjs'

const DAY_MS = 24 * 60 * 60 * 1000
const metricTypes = new Set(['BOOLEAN', 'COUNT', 'PERCENT', 'WEIGHT', 'TEXT'])
const conditionTypes = new Set(['HARD', 'ASSUMED', 'SUPPORTING'])
const conditionStatuses = new Set(['MISSING', 'PARTIAL', 'SATISFIED', 'INVALIDATED'])

function isRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
}

async function readSharedLogBooleanSetting(prisma, userId, key, fallback) {
  const settings = await prisma.userSetting.findUnique({ where: { userId } })
  const logs = isRecord(settings?.logs) ? settings.logs : {}
  return typeof logs[key] === 'boolean' ? logs[key] : fallback
}

async function readSharedGoalReviewCadence(prisma, userId) {
  const settings = await prisma.userSetting.findUnique({ where: { userId } })
  const goals = isRecord(settings?.goals) ? settings.goals : {}
  return readAgentToolString(goals, 'review_cadence', 'weekly')
}

function addDays(date, days) {
  return new Date(date.getTime() + days * DAY_MS)
}

function parseOptionalDate(value, fallback) {
  if (!value) return fallback
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? fallback : parsed
}

function readAnyString(input, keys, fallback = '') {
  for (const key of keys) {
    const value = readAgentToolString(input, key)
    if (value) return value
  }
  return fallback
}

function normalizeEnum(value, allowed, fallback) {
  const normalized = String(value || '').trim().replaceAll('-', '_').toUpperCase()
  if (allowed.has(normalized)) return normalized
  return fallback
}

function normalizeStringArray(value, fallback) {
  const items = Array.isArray(value) ? value : []
  const normalized = items.map((item) => {
    if (typeof item === 'string') return item.trim()
    if (isRecord(item)) return readAnyString(item, ['title', 'text', 'summary', 'value'])
    return ''
  }).filter(Boolean)
  return normalized.length ? normalized : fallback
}

function normalizeKeyResults(input, title) {
  const rawItems = Array.isArray(input.keyResults)
    ? input.keyResults
    : Array.isArray(input.key_results)
      ? input.key_results
      : []
  const normalized = rawItems.map((item) => {
    if (typeof item === 'string') {
      return {
        title: item.trim(),
        metricType: 'TEXT',
        currentValue: '未开始',
        targetValue: '完成',
        progress: 0,
        whyNecessary: '这是判断目标是否推进的必要结果。',
      }
    }
    if (!isRecord(item)) return null
    const itemTitle = readAgentToolString(item, 'title')
    if (!itemTitle) return null
    return {
      title: itemTitle,
      metricType: normalizeEnum(readAnyString(item, ['metricType', 'metric_type'], 'TEXT'), metricTypes, 'TEXT'),
      currentValue: readAnyString(item, ['currentValue', 'current_value'], '未开始'),
      targetValue: readAnyString(item, ['targetValue', 'target_value'], '完成'),
      progress: Math.min(1, Math.max(0, readAgentToolNumber(item, 'progress', 0))),
      whyNecessary: readAnyString(item, ['whyNecessary', 'why_necessary'], '这是判断目标是否推进的必要结果。'),
    }
  }).filter(Boolean)

  return normalized.length ? normalized : [
    {
      title: `确认「${title}」的可验收完成标准`,
      metricType: 'TEXT',
      currentValue: '未确认',
      targetValue: '用户确认完成标准',
      progress: 0,
      whyNecessary: '没有可验收标准，目标无法判断是否真的推进。',
    },
    {
      title: `完成「${title}」的第一次有效行动`,
      metricType: 'BOOLEAN',
      currentValue: 'false',
      targetValue: 'true',
      progress: 0,
      whyNecessary: '目标必须落到具体行动，否则只停留在想法层面。',
    },
  ]
}

function normalizeConditions(input) {
  const rawItems = Array.isArray(input.necessaryConditions)
    ? input.necessaryConditions
    : Array.isArray(input.necessary_conditions)
      ? input.necessary_conditions
      : Array.isArray(input.conditions)
        ? input.conditions
        : []
  const normalized = rawItems.map((item) => {
    if (typeof item === 'string') {
      return {
        title: item.trim(),
        type: 'HARD',
        status: 'MISSING',
        whyRequired: '这是目标推进必须补齐的条件。',
      }
    }
    if (!isRecord(item)) return null
    const title = readAgentToolString(item, 'title')
    if (!title) return null
    return {
      title,
      type: normalizeEnum(readAnyString(item, ['type', 'conditionType', 'condition_type'], 'HARD'), conditionTypes, 'HARD'),
      status: normalizeEnum(readAnyString(item, ['status'], 'MISSING'), conditionStatuses, 'MISSING'),
      whyRequired: readAnyString(item, ['whyRequired', 'why_required'], '这是目标推进必须补齐的条件。'),
    }
  }).filter(Boolean)

  return normalized.length ? normalized : [
    {
      title: '明确成功标准和时间边界',
      type: 'HARD',
      status: 'MISSING',
      whyRequired: '没有成功标准和时间边界，系统无法拆出可靠 KR 和阶段计划。',
    },
    {
      title: '确定今天能启动的最小行动',
      type: 'HARD',
      status: 'PARTIAL',
      whyRequired: '目标需要立刻进入行动反馈，否则计划不会产生真实证据。',
    },
  ]
}

function buildStageInputs(input, horizonStart, horizonEnd, conditionIds) {
  const rawItems = Array.isArray(input.stagePlans)
    ? input.stagePlans
    : Array.isArray(input.stage_plans)
      ? input.stage_plans
      : Array.isArray(input.stages)
        ? input.stages
        : []
  const normalized = rawItems.map((item, index) => {
    if (!isRecord(item)) return null
    const title = readAgentToolString(item, 'title')
    if (!title) return null
    return {
      title,
      stageGoal: readAnyString(item, ['stageGoal', 'stage_goal'], title),
      startDate: parseOptionalDate(readAnyString(item, ['startDate', 'start_date']), addDays(horizonStart, index * 7)),
      endDate: parseOptionalDate(readAnyString(item, ['endDate', 'end_date']), index === rawItems.length - 1 ? horizonEnd : addDays(horizonStart, (index + 1) * 7 - 1)),
      linkedConditionIds: conditionIds,
      successSignals: normalizeStringArray(item.successSignals || item.success_signals, [title]),
      sortOrder: index,
    }
  }).filter(Boolean)

  if (normalized.length) return normalized

  const middle = addDays(horizonStart, Math.max(1, Math.round((horizonEnd.getTime() - horizonStart.getTime()) / DAY_MS / 2)))
  return [
    {
      title: '澄清和确认',
      stageGoal: '把目标变成可验收、可执行、可追踪的计划。',
      startDate: horizonStart,
      endDate: middle,
      linkedConditionIds: conditionIds,
      successSignals: ['完成标准已确认', '今天的最小行动已生成'],
      sortOrder: 0,
    },
    {
      title: '执行和反馈',
      stageGoal: '通过每日行动和复盘持续推进目标。',
      startDate: addDays(middle, 1),
      endDate: horizonEnd,
      linkedConditionIds: conditionIds,
      successSignals: ['每日行动有反馈', 'KR 进度可以被更新'],
      sortOrder: 1,
    },
  ]
}

function buildDraftMarkdown({ goal, reasoningCard, keyResults, conditions, stagePlans, dailyAction }) {
  return [
    `# ${goal.title}`,
    '',
    `- 状态：${goal.status}`,
    `- 时间：${goal.horizonStart?.toISOString().slice(0, 10) || '未定'} -> ${goal.horizonEnd?.toISOString().slice(0, 10) || '未定'}`,
    '',
    '## 目标理解',
    '',
    reasoningCard.purposeSummary,
    '',
    '## KR',
    '',
    ...keyResults.map((item) => `- ${item.title}：${item.currentValue || '未开始'} -> ${item.targetValue || '完成'}`),
    '',
    '## 必要条件',
    '',
    ...conditions.map((item) => `- ${item.title}：${item.status}。${item.whyRequired}`),
    '',
    '## 阶段',
    '',
    ...stagePlans.map((item) => `- ${item.title}：${item.stageGoal}`),
    '',
    '## 今天先做',
    '',
    `- 行动：${dailyAction.title}`,
    `- 完成标准：${dailyAction.doneWhen}`,
    `- 最小启动：${dailyAction.minimumStep}`,
    '',
  ].join('\n')
}

function normalizeReviewType(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'daily') return 'daily'
  if (normalized === 'monthly') return 'monthly'
  if (normalized === 'quarterly') return 'quarterly'
  if (normalized === 'yearly') return 'yearly'
  if (normalized === 'goal_cycle') return 'goal_cycle'
  return 'weekly'
}

function getWeekNumber(date) {
  const copied = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = copied.getUTCDay() || 7
  copied.setUTCDate(copied.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(copied.getUTCFullYear(), 0, 1))
  return Math.ceil((((copied.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
}

function padDatePart(value) {
  return String(value).padStart(2, '0')
}

function buildSharedReviewLogPath(type, date = new Date()) {
  const year = date.getFullYear()
  const quarter = `Q${Math.floor(date.getMonth() / 3) + 1}`
  const month = `${year}-${padDatePart(date.getMonth() + 1)}`
  const week = `W${padDatePart(getWeekNumber(date))}`

  if (type === 'yearly') return `logs/${year}/${year}.md`
  if (type === 'quarterly') return `logs/${year}/${quarter}/${year}-${quarter}.md`
  if (type === 'monthly') return `logs/${year}/${quarter}/${month}/${month}.md`
  return `logs/${year}/${quarter}/${month}/${week}/${year}-${week}.md`
}

function reviewTypeToPeriodType(type) {
  if (type === 'yearly') return 'YEAR'
  if (type === 'quarterly') return 'QUARTER'
  if (type === 'monthly') return 'MONTH'
  return 'WEEK'
}

function reviewTypeToPrismaType(type) {
  if (type === 'daily') return 'DAILY'
  if (type === 'monthly') return 'MONTHLY'
  if (type === 'quarterly') return 'QUARTERLY'
  if (type === 'yearly') return 'YEARLY'
  if (type === 'goal_cycle') return 'GOAL_CYCLE'
  return 'WEEKLY'
}

function buildSharedReviewMarkdown(input) {
  const doneCount = input.checkins.filter((item) => item.result === 'DONE').length
  const partialCount = input.checkins.filter((item) => item.result === 'PARTIAL').length
  const notDoneCount = input.checkins.filter((item) => item.result === 'NOT_DONE').length
  const missingConditions = input.conditions.filter((item) => item.status === 'MISSING' || item.status === 'PARTIAL')
  const nextCondition = missingConditions[0]?.title || input.conditions[0]?.title || '继续确认当前关键条件'
  const metaEvaluations = Array.isArray(input.metaEvaluations) ? input.metaEvaluations : []
  const supported = metaEvaluations.filter((item) => item.evaluation_result === 'supported').length
  const contradicted = metaEvaluations.filter((item) => item.evaluation_result === 'contradicted').length
  const inconclusive = metaEvaluations.filter((item) => item.evaluation_result === 'inconclusive').length

  return [
    `# ${input.goalTitle} ${input.type} review`,
    '',
    '## 本周期实际推进',
    '',
    `- 完成：${doneCount}`,
    `- 部分完成：${partialCount}`,
    `- 未完成：${notDoneCount}`,
    '',
    '## KR 变化',
    '',
    ...input.keyResults.map((kr) => `- ${kr.title}：${Math.round((kr.progress || 0) * 100)}%（${kr.currentValue || '当前值待记录'} / ${kr.targetValue || '目标值待记录'}）`),
    '',
    '## 条件变化',
    '',
    ...input.conditions.map((condition) => `- ${condition.title}：${condition.status || 'unknown'}`),
    '',
    '## 未完成诊断',
    '',
    ...(input.diagnoses.length ? input.diagnoses.map((diagnosis) => `- ${diagnosis.category}：${diagnosis.nextQuestion}`) : ['- 暂无明确诊断。']),
    '',
    '## 控制回合有效性',
    '',
    input.interventionEffectiveness?.status ? `- 最近干预效果：${input.interventionEffectiveness.status}` : '- 最近干预效果：暂无可判断证据',
    `- 元认知评估：supported ${supported} / contradicted ${contradicted} / inconclusive ${inconclusive}`,
    ...(metaEvaluations.length ? metaEvaluations.slice(0, 5).map((item) => `- ${item.hypothesis_id || 'unknown'}：${item.evaluation_result}；${item.reason}`) : ['- 暂无活跃元认知可评估。']),
    '',
    '## 下周期重点',
    '',
    `继续补齐「${nextCondition}」。`,
    '',
  ].join('\n')
}

export const sharedReadDraftToolNames = [
  'goal.list',
  'goal.get',
  'goal.create_draft',
  'today.get',
  'review.generate',
  'settings.model.get',
]

export function canHandleSharedReadDraftTool(toolName) {
  return sharedReadDraftToolNames.includes(toolName)
}

export async function runSharedReadDraftToolHandler(prisma, userId, toolName, input = {}) {
  if (toolName === 'goal.list') {
    const goals = await prisma.goal.findMany({
      where: { userId },
      orderBy: [{ isCurrentFocus: 'desc' }, { updatedAt: 'desc' }],
      include: { keyResults: true, conditions: true, dailyActions: { orderBy: { actionDate: 'desc' }, take: 1 } },
    })

    return {
      result: goals.map((goal) => ({
        id: goal.id,
        title: goal.title,
        status: goal.status,
        isCurrentFocus: goal.isCurrentFocus,
        keyResultCount: goal.keyResults.length,
        conditionCount: goal.conditions.length,
        latestAction: goal.dailyActions[0]?.title || null,
      })),
    }
  }

  if (toolName === 'goal.get') {
    const goal = await getSharedCurrentGoal(prisma, userId, readAgentToolString(input, 'goalId'))
    const detail = await prisma.goal.findFirst({
      where: { id: goal.id, userId },
      include: {
        keyResults: true,
        conditions: true,
        stagePlans: { orderBy: { sortOrder: 'asc' } },
        dailyActions: { orderBy: { actionDate: 'desc' }, take: 7 },
        reasoningCards: { orderBy: { version: 'desc' }, take: 1 },
      },
    })
    return { targetId: goal.id, result: detail }
  }

  if (toolName === 'goal.create_draft') {
    const objective = isRecord(input.objective) ? input.objective : {}
    const horizon = isRecord(input.horizon) ? input.horizon : {}
    const title = readAgentToolString(input, 'title') || readAgentToolString(objective, 'title')
    if (!title) throw new Error('缺少目标标题。')

    const rawInput = readAgentToolString(input, 'rawInput', title)
    const horizonStart = parseOptionalDate(readAnyString(input, ['horizonStart', 'startDate']) || readAnyString(horizon, ['start_date', 'startDate']), new Date())
    const horizonEnd = parseOptionalDate(readAnyString(input, ['horizonEnd', 'endDate']) || readAnyString(horizon, ['end_date', 'endDate']), addDays(horizonStart, 30))
    const interpretedGoal = readAgentToolString(input, 'interpretedGoal')
      || readAgentToolString(objective, 'plain_language_summary')
      || rawInput
    const keyResultsInput = normalizeKeyResults(input, title)
    const conditionInputs = normalizeConditions(input)
    const successSignals = normalizeStringArray(input.successSignals || input.success_signals, keyResultsInput.map((item) => item.title))
    const currentGap = isRecord(input.currentGap) ? input.currentGap : isRecord(input.current_gap) ? input.current_gap : {}

    const result = await prisma.$transaction(async (tx) => {
      const goal = await tx.goal.create({
        data: {
          userId,
          title,
          rawInput,
          interpretedGoal,
          horizonStart,
          horizonEnd,
          status: 'DRAFT',
          isCurrentFocus: false,
        },
      })

      const conditions = []
      for (const condition of conditionInputs) {
        conditions.push(await tx.goalCondition.create({
          data: {
            userId,
            goalId: goal.id,
            title: condition.title,
            type: condition.type,
            status: condition.status,
            whyRequired: condition.whyRequired,
            evidence: { source: 'goal.create_draft' },
          },
        }))
      }

      const gapTitle = readAnyString(currentGap, ['conditionTitle', 'condition_title'], conditionInputs[0]?.title || '')
      const currentGapCondition = conditions.find((condition) => condition.title === gapTitle) || conditions[0]

      const keyResults = []
      for (const keyResult of keyResultsInput) {
        keyResults.push(await tx.keyResult.create({
          data: {
            userId,
            goalId: goal.id,
            title: keyResult.title,
            metricType: keyResult.metricType,
            currentValue: keyResult.currentValue,
            targetValue: keyResult.targetValue,
            progress: keyResult.progress,
            whyNecessary: keyResult.whyNecessary,
          },
        }))
      }

      const stageInputs = buildStageInputs(input, horizonStart, horizonEnd, conditions.map((condition) => condition.id))
      const stagePlans = []
      for (const stage of stageInputs) {
        stagePlans.push(await tx.stagePlan.create({
          data: {
            userId,
            goalId: goal.id,
            title: stage.title,
            stageGoal: stage.stageGoal,
            startDate: stage.startDate,
            endDate: stage.endDate,
            linkedConditionIds: stage.linkedConditionIds,
            successSignals: stage.successSignals,
            status: stage.sortOrder === 0 ? 'ACTIVE' : 'DRAFT',
            sortOrder: stage.sortOrder,
          },
        }))
      }

      const reasoningCard = await tx.goalReasoningCard.create({
        data: {
          userId,
          goalId: goal.id,
          purposeSummary: readAnyString(input, ['purposeSummary', 'purpose_summary'], interpretedGoal),
          successSignals,
          sufficientConditionSet: readAnyString(input, ['sufficientConditionSet', 'sufficient_condition_set'], conditions.map((condition) => condition.title).join(' + ')),
          currentGapConditionId: currentGapCondition?.id,
          recommendedFocus: readAnyString(input, ['recommendedFocus', 'recommended_focus'], currentGapCondition ? `先补齐：${currentGapCondition.title}` : '先确认目标成功标准。'),
          confidenceScore: Math.min(1, Math.max(0, readAgentToolNumber(input, 'confidenceScore', readAgentToolNumber(input, 'confidence_score', 0.65)))),
          evidence: input.evidence || ['用户在 Agent 对话中表达了目标意图。'],
          status: 'PENDING_USER_CONFIRMATION',
        },
      })

      const dailyActionInput = isRecord(input.dailyAction) ? input.dailyAction : isRecord(input.daily_action) ? input.daily_action : {}
      const dailyAction = await tx.dailyAction.create({
        data: {
          userId,
          goalId: goal.id,
          stagePlanId: stagePlans[0]?.id,
          conditionId: currentGapCondition.id,
          actionDate: new Date(),
          title: readAgentToolString(dailyActionInput, 'title', `补齐「${currentGapCondition.title}」`),
          reason: readAgentToolString(dailyActionInput, 'reason', '目标草稿创建后，先补齐当前最大缺口。'),
          doneWhen: readAnyString(dailyActionInput, ['doneWhen', 'done_when'], '写下目标的时间边界和至少一个可验收结果。'),
          minimumStep: readAnyString(dailyActionInput, ['minimumStep', 'minimum_step'], '先用一句话说明：到什么时候，看到什么变化，算这件事真的推进了。'),
          estimatedMinutes: Math.round(readAgentToolNumber(dailyActionInput, 'estimatedMinutes', readAgentToolNumber(dailyActionInput, 'estimated_minutes', 10))),
          fallbackAction: readAnyString(dailyActionInput, ['fallbackAction', 'fallback_action'], '如果暂时说不清，只回复一个最想改变的结果。'),
          checkinQuestion: readAnyString(dailyActionInput, ['checkinQuestion', 'checkin_question'], '这个目标的成功标准和时间边界是什么？'),
          status: 'PLANNED',
        },
      })

      const updatedGoal = await tx.goal.update({
        where: { id: goal.id },
        data: { currentReasoningCardId: reasoningCard.id },
      })

      const markdownDocument = await tx.markdownDocument.create({
        data: {
          userId,
          type: 'GOAL',
          title: goal.title,
          path: `goals/${goal.id}.md`,
          content: buildDraftMarkdown({ goal: updatedGoal, reasoningCard, keyResults, conditions, stagePlans, dailyAction }),
          linkedGoalIds: [goal.id],
          linkedActionIds: [dailyAction.id],
          source: 'AGENT',
        },
      })

      return { goal: updatedGoal, reasoningCard, keyResults, conditions, stagePlans, dailyAction, markdownDocument }
    })

    return { targetId: result.goal.id, result }
  }

  if (toolName === 'today.get') {
    const { ensureTodayAction } = await import('./today-action-planner.mjs')
    const ensured = await ensureTodayAction(prisma, userId, { goalId: readAgentToolString(input, 'goalId') })
    const goal = ensured.goal || await getSharedCurrentGoal(prisma, userId, readAgentToolString(input, 'goalId'))
    const actions = await prisma.dailyAction.findMany({
      where: { userId, goalId: goal.id },
      orderBy: { actionDate: 'desc' },
      take: 5,
      include: {
        condition: true,
        checkins: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    })
    return { targetId: ensured.action?.id || actions[0]?.id || goal.id, result: { goal, action: ensured.action, actions, generated: ensured.generated, todayLocked: ensured.todayLocked } }
  }

  if (toolName === 'review.generate') {
    const goal = await getSharedCurrentGoal(prisma, userId, readAgentToolString(input, 'goalId'))
    const configuredCadence = await readSharedGoalReviewCadence(prisma, userId)
    const type = normalizeReviewType(readAgentToolString(input, 'type', configuredCadence))
    const periodEnd = parseOptionalDate(readAgentToolString(input, 'periodEnd'), new Date())
    const periodStart = parseOptionalDate(readAgentToolString(input, 'periodStart'), addDays(periodEnd, -7))
    const detail = await prisma.goal.findFirst({
      where: { id: goal.id, userId },
      include: {
        keyResults: true,
        conditions: true,
        stagePlans: { orderBy: { sortOrder: 'asc' } },
        reasoningCards: { orderBy: { version: 'desc' }, take: 1 },
        checkins: { orderBy: { createdAt: 'desc' }, take: 50 },
        diagnoses: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    })
    if (!detail) throw new Error('目标不存在。')

    const logPath = buildSharedReviewLogPath(type, periodEnd)
    const logTitle = logPath.split('/').pop() || logPath
    const autoWriteReview = await readSharedLogBooleanSetting(prisma, userId, 'auto_write_review', true)

    const result = await prisma.$transaction(async (tx) => {
      const stateUpdate = await applyReviewStateUpdate(tx, userId, detail.id)
      const latestSchedulerEvent = await tx.schedulerEvent.findFirst({
        where: { userId, status: { in: ['sent', 'responded', 'failed'] } },
        orderBy: { createdAt: 'desc' },
      })
      const interventionDecision = latestSchedulerEvent?.payload?.intervention_decision || null
      const interventionEffectiveness = evaluateInterventionEffectiveness({
        interventionDecision,
        checkins: detail.checkins,
        diagnoses: detail.diagnoses,
      })
      const activeMetaCognition = await loadMetaCognitionHypotheses(tx, userId, { goalId: detail.id })
      const metaEvaluations = evaluateMetaCognitionHypotheses(activeMetaCognition, {
        checkin: detail.checkins[0],
        diagnosis: detail.diagnoses[0],
        interventionDecision,
      })
      const metaCognitionEvaluationWrite = await persistMetaCognitionEvaluations(tx, userId, metaEvaluations, {
        goalId: detail.id,
        source: 'review.generate',
      })
      const metaHypothesis = buildMetaCognitionFromReview({
        userId,
        goal: detail,
        checkins: detail.checkins,
        diagnoses: detail.diagnoses,
        interventionDecision,
        interventionEvaluation: interventionEffectiveness,
      })
      const metaCognition = await persistMetaCognitionHypothesis(tx, userId, metaHypothesis, {
        goalId: detail.id,
        source: 'review.generate',
        evaluations: metaEvaluations,
      })
      const markdown = buildSharedReviewMarkdown({
        type,
        goalTitle: detail.title,
        keyResults: detail.keyResults,
        conditions: detail.conditions,
        checkins: detail.checkins,
        diagnoses: detail.diagnoses,
        interventionEffectiveness,
        metaEvaluations,
      })
      let logEntry = null
      let markdownDocument = null
      if (autoWriteReview) {
        const existingLog = await tx.logEntry.findUnique({ where: { userId_path: { userId, path: logPath } } })
        logEntry = await tx.logEntry.upsert({
          where: { userId_path: { userId, path: logPath } },
          update: {
            title: logTitle,
            content: existingLog ? `${existingLog.content}\n\n${markdown}` : markdown,
            linkedGoalIds: [detail.id],
            linkedActionIds: [],
          },
          create: {
            userId,
            periodType: reviewTypeToPeriodType(type),
            title: logTitle,
            path: logPath,
            content: markdown,
            linkedGoalIds: [detail.id],
            linkedActionIds: [],
          },
        })
        markdownDocument = await tx.markdownDocument.upsert({
          where: { userId_path: { userId, path: logPath } },
          update: {
            title: logTitle,
            content: logEntry.content,
            linkedGoalIds: [detail.id],
            linkedActionIds: [],
            source: 'AGENT',
            frontmatter: {
              kind: 'review',
              reviewType: type,
              goalTitle: detail.title,
              interventionEffectiveness,
              metaCognitionEvaluations: metaEvaluations,
              metaCognitionHypothesis: metaCognition.saved ? metaCognition.hypothesis : null,
            },
          },
          create: {
            userId,
            type: reviewTypeToPeriodType(type),
            title: logTitle,
            path: logPath,
            content: logEntry.content,
            linkedGoalIds: [detail.id],
            linkedActionIds: [],
            source: 'AGENT',
            frontmatter: {
              kind: 'review',
              reviewType: type,
              goalTitle: detail.title,
              interventionEffectiveness,
              metaCognitionEvaluations: metaEvaluations,
              metaCognitionHypothesis: metaCognition.saved ? metaCognition.hypothesis : null,
            },
          },
        })
        await ensureLogPeriodRollups(tx, {
          userId,
          date: periodEnd,
          sourcePath: logPath,
          sourceKind: `${type}_review`,
          goalId: detail.id,
          goalTitle: detail.title,
          resultLabel: '复盘已生成',
          conditionTitle: detail.conditions.find((condition) => condition.status !== 'SATISFIED')?.title,
          diagnosisQuestion: detail.diagnoses[0]?.nextQuestion,
        })
      }
      const review = await tx.review.create({
        data: {
          userId,
          goalId: detail.id,
          type: reviewTypeToPrismaType(type),
          periodStart,
          periodEnd,
          progressSummary: `本周期围绕「${detail.title}」生成复盘草案。`,
          conditionChanges: stateUpdate.conditionChanges,
          blockerSummary: stateUpdate.blockerSummary,
          nextFocus: stateUpdate.nextFocus,
          logEntryId: logEntry?.id,
        },
      })

      return { review, logEntry, markdownDocument, markdown, autoWriteReview, stateUpdate, interventionEffectiveness, metaCognition, metaEvaluations, metaCognitionEvaluationWrite }
    })
    return { targetId: result.review.id, result }
  }

  if (toolName === 'settings.model.get') {
    const modelConfig = await prisma.modelConfig.findFirst({
      where: { userId, isDefault: true },
      orderBy: { createdAt: 'asc' },
    })
    return { targetId: modelConfig?.id, result: maskModelConfig(modelConfig) }
  }

  throw new Error(`共享读取/草稿工具暂不支持：${toolName}`)
}
