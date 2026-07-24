const DAY_MS = 24 * 60 * 60 * 1000

function startOfLocalDay(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function endOfLocalDay(date = new Date()) {
  return new Date(startOfLocalDay(date).getTime() + DAY_MS)
}

function compact(value, max = 120) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max)}...` : text
}

function reducedMinutes(value) {
  const current = Number(value || 20)
  if (!Number.isFinite(current)) return 5
  return Math.max(2, Math.min(10, Math.floor(current / 2)))
}

function asStringArray(value) {
  if (Array.isArray(value)) return value.filter((item) => typeof item === 'string')
  return []
}

function conditionPriority(condition) {
  if (condition.status === 'MISSING') return 0
  if (condition.status === 'PARTIAL') return 1
  if (condition.status === 'SATISFIED') return 3
  return 2
}

function stagePriority(stage) {
  if (stage.status === 'ACTIVE') return 0
  if (stage.status === 'DRAFT') return 1
  if (stage.status === 'ADJUSTED') return 2
  return 3
}

function pickCurrentCondition(goal) {
  const conditions = [...(goal.conditions || [])]
  if (!conditions.length) return null
  return conditions.sort((left, right) => {
    const priorityDiff = conditionPriority(left) - conditionPriority(right)
    if (priorityDiff !== 0) return priorityDiff
    return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
  })[0]
}

function pickStageForCondition(goal, condition) {
  const stages = [...(goal.stagePlans || [])]
  if (!stages.length || !condition) return null
  const linked = stages.filter((stage) => asStringArray(stage.linkedConditionIds).includes(condition.id))
  const candidates = linked.length ? linked : stages
  return candidates.sort((left, right) => {
    const priorityDiff = stagePriority(left) - stagePriority(right)
    if (priorityDiff !== 0) return priorityDiff
    return (left.sortOrder || 0) - (right.sortOrder || 0)
  })[0]
}

function buildActionCopy(goal, condition, stagePlan) {
  const conditionTitle = condition?.title || '确认当前关键条件'
  const stageText = stagePlan?.title ? `，对应阶段「${stagePlan.title}」` : ''
  return {
    title: `补齐「${conditionTitle}」`,
    reason: `今天只推进当前最关键缺口${stageText}。`,
    doneWhen: `留下一个能证明「${conditionTitle}」被推进的具体结果或证据。`,
    minimumStep: `先写一句话：现在「${conditionTitle}」卡在哪里。`,
    estimatedMinutes: 20,
    fallbackAction: '如果状态很差，只回复一句：太大、时间不对、不想继续，或这一步不对路。',
    checkinQuestion: '今天这一步完成了吗？如果没完成，是动作太大、时间不对、不想继续，还是这一步不对路？',
  }
}

function feedbackCommitmentDate(action, result, now = new Date()) {
  const today = startOfLocalDay(now)
  const actionDate = action?.actionDate ? startOfLocalDay(new Date(action.actionDate)) : today
  const base = actionDate.getTime() > today.getTime() ? actionDate : today
  return result === 'DONE' ? new Date(base.getTime() + DAY_MS) : base
}

function promptSignalText(signal = {}) {
  const timing = signal.timingLabel || '下一次行动窗口'
  const leadMinutes = Number(signal.leadMinutes || 10)
  return {
    timing,
    leadMinutes,
    reason: `上次反馈显示提醒时机不合适；这次改为在${timing}前 ${leadMinutes} 分钟准备好预案，不增加提醒频率。`,
  }
}

/**
 * Build the concrete DailyAction that closes a feedback loop.
 *
 * The returned `data` is suitable for Prisma create/update. It is deliberately
 * action-shaped rather than conversational advice: callers must persist it
 * before presenting it as an adjusted commitment.
 */
export function buildFeedbackNextCommitmentPlan(input = {}) {
  const action = input.action || {}
  const result = String(input.result || '').toUpperCase()
  const diagnosis = input.diagnosis || {}
  const category = String(diagnosis.category || 'UNKNOWN').toUpperCase()
  const nextCondition = input.nextCondition || action.condition || {}
  const sameCondition = !nextCondition.id || nextCondition.id === action.conditionId
  const actionDate = feedbackCommitmentDate(action, result, input.now || new Date())
  const conditionId = nextCondition.id || action.conditionId
  const conditionTitle = nextCondition.title || action.condition?.title || '当前关键条件'
  const actionTitle = compact(action.title || '当前行动')
  const oldMinimumStep = compact(action.minimumStep || action.fallbackAction || actionTitle)
  const estimatedMinutes = reducedMinutes(action.estimatedMinutes)
  const common = {
    userId: action.userId,
    goalId: action.goalId,
    stagePlanId: sameCondition ? action.stagePlanId || null : null,
    conditionId,
    actionDate,
    status: 'PLANNED',
  }

  if (!action.userId || !action.goalId || !conditionId) {
    throw new Error('无法生成下一承诺：原行动缺少用户、目标或条件。')
  }

  if (result === 'DONE') {
    if (!sameCondition) {
      const copy = buildActionCopy(action.goal || {}, nextCondition, null)
      return {
        data: {
          ...common,
          ...copy,
          reason: '上一步已经完成，下一承诺已转向当前仍未补齐的关键条件。',
        },
        adjustmentSignal: {
          strategy: 'advance_to_next_gap',
          sourceResult: result,
        },
      }
    }

    return {
      data: {
        ...common,
        title: `确认并推进「${conditionTitle}」的下一项证据`,
        reason: '上一步已经完成；先沉淀结果，再确定同一关键条件下的下一处缺口。',
        doneWhen: `记录刚完成的结果，并写出「${conditionTitle}」下一项可验证证据。`,
        minimumStep: '先用 2 分钟记录刚刚完成了什么。',
        estimatedMinutes: 10,
        fallbackAction: '如果暂时想不到下一步，只保存完成证据并标记需要重新规划。',
        checkinQuestion: '完成证据记录了吗？下一处缺口是否已经明确？',
      },
      adjustmentSignal: {
        strategy: 'capture_evidence_then_advance',
        sourceResult: result,
      },
    }
  }

  if (category === 'PROMPT') {
    const signal = promptSignalText(diagnosis.interventionSignal)
    return {
      data: {
        ...common,
        title: `在${signal.timing}前准备：${oldMinimumStep}`,
        reason: signal.reason,
        doneWhen: `在行动开始前 ${signal.leadMinutes} 分钟完成预案：${oldMinimumStep}`,
        minimumStep: `现在先把替代动作准备好：${oldMinimumStep}`,
        estimatedMinutes,
        fallbackAction: `如果错过提示，不重排计划，只做：${oldMinimumStep}`,
        checkinQuestion: '这次提前提示是否发生在真正能行动的窗口前？',
      },
      adjustmentSignal: {
        strategy: 'advance_prompt',
        timingHint: diagnosis.interventionSignal?.timingHint || 'before_action_window',
        timingLabel: signal.timing,
        leadMinutes: signal.leadMinutes,
        frequencyPolicy: 'do_not_increase',
      },
    }
  }

  if (category === 'MOTIVATION') {
    const goalTitle = compact(action.goal?.title || actionTitle)
    return {
      data: {
        ...common,
        title: `用 3 分钟确认是否继续「${goalTitle}」`,
        reason: '反馈指向目标吸引力或真实性；下一承诺改为确认方向，不继续硬推原任务。',
        doneWhen: '明确选择继续、暂停，或修改这个目标。',
        minimumStep: '只回答一句：我还想继续 / 先暂停 / 需要改目标。',
        estimatedMinutes: 3,
        fallbackAction: '如果现在不想判断，先暂停推进，不新增同类任务。',
        checkinQuestion: '这个目标现在仍是你真正想要的吗？',
      },
      adjustmentSignal: {
        strategy: 'review_goal_truth',
        sourceResult: result,
      },
    }
  }

  if (['PATH', 'CONDITION', 'GOAL'].includes(category)) {
    return {
      data: {
        ...common,
        title: `重新对准「${conditionTitle}」的下一步`,
        reason: '反馈指向路径或目标问题；下一承诺改为校验关键条件，不重复原行动。',
        doneWhen: `写清一个真正能补齐「${conditionTitle}」的可验证动作。`,
        minimumStep: `只回答：原行动有没有直接推进「${conditionTitle}」？`,
        estimatedMinutes: 5,
        fallbackAction: '如果仍不确定，暂停新增任务，只记录当前最大缺口。',
        checkinQuestion: '新动作是否直接补齐当前关键条件？',
      },
      adjustmentSignal: {
        strategy: 'rebuild_path',
        sourceResult: result,
      },
    }
  }

  const isPartial = result === 'PARTIAL'
  return {
    data: {
      ...common,
      title: isPartial ? `完成剩余最小部分：${actionTitle}` : `最小版本：${actionTitle}`,
      reason: isPartial
        ? '已经有部分进展；下一承诺只保留剩余部分中的最小可验证结果。'
        : '反馈显示原行动没有发生；下一承诺已经降低难度和启动成本。',
      doneWhen: isPartial
        ? `只完成剩余部分中的一个可验证结果：${oldMinimumStep}`
        : `只做到这个最小结果：${oldMinimumStep}`,
      minimumStep: `先用 2 分钟开始：${oldMinimumStep}`,
      estimatedMinutes,
      fallbackAction: '如果仍卡住，只记录已经做到哪里，以及下一处具体卡点。',
      checkinQuestion: '缩小以后，这个版本完成了吗？',
    },
    adjustmentSignal: {
      strategy: 'reduce_difficulty',
      sourceResult: result,
      previousEstimatedMinutes: Number(action.estimatedMinutes || 20),
      nextEstimatedMinutes: estimatedMinutes,
    },
  }
}

/**
 * Persist (or update) the one planned commitment for the target goal/day.
 * Returning from this function guarantees the commitment exists in storage.
 */
export async function persistFeedbackNextCommitment(tx, userId, input = {}) {
  const plan = buildFeedbackNextCommitmentPlan(input)
  const actionDate = plan.data.actionDate
  const dayStart = startOfLocalDay(actionDate)
  const dayEnd = endOfLocalDay(actionDate)
  const existing = await tx.dailyAction.findFirst({
    where: {
      userId,
      goalId: plan.data.goalId,
      id: { not: input.action?.id },
      status: 'PLANNED',
      actionDate: { gte: dayStart, lt: dayEnd },
    },
    orderBy: { createdAt: 'desc' },
  })
  const persisted = existing
    ? await tx.dailyAction.update({
      where: { id: existing.id },
      data: plan.data,
    })
    : await tx.dailyAction.create({ data: plan.data })

  return {
    ...persisted,
    persisted: true,
    adjustmentSignal: plan.adjustmentSignal,
  }
}

async function loadGoal(prisma, userId, goalId) {
  return prisma.goal.findFirst({
    where: goalId ? { id: goalId, userId } : { userId, isCurrentFocus: true },
    include: {
      keyResults: true,
      conditions: true,
      stagePlans: { orderBy: { sortOrder: 'asc' } },
      reasoningCards: { where: { status: 'CONFIRMED' }, orderBy: { version: 'desc' }, take: 1 },
    },
  })
}

async function ensureFallbackCondition(tx, userId, goalId) {
  return tx.goalCondition.create({
    data: {
      userId,
      goalId,
      title: '确认当前关键条件',
      type: 'ASSUMED',
      status: 'MISSING',
      whyRequired: 'Today 自动生成下一步时发现目标缺少条件，因此先补齐目标推进所需的关键条件。',
      evidence: { source: 'today.ensure_next_action' },
    },
  })
}

export async function ensureTodayAction(prisma, userId, options = {}) {
  const date = options.date || new Date()
  const goalId = options.goalId || ''
  const dayStart = startOfLocalDay(date)
  const dayEnd = endOfLocalDay(date)

  const goal = await loadGoal(prisma, userId, goalId)
  if (!goal) return { goal: null, action: null, generated: false, todayLocked: false }

  await prisma.dailyAction.updateMany({
    where: {
      userId,
      goalId: goal.id,
      status: 'PLANNED',
      actionDate: { lt: dayStart },
    },
    data: { status: 'REPLACED' },
  })

  const todaysActions = await prisma.dailyAction.findMany({
    where: {
      userId,
      goalId: goal.id,
      actionDate: { gte: dayStart, lt: dayEnd },
    },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    include: {
      condition: true,
      checkins: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  })
  const plannedToday = todaysActions.find((action) => action.status === 'PLANNED')
  if (plannedToday) return { goal, action: plannedToday, generated: false, todayLocked: false }
  if (todaysActions.length) return { goal, action: todaysActions[0], generated: false, todayLocked: true }

  const generatedAction = await prisma.$transaction(async (tx) => {
    const freshGoal = await loadGoal(tx, userId, goal.id)
    const condition = pickCurrentCondition(freshGoal) || await ensureFallbackCondition(tx, userId, goal.id)
    const stagePlan = pickStageForCondition(freshGoal, condition)
    const actionCopy = buildActionCopy(freshGoal, condition, stagePlan)
    return tx.dailyAction.create({
      data: {
        userId,
        goalId: goal.id,
        stagePlanId: stagePlan?.id || null,
        conditionId: condition.id,
        actionDate: dayStart,
        ...actionCopy,
        status: 'PLANNED',
      },
      include: {
        condition: true,
        checkins: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    })
  })

  return { goal: await loadGoal(prisma, userId, goal.id), action: generatedAction, generated: true, todayLocked: false }
}
