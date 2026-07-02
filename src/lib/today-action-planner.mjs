const DAY_MS = 24 * 60 * 60 * 1000

function startOfLocalDay(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function endOfLocalDay(date = new Date()) {
  return new Date(startOfLocalDay(date).getTime() + DAY_MS)
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
    fallbackAction: `如果状态很差，只回复一个词：动机、能力、提醒，或路径。`,
    checkinQuestion: `今天这一步完成了吗？如果没完成，更像动机、能力、提醒，还是路径问题？`,
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
