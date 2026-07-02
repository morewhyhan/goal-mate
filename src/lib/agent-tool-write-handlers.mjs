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
    if (isCurrentFocus) {
      await prisma.goal.updateMany({ where: { userId }, data: { isCurrentFocus: false } })
    }

    const updated = await prisma.goal.update({
      where: { id: goal.id },
      data: {
        title: readAgentToolString(input, 'title', goal.title),
        interpretedGoal: readAgentToolString(input, 'interpretedGoal', goal.interpretedGoal || '') || goal.interpretedGoal,
        status: readAgentToolString(input, 'status', goal.status),
        isCurrentFocus: typeof isCurrentFocus === 'boolean' ? isCurrentFocus : goal.isCurrentFocus,
      },
    })
    return { targetId: updated.id, result: updated }
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
      ? await prisma.dailyAction.findFirst({ where: { id: actionId, userId } })
      : await prisma.dailyAction.findFirst({ where: { userId }, orderBy: { actionDate: 'desc' } })
    if (!action) throw new Error('没有找到可提交的今日行动。')

    const result = normalizeAgentToolCheckinResult(readAgentToolString(input, 'result', 'no_response'))
    const checkin = await prisma.checkin.create({
      data: {
        userId,
        goalId: action.goalId,
        actionId: action.id,
        result,
        reasonCategory: readAgentToolString(input, 'reasonCategory') || undefined,
        userFeedback: readAgentToolString(input, 'userFeedback'),
        adjustment: readAgentToolString(input, 'adjustment'),
      },
    })
    await prisma.dailyAction.update({ where: { id: action.id }, data: { status: normalizeAgentToolActionStatus(result) } })
    return { targetId: checkin.id, result: checkin }
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
