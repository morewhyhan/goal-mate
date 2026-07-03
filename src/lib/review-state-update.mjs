function statusScore(status) {
  if (status === 'SATISFIED') return 1
  if (status === 'PARTIAL') return 0.5
  return 0
}

function asStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []
}

function pickNextCondition(conditions) {
  return conditions.find((condition) => condition.status === 'MISSING')
    || conditions.find((condition) => condition.status === 'PARTIAL')
    || conditions[0]
    || null
}

function shouldAdjustStage(diagnoses) {
  return diagnoses.some((diagnosis) => ['PATH', 'CONDITION', 'GOAL'].includes(diagnosis.category))
}

function computeConditionProgress(conditions) {
  if (!conditions.length) return 0
  return conditions.reduce((total, condition) => total + statusScore(condition.status), 0) / conditions.length
}

export function buildReviewStateUpdatePlan(goal) {
  const conditions = goal.conditions || []
  const keyResults = goal.keyResults || []
  const stagePlans = [...(goal.stagePlans || [])].sort((a, b) => a.sortOrder - b.sortOrder)
  const diagnoses = goal.diagnoses || []
  const nextCondition = pickNextCondition(conditions)
  const conditionProgress = computeConditionProgress(conditions)
  const allConditionsSatisfied = conditions.length > 0 && conditions.every((condition) => condition.status === 'SATISFIED')
  const pathNeedsAdjustment = shouldAdjustStage(diagnoses)
  const activeStage = stagePlans.find((stage) => stage.status === 'ACTIVE') || stagePlans[0] || null
  const nextFocus = nextCondition
    ? `继续补齐「${nextCondition.title}」。`
    : '继续保持当前节奏。'
  const blockerSummary = diagnoses[0]?.nextQuestion || (allConditionsSatisfied ? '暂无明确阻塞。' : '当前仍有条件未补齐。')

  const keyResultUpdates = keyResults.map((keyResult) => {
    const currentProgress = typeof keyResult.progress === 'number' ? keyResult.progress : 0
    const nextProgress = Math.max(currentProgress, Math.min(1, conditionProgress))
    return {
      id: keyResult.id,
      title: keyResult.title,
      beforeProgress: currentProgress,
      afterProgress: nextProgress,
      afterStatus: nextProgress >= 1 ? 'ACHIEVED' : keyResult.status === 'ACHIEVED' ? 'ACHIEVED' : 'ACTIVE',
    }
  })

  let stageUpdate = null
  if (activeStage) {
    const linkedConditionIds = asStringArray(activeStage.linkedConditionIds)
    const stageConditions = linkedConditionIds.length
      ? conditions.filter((condition) => linkedConditionIds.includes(condition.id))
      : conditions
    const stageComplete = stageConditions.length > 0 && stageConditions.every((condition) => condition.status === 'SATISFIED')
    const nextStageStatus = stageComplete
      ? 'COMPLETED'
      : pathNeedsAdjustment
        ? 'ADJUSTED'
        : activeStage.status
    stageUpdate = {
      id: activeStage.id,
      title: activeStage.title,
      beforeStatus: activeStage.status,
      afterStatus: nextStageStatus,
    }
  }

  return {
    nextFocus,
    blockerSummary,
    currentGapConditionId: nextCondition?.id || null,
    conditionProgress,
    conditionChanges: conditions.map((condition) => ({
      id: condition.id,
      title: condition.title,
      status: condition.status,
    })),
    keyResultUpdates,
    stageUpdate,
    reasoningCardUpdate: {
      recommendedFocus: nextFocus,
      currentGapConditionId: nextCondition?.id || null,
    },
  }
}

export async function applyReviewStateUpdate(tx, userId, goalId) {
  const goal = await tx.goal.findFirst({
    where: { id: goalId, userId },
    include: {
      keyResults: true,
      conditions: true,
      stagePlans: { orderBy: { sortOrder: 'asc' } },
      reasoningCards: { orderBy: { version: 'desc' }, take: 1 },
      diagnoses: { orderBy: { createdAt: 'desc' }, take: 5 },
    },
  })
  if (!goal) throw new Error('目标不存在。')

  const plan = buildReviewStateUpdatePlan(goal)
  const updatedKeyResults = []
  for (const item of plan.keyResultUpdates) {
    if (item.afterProgress !== item.beforeProgress || item.afterStatus) {
      updatedKeyResults.push(await tx.keyResult.update({
        where: { id: item.id },
        data: {
          progress: item.afterProgress,
          status: item.afterStatus,
        },
      }))
    }
  }

  let updatedStagePlan = null
  if (plan.stageUpdate && plan.stageUpdate.afterStatus !== plan.stageUpdate.beforeStatus) {
    updatedStagePlan = await tx.stagePlan.update({
      where: { id: plan.stageUpdate.id },
      data: { status: plan.stageUpdate.afterStatus },
    })
  }

  let updatedReasoningCard = null
  const latestCard = goal.reasoningCards[0]
  if (latestCard) {
    updatedReasoningCard = await tx.goalReasoningCard.update({
      where: { id: latestCard.id },
      data: {
        recommendedFocus: plan.reasoningCardUpdate.recommendedFocus,
        currentGapConditionId: plan.reasoningCardUpdate.currentGapConditionId,
      },
    })
  }

  return {
    ...plan,
    updatedKeyResults,
    updatedStagePlan,
    updatedReasoningCard,
  }
}
