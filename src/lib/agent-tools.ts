import { prisma } from '@/lib/db'
import {
  asAgentToolRecord,
  compactAgentToolSummary,
  formatAgentToolDatePath,
  listSharedAgentTools,
  normalizeAgentToolActionStatus,
  normalizeAgentToolCheckinResult,
  readAgentToolBoolean,
  readAgentToolNumber,
  readAgentToolString,
  toAgentToolDateInput,
} from '@/lib/agent-tool-shared.mjs'
import {
  canHandleSharedReadDraftTool,
  runSharedReadDraftToolHandler,
} from '@/lib/agent-tool-read-handlers.mjs'
import {
  canHandleSharedWriteTool,
  runSharedWriteToolHandler,
} from '@/lib/agent-tool-write-handlers.mjs'

export type AgentToolPermission = 'read' | 'draft' | 'execute'
export type AgentToolSource = 'web' | 'qq' | 'scheduler'

export type AgentToolContext = {
  userId: string
  source: AgentToolSource
  confirmed?: boolean
  agentThreadId?: string
  agentMessageId?: string
}

export type AgentToolDefinition = {
  name: string
  description: string
  permission: AgentToolPermission
  targetType: string
  riskLevel: 'low' | 'medium' | 'high'
  handler: (context: AgentToolContext, input: Record<string, unknown>) => Promise<AgentToolHandlerResult>
}

type AgentToolHandlerResult = {
  targetId?: string
  result: unknown
}

async function getCurrentGoal(userId: string, goalId?: string) {
  if (goalId) {
    const goal = await prisma.goal.findFirst({ where: { id: goalId, userId } })
    if (!goal) throw new Error('目标不存在。')
    return goal
  }
  const goal = await prisma.goal.findFirst({ where: { userId, isCurrentFocus: true } })
  if (!goal) throw new Error('当前没有主目标。')
  return goal
}

async function getOrCreateCondition(userId: string, goalId: string, input: Record<string, unknown>) {
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

const toolDefinitions: AgentToolDefinition[] = [
  {
    name: 'goal.list',
    description: '列出当前用户的目标摘要。',
    permission: 'read',
    targetType: 'goal',
    riskLevel: 'low',
    async handler(context) {
      const goals = await prisma.goal.findMany({
        where: { userId: context.userId },
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
    },
  },
  {
    name: 'goal.get',
    description: '读取目标详情、KR、条件、阶段计划和近期行动。',
    permission: 'read',
    targetType: 'goal',
    riskLevel: 'low',
    async handler(context, input) {
      const goal = await getCurrentGoal(context.userId, readAgentToolString(input, 'goalId'))
      const detail = await prisma.goal.findFirst({
        where: { id: goal.id, userId: context.userId },
        include: {
          keyResults: true,
          conditions: true,
          stagePlans: { orderBy: { sortOrder: 'asc' } },
          dailyActions: { orderBy: { actionDate: 'desc' }, take: 7 },
          reasoningCards: { orderBy: { version: 'desc' }, take: 1 },
        },
      })
      return { targetId: goal.id, result: detail }
    },
  },
  {
    name: 'goal.create_draft',
    description: '根据对话创建目标草案和目标推理卡。',
    permission: 'draft',
    targetType: 'goal',
    riskLevel: 'medium',
    async handler(context, input) {
      const title = readAgentToolString(input, 'title')
      if (!title) throw new Error('缺少目标标题。')
      const rawInput = readAgentToolString(input, 'rawInput', title)
      const goal = await prisma.goal.create({
        data: {
          userId: context.userId,
          title,
          rawInput,
          interpretedGoal: readAgentToolString(input, 'interpretedGoal', rawInput),
          status: 'DRAFT',
          isCurrentFocus: false,
        },
      })
      const card = await prisma.goalReasoningCard.create({
        data: {
          userId: context.userId,
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
    },
  },
  {
    name: 'goal.update',
    description: '更新目标基础字段或当前焦点。',
    permission: 'execute',
    targetType: 'goal',
    riskLevel: 'medium',
    async handler(context, input) {
      const goal = await getCurrentGoal(context.userId, readAgentToolString(input, 'goalId'))
      const isCurrentFocus = readAgentToolBoolean(input, 'isCurrentFocus')
      if (isCurrentFocus) {
        await prisma.goal.updateMany({ where: { userId: context.userId }, data: { isCurrentFocus: false } })
      }
      const updated = await prisma.goal.update({
        where: { id: goal.id },
        data: {
          title: readAgentToolString(input, 'title', goal.title),
          interpretedGoal: readAgentToolString(input, 'interpretedGoal', goal.interpretedGoal || '') || goal.interpretedGoal,
          status: readAgentToolString(input, 'status', goal.status) as any,
          isCurrentFocus: typeof isCurrentFocus === 'boolean' ? isCurrentFocus : goal.isCurrentFocus,
        },
      })
      return { targetId: updated.id, result: updated }
    },
  },
  {
    name: 'today.get',
    description: '读取今天或最近的下一步行动。',
    permission: 'read',
    targetType: 'today',
    riskLevel: 'low',
    async handler(context, input) {
      const goal = await getCurrentGoal(context.userId, readAgentToolString(input, 'goalId'))
      const actions = await prisma.dailyAction.findMany({
        where: { userId: context.userId, goalId: goal.id },
        orderBy: { actionDate: 'desc' },
        take: 5,
        include: { condition: true, checkins: { orderBy: { createdAt: 'desc' }, take: 1 } },
      })
      return { targetId: actions[0]?.id, result: { goal: { id: goal.id, title: goal.title }, actions } }
    },
  },
  {
    name: 'today.set_next_action',
    description: '设置今天下一步行动。',
    permission: 'execute',
    targetType: 'today',
    riskLevel: 'medium',
    async handler(context, input) {
      const title = readAgentToolString(input, 'title')
      if (!title) throw new Error('缺少行动标题。')
      const goal = await getCurrentGoal(context.userId, readAgentToolString(input, 'goalId'))
      const condition = await getOrCreateCondition(context.userId, goal.id, input)
      const action = await prisma.dailyAction.create({
        data: {
          userId: context.userId,
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
    },
  },
  {
    name: 'checkin.submit',
    description: '提交今日行动的完成情况和阻塞原因。',
    permission: 'execute',
    targetType: 'checkin',
    riskLevel: 'low',
    async handler(context, input) {
      const actionId = readAgentToolString(input, 'actionId')
      const action = actionId
        ? await prisma.dailyAction.findFirst({ where: { id: actionId, userId: context.userId } })
        : await prisma.dailyAction.findFirst({ where: { userId: context.userId }, orderBy: { actionDate: 'desc' } })
      if (!action) throw new Error('没有找到可提交的今日行动。')
      const result = normalizeAgentToolCheckinResult(readAgentToolString(input, 'result', 'no_response'))
      const checkin = await prisma.checkin.create({
        data: {
          userId: context.userId,
          goalId: action.goalId,
          actionId: action.id,
          result: result as any,
          reasonCategory: readAgentToolString(input, 'reasonCategory') as any || undefined,
          userFeedback: readAgentToolString(input, 'userFeedback'),
          adjustment: readAgentToolString(input, 'adjustment'),
        },
      })
      await prisma.dailyAction.update({ where: { id: action.id }, data: { status: normalizeAgentToolActionStatus(result) as any } })
      return { targetId: checkin.id, result: checkin }
    },
  },
  {
    name: 'log.write_daily',
    description: '写入或更新当天 Markdown 日志。',
    permission: 'execute',
    targetType: 'log',
    riskLevel: 'low',
    async handler(context, input) {
      const content = readAgentToolString(input, 'content')
      if (!content) throw new Error('缺少日志内容。')
      const date = toAgentToolDateInput(readAgentToolString(input, 'date'))
      const dateInfo = formatAgentToolDatePath(date)
      const title = readAgentToolString(input, 'title', dateInfo.title)
      const linkedGoalIds = input.linkedGoalIds || []
      const linkedActionIds = input.linkedActionIds || []
      const document = await prisma.markdownDocument.upsert({
        where: { userId_path: { userId: context.userId, path: dateInfo.path } },
        update: {
          title,
          content,
          linkedGoalIds,
          linkedActionIds,
          source: 'AGENT',
        },
        create: {
          userId: context.userId,
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
        where: { userId_path: { userId: context.userId, path: dateInfo.path } },
        update: {
          title,
          content,
          linkedGoalIds,
          linkedActionIds,
        },
        create: {
          userId: context.userId,
          periodType: 'DAY',
          title,
          path: dateInfo.path,
          content,
          linkedGoalIds,
          linkedActionIds,
        },
      })
      return { targetId: document.id, result: document }
    },
  },
  {
    name: 'review.generate',
    description: '生成日复盘或周复盘草稿。',
    permission: 'draft',
    targetType: 'review',
    riskLevel: 'low',
    async handler(context, input) {
      const goal = await getCurrentGoal(context.userId, readAgentToolString(input, 'goalId'))
      const recentActions = await prisma.dailyAction.findMany({
        where: { userId: context.userId, goalId: goal.id },
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
    },
  },
  {
    name: 'reminder.schedule',
    description: '创建或调整提醒规则。',
    permission: 'execute',
    targetType: 'reminder',
    riskLevel: 'medium',
    async handler(context, input) {
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
        : await prisma.reminderRule.create({ data: { userId: context.userId, ...data } })
      return { targetId: rule.id, result: rule }
    },
  },
  {
    name: 'settings.model.get',
    description: '读取当前默认模型配置。',
    permission: 'read',
    targetType: 'settings',
    riskLevel: 'low',
    async handler(context) {
      const modelConfig = await prisma.modelConfig.findFirst({
        where: { userId: context.userId, isDefault: true },
        orderBy: { createdAt: 'asc' },
      })
      return { targetId: modelConfig?.id, result: modelConfig }
    },
  },
  {
    name: 'settings.model.update',
    description: '修改默认模型配置。',
    permission: 'execute',
    targetType: 'settings',
    riskLevel: 'medium',
    async handler(context, input) {
      const existing = await prisma.modelConfig.findFirst({
        where: { userId: context.userId, isDefault: true },
        orderBy: { createdAt: 'asc' },
      })
      const data = {
        provider: readAgentToolString(input, 'provider', existing?.provider || 'deepseek'),
        model: readAgentToolString(input, 'model', existing?.model || 'deepseek-v4-flash'),
        reasoningModel: readAgentToolString(input, 'reasoningModel', existing?.reasoningModel || ''),
        apiBase: readAgentToolString(input, 'apiBase', existing?.apiBase || 'https://api.deepseek.com'),
        apiKeyRef: readAgentToolString(input, 'apiKeyRef', existing?.apiKeyRef || 'DEEPSEEK_API_KEY'),
        usage: 'CHAT' as const,
        isDefault: true,
        temperature: readAgentToolNumber(input, 'temperature', existing?.temperature ?? 0.3),
      }
      const modelConfig = existing
        ? await prisma.modelConfig.update({ where: { id: existing.id }, data })
        : await prisma.modelConfig.create({ data: { userId: context.userId, ...data } })
      return { targetId: modelConfig.id, result: modelConfig }
    },
  },
]

export function listAgentTools() {
  return listSharedAgentTools()
}

export async function executeAgentTool(
  context: AgentToolContext,
  toolName: string,
  rawInput: unknown,
) {
  const definition = toolDefinitions.find((item) => item.name === toolName)
  if (!definition) throw new Error(`未知 Agent 工具：${toolName}`)

  const input = asAgentToolRecord(rawInput)
  const requiresConfirmation = definition.permission === 'execute' && !context.confirmed

  if (requiresConfirmation) {
    const action = await prisma.agentToolAction.create({
      data: {
        userId: context.userId,
        source: context.source,
        toolName: definition.name,
        permission: definition.permission,
        inputSummary: compactAgentToolSummary(input),
        input,
        targetType: definition.targetType,
        riskLevel: definition.riskLevel,
        requiresConfirmation: true,
        status: 'pending_confirmation',
        agentThreadId: context.agentThreadId,
        agentMessageId: context.agentMessageId,
      },
    })
    return { needsConfirmation: true, action, result: null }
  }

  try {
    let output: AgentToolHandlerResult
    if (canHandleSharedReadDraftTool(definition.name)) {
      output = await runSharedReadDraftToolHandler(prisma, context.userId, definition.name, input)
    } else if (canHandleSharedWriteTool(definition.name)) {
      output = await runSharedWriteToolHandler(prisma, context.userId, definition.name, input)
    } else {
      output = await definition.handler(context, input)
    }
    const action = await prisma.agentToolAction.create({
      data: {
        userId: context.userId,
        source: context.source,
        toolName: definition.name,
        permission: definition.permission,
        inputSummary: compactAgentToolSummary(input),
        input,
        result: output.result as any,
        targetType: definition.targetType,
        targetId: output.targetId,
        riskLevel: definition.riskLevel,
        requiresConfirmation: false,
        status: definition.permission === 'draft' ? 'drafted' : 'executed',
        agentThreadId: context.agentThreadId,
        agentMessageId: context.agentMessageId,
      },
    })
    return { needsConfirmation: false, action, result: output.result }
  } catch (error) {
    const action = await prisma.agentToolAction.create({
      data: {
        userId: context.userId,
        source: context.source,
        toolName: definition.name,
        permission: definition.permission,
        inputSummary: compactAgentToolSummary(input),
        input,
        targetType: definition.targetType,
        riskLevel: definition.riskLevel,
        requiresConfirmation,
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : String(error),
        agentThreadId: context.agentThreadId,
        agentMessageId: context.agentMessageId,
      },
    })
    return { needsConfirmation: false, action, result: null }
  }
}
