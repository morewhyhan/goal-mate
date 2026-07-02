import {
  readAgentToolString,
} from './agent-tool-shared.mjs'

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

async function getCurrentGoal(prisma, userId, goalId) {
  if (goalId) {
    const goal = await prisma.goal.findFirst({ where: { id: goalId, userId } })
    if (!goal) throw new Error('目标不存在。')
    return goal
  }

  const goal = await prisma.goal.findFirst({ where: { userId, isCurrentFocus: true } })
  if (!goal) throw new Error('当前没有主目标。')
  return goal
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
    const goal = await getCurrentGoal(prisma, userId, readAgentToolString(input, 'goalId'))
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
    const title = readAgentToolString(input, 'title')
    if (!title) throw new Error('缺少目标标题。')

    const rawInput = readAgentToolString(input, 'rawInput', title)
    const goal = await prisma.goal.create({
      data: {
        userId,
        title,
        rawInput,
        interpretedGoal: readAgentToolString(input, 'interpretedGoal', rawInput),
        status: 'DRAFT',
        isCurrentFocus: false,
      },
    })
    const card = await prisma.goalReasoningCard.create({
      data: {
        userId,
        goalId: goal.id,
        purposeSummary: readAgentToolString(input, 'purposeSummary', rawInput),
        successSignals: input.successSignals || [],
        sufficientConditionSet: readAgentToolString(input, 'sufficientConditionSet', '待 Agent 与用户继续确认。'),
        recommendedFocus: readAgentToolString(input, 'recommendedFocus', '先确认这个目标怎么算真正有进展。'),
        evidence: input.evidence || {},
        status: 'DRAFT',
      },
    })
    return { targetId: goal.id, result: { goal, reasoningCard: card } }
  }

  if (toolName === 'today.get') {
    const goal = await getCurrentGoal(prisma, userId, readAgentToolString(input, 'goalId'))
    const actions = await prisma.dailyAction.findMany({
      where: { userId, goalId: goal.id },
      orderBy: { actionDate: 'desc' },
      take: 5,
      include: {
        condition: true,
        checkins: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    })
    return { targetId: actions[0]?.id || goal.id, result: { goal, actions } }
  }

  if (toolName === 'review.generate') {
    const goal = await getCurrentGoal(prisma, userId, readAgentToolString(input, 'goalId'))
    const recentActions = await prisma.dailyAction.findMany({
      where: { userId, goalId: goal.id },
      orderBy: { actionDate: 'desc' },
      take: 7,
      include: { checkins: { orderBy: { createdAt: 'desc' }, take: 1 } },
    })
    const lines = [
      `# ${readAgentToolString(input, 'type', 'daily')} review draft`,
      '',
      `目标：${goal.title}`,
      '',
      '## 最近行动',
      ...recentActions.map((action) => `- ${action.title}：${action.status}`),
      '',
      '## 下一步',
      readAgentToolString(input, 'nextFocus', '继续围绕当前最关键条件推进一个最小行动。'),
    ]
    return { targetId: goal.id, result: { markdown: lines.join('\n') } }
  }

  if (toolName === 'settings.model.get') {
    const modelConfig = await prisma.modelConfig.findFirst({
      where: { userId, isDefault: true },
      orderBy: { createdAt: 'asc' },
    })
    return { targetId: modelConfig?.id, result: modelConfig }
  }

  throw new Error(`共享读取/草稿工具暂不支持：${toolName}`)
}
