import { prisma } from '@/lib/db'
import { listSharedAgentTools } from '@/lib/agent-tool-shared.mjs'

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

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {}
}

function readString(input: Record<string, unknown>, key: string, fallback = '') {
  const value = input[key]
  return typeof value === 'string' ? value.trim() : fallback
}

function readNumber(input: Record<string, unknown>, key: string, fallback: number) {
  const value = input[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function readBoolean(input: Record<string, unknown>, key: string) {
  const value = input[key]
  return typeof value === 'boolean' ? value : undefined
}

function compactSummary(input: Record<string, unknown>) {
  const text = JSON.stringify(input)
  return text.length > 500 ? `${text.slice(0, 500)}...` : text
}

function toDateInput(value: string) {
  if (!value) return new Date()
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed
}

function formatDatePath(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return {
    title: `${year}-${month}-${day}`,
    path: `Logs/${year}/${month}/${year}-${month}-${day}.md`,
  }
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
  const conditionId = readString(input, 'conditionId')
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
      title: readString(input, 'conditionTitle', '当前关键条件'),
      type: 'ASSUMED',
      status: 'PARTIAL',
      whyRequired: readString(input, 'conditionReason', '用于承接 Agent 设置今日行动时缺失的关键条件。'),
    },
  })
}

function normalizeCheckinResult(value: string) {
  const normalized = value.toLowerCase()
  if (normalized === 'done') return 'DONE'
  if (normalized === 'partial') return 'PARTIAL'
  if (normalized === 'not_done') return 'NOT_DONE'
  return 'NO_RESPONSE'
}

function normalizeActionStatus(value: string) {
  const normalized = normalizeCheckinResult(value)
  if (normalized === 'DONE') return 'DONE'
  if (normalized === 'PARTIAL') return 'PARTIAL'
  if (normalized === 'NOT_DONE') return 'NOT_DONE'
  return 'PLANNED'
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
      const goal = await getCurrentGoal(context.userId, readString(input, 'goalId'))
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
      const title = readString(input, 'title')
      if (!title) throw new Error('缺少目标标题。')
      const rawInput = readString(input, 'rawInput', title)
      const goal = await prisma.goal.create({
        data: {
          userId: context.userId,
          title,
          rawInput,
          interpretedGoal: readString(input, 'interpretedGoal', rawInput),
          status: 'DRAFT',
          isCurrentFocus: false,
        },
      })
      const card = await prisma.goalReasoningCard.create({
        data: {
          userId: context.userId,
          goalId: goal.id,
          purposeSummary: readString(input, 'purposeSummary', rawInput),
          successSignals: input.successSignals || [],
          sufficientConditionSet: readString(input, 'sufficientConditionSet', '待 Agent 与用户继续确认。'),
          recommendedFocus: readString(input, 'recommendedFocus', '先确认这个目标怎么算真正有进展。'),
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
      const goal = await getCurrentGoal(context.userId, readString(input, 'goalId'))
      const isCurrentFocus = readBoolean(input, 'isCurrentFocus')
      if (isCurrentFocus) {
        await prisma.goal.updateMany({ where: { userId: context.userId }, data: { isCurrentFocus: false } })
      }
      const updated = await prisma.goal.update({
        where: { id: goal.id },
        data: {
          title: readString(input, 'title', goal.title),
          interpretedGoal: readString(input, 'interpretedGoal', goal.interpretedGoal || '') || goal.interpretedGoal,
          status: readString(input, 'status', goal.status) as any,
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
      const goal = await getCurrentGoal(context.userId, readString(input, 'goalId'))
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
      const title = readString(input, 'title')
      if (!title) throw new Error('缺少行动标题。')
      const goal = await getCurrentGoal(context.userId, readString(input, 'goalId'))
      const condition = await getOrCreateCondition(context.userId, goal.id, input)
      const action = await prisma.dailyAction.create({
        data: {
          userId: context.userId,
          goalId: goal.id,
          conditionId: condition.id,
          actionDate: toDateInput(readString(input, 'actionDate')),
          title,
          reason: readString(input, 'reason', '由 Agent 根据当前推进状态设置。'),
          doneWhen: readString(input, 'doneWhen', '用户明确回复已完成，并说明完成结果。'),
          minimumStep: readString(input, 'minimumStep', title),
          estimatedMinutes: Math.round(readNumber(input, 'estimatedMinutes', 20)),
          fallbackAction: readString(input, 'fallbackAction', '如果今天状态很差，只完成最小启动动作。'),
          checkinQuestion: readString(input, 'checkinQuestion', '这一步现在能开始吗？'),
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
      const actionId = readString(input, 'actionId')
      const action = actionId
        ? await prisma.dailyAction.findFirst({ where: { id: actionId, userId: context.userId } })
        : await prisma.dailyAction.findFirst({ where: { userId: context.userId }, orderBy: { actionDate: 'desc' } })
      if (!action) throw new Error('没有找到可提交的今日行动。')
      const result = normalizeCheckinResult(readString(input, 'result', 'no_response'))
      const checkin = await prisma.checkin.create({
        data: {
          userId: context.userId,
          goalId: action.goalId,
          actionId: action.id,
          result: result as any,
          reasonCategory: readString(input, 'reasonCategory') as any || undefined,
          userFeedback: readString(input, 'userFeedback'),
          adjustment: readString(input, 'adjustment'),
        },
      })
      await prisma.dailyAction.update({ where: { id: action.id }, data: { status: normalizeActionStatus(result) as any } })
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
      const content = readString(input, 'content')
      if (!content) throw new Error('缺少日志内容。')
      const date = toDateInput(readString(input, 'date'))
      const dateInfo = formatDatePath(date)
      const title = readString(input, 'title', dateInfo.title)
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
      const goal = await getCurrentGoal(context.userId, readString(input, 'goalId'))
      const recentActions = await prisma.dailyAction.findMany({
        where: { userId: context.userId, goalId: goal.id },
        orderBy: { actionDate: 'desc' },
        take: 7,
        include: { checkins: { orderBy: { createdAt: 'desc' }, take: 1 } },
      })
      const lines = [
        `# ${readString(input, 'type', 'daily')} review draft`,
        '',
        `目标：${goal.title}`,
        '',
        '## 最近行动',
        ...recentActions.map((action) => `- ${action.title}：${action.status}`),
        '',
        '## 下一步',
        readString(input, 'nextFocus', '继续围绕当前最关键条件推进一个最小行动。'),
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
      const reminderType = readString(input, 'reminderType', 'morning_planning')
      const schedule = readString(input, 'schedule', '08:30')
      const ruleId = readString(input, 'ruleId')
      const data = {
        goalId: readString(input, 'goalId') || null,
        reminderType,
        channel: readString(input, 'channel', 'qq'),
        schedule,
        timezone: readString(input, 'timezone', 'Asia/Shanghai'),
        maxPerDay: Math.round(readNumber(input, 'maxPerDay', 2)),
        quietHours: input.quietHours || undefined,
        enabled: readBoolean(input, 'enabled') ?? true,
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
        provider: readString(input, 'provider', existing?.provider || 'deepseek'),
        model: readString(input, 'model', existing?.model || 'deepseek-v4-flash'),
        reasoningModel: readString(input, 'reasoningModel', existing?.reasoningModel || ''),
        apiBase: readString(input, 'apiBase', existing?.apiBase || 'https://api.deepseek.com'),
        apiKeyRef: readString(input, 'apiKeyRef', existing?.apiKeyRef || 'DEEPSEEK_API_KEY'),
        usage: 'CHAT' as const,
        isDefault: true,
        temperature: readNumber(input, 'temperature', existing?.temperature ?? 0.3),
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

  const input = asRecord(rawInput)
  const requiresConfirmation = definition.permission === 'execute' && !context.confirmed

  if (requiresConfirmation) {
    const action = await prisma.agentToolAction.create({
      data: {
        userId: context.userId,
        source: context.source,
        toolName: definition.name,
        permission: definition.permission,
        inputSummary: compactSummary(input),
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
    const output = await definition.handler(context, input)
    const action = await prisma.agentToolAction.create({
      data: {
        userId: context.userId,
        source: context.source,
        toolName: definition.name,
        permission: definition.permission,
        inputSummary: compactSummary(input),
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
        inputSummary: compactSummary(input),
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
