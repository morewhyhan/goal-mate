import {
  readAgentToolString,
} from './agent-tool-shared.mjs'

export async function getSharedCurrentGoal(prisma, userId, goalId) {
  if (goalId) {
    const goal = await prisma.goal.findFirst({ where: { id: goalId, userId } })
    if (!goal) throw new Error('目标不存在。')
    return goal
  }

  const goal = await prisma.goal.findFirst({ where: { userId, isCurrentFocus: true } })
  if (!goal) throw new Error('当前没有主目标。')
  return goal
}

export async function getOrCreateSharedCondition(prisma, userId, goalId, input) {
  const conditionId = readAgentToolString(input, 'conditionId')
  if (conditionId) {
    const condition = await prisma.goalCondition.findFirst({ where: { id: conditionId, userId, goalId } })
    if (!condition) throw new Error('目标条件不存在。')
    return condition
  }

  const existing = await prisma.goalCondition.findFirst({ where: { userId, goalId }, orderBy: { createdAt: 'asc' } })
  if (existing) return existing

  return prisma.goalCondition.create({
    data: {
      userId,
      goalId,
      title: readAgentToolString(input, 'conditionTitle', '当前关键条件'),
      type: 'ASSUMED',
      status: 'PARTIAL',
      whyRequired: readAgentToolString(input, 'conditionReason', '用于承接 Agent 设置今日行动时缺失的关键条件。'),
    },
  })
}
