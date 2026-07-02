import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '../../validator'
import { prisma } from '@/lib/db'
import { getCurrentUserId, notFound, unauthorized } from '../../context'
import { generateAgentToolIntent, generateAssistantReply } from '@/lib/agent-runtime'
import { executeAgentTool, listAgentTools } from '@/lib/agent-tools'

const createThreadSchema = z.object({ title: z.string().min(1), goalId: z.string().uuid().optional() })
const createMessageSchema = z.object({
  content: z.string().min(1),
  structuredOutputType: z.string().optional(),
  structuredOutput: z.unknown().optional(),
})
const confirmStructuredOutputSchema = z.object({
  messageId: z.string().uuid(),
  outputType: z.string().min(1),
})
const executeToolSchema = z.object({
  toolName: z.string().min(1),
  input: z.unknown().optional(),
  confirmed: z.boolean().optional(),
  agentThreadId: z.string().uuid().optional(),
  agentMessageId: z.string().uuid().optional(),
})

function isConfirmToolMessage(content: string) {
  return /^(确认执行|确认|执行|同意|可以|就这么做|开始执行)$/i.test(content.trim())
}

function formatToolReply(toolName: string, execution: any) {
  const action = execution?.action
  if (action?.status === 'failed') {
    return `这个操作没有执行成功：${action.errorMessage || '未知错误'}`
  }
  if (execution?.needsConfirmation) {
    return [
      '我理解你要改动系统数据。',
      `动作：${toolName}`,
      '我已经生成待确认动作。你回复“确认执行”后，我再真正执行。',
    ].join('\n')
  }

  const result = execution?.result
  if (toolName === 'goal.list' && Array.isArray(result)) {
    if (!result.length) return '当前还没有目标。你可以直接告诉我你想推进什么，我会先帮你生成目标草案。'
    return [
      `当前共有 ${result.length} 个目标：`,
      ...result.map((goal: any) => `- ${goal.title}${goal.isCurrentFocus ? '（当前主目标）' : ''}：${goal.status}`),
    ].join('\n')
  }
  if (toolName === 'today.get') {
    const actions = Array.isArray(result?.actions) ? result.actions : []
    if (!actions.length) return '当前还没有今日行动。你可以让我基于当前目标设置下一步。'
    const action = actions[0]
    return [
      `当前下一步：${action.title}`,
      `完成标准：${action.doneWhen}`,
      `最小启动：${action.minimumStep}`,
      `状态：${action.status}`,
    ].join('\n')
  }
  if (toolName === 'goal.create_draft') return '目标草案已经生成。下一步应该确认：这个目标怎么算真正有进展。'
  if (toolName === 'today.set_next_action') return `今日下一步已经设置：${result?.title || '新的行动'}`
  if (toolName === 'checkin.submit') return '完成情况已经记录。'
  if (toolName === 'log.write_daily') return `日志已经写入：${result?.path || '今日日志'}`
  if (toolName === 'review.generate') return result?.markdown || '复盘草稿已经生成。'
  if (toolName === 'reminder.schedule') return `提醒规则已经设置：${result?.reminderType || 'reminder'} ${result?.schedule || ''}`
  if (toolName === 'settings.model.get') {
    return result ? `当前默认模型：${result.provider} / ${result.model}` : '当前还没有默认模型配置。'
  }
  if (toolName === 'settings.model.update') return `默认模型已经更新为：${result?.provider || 'provider'} / ${result?.model || 'model'}`
  return `已处理：${toolName}`
}

const app = new Hono()
  .basePath('/agent')
  .get('/tools', async (c) => {
    const userId = await getCurrentUserId(c)
    if (!userId) return unauthorized(c)

    return c.json({ data: listAgentTools() })
  })
  .get('/tools/actions', async (c) => {
    const userId = await getCurrentUserId(c)
    if (!userId) return unauthorized(c)

    const actions = await prisma.agentToolAction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    return c.json({ data: actions })
  })
  .post('/tools/execute', zValidator('json', executeToolSchema), async (c) => {
    const userId = await getCurrentUserId(c)
    if (!userId) return unauthorized(c)

    const input = c.req.valid('json')
    const result = await executeAgentTool(
      {
        userId,
        source: 'web',
        confirmed: input.confirmed,
        agentThreadId: input.agentThreadId,
        agentMessageId: input.agentMessageId,
      },
      input.toolName,
      input.input,
    )
    return c.json({ data: result })
  })
  .get('/threads', async (c) => {
    const userId = await getCurrentUserId(c)
    if (!userId) return unauthorized(c)

    const threads = await prisma.agentThread.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
    })
    return c.json({ data: threads })
  })
  .post('/threads', zValidator('json', createThreadSchema), async (c) => {
    const userId = await getCurrentUserId(c)
    if (!userId) return unauthorized(c)

    const input = c.req.valid('json')
    const thread = await prisma.agentThread.create({ data: { userId, title: input.title, goalId: input.goalId } })
    return c.json({ data: thread })
  })
  .get('/threads/:id/messages', async (c) => {
    const userId = await getCurrentUserId(c)
    if (!userId) return unauthorized(c)

    const thread = await prisma.agentThread.findFirst({ where: { id: c.req.param('id'), userId } })
    if (!thread) return notFound(c, '对话不存在。')

    const messages = await prisma.agentMessage.findMany({ where: { threadId: thread.id, userId }, orderBy: { createdAt: 'asc' } })
    return c.json({ data: messages })
  })
  .post('/threads/:id/messages', zValidator('json', createMessageSchema), async (c) => {
    const userId = await getCurrentUserId(c)
    if (!userId) return unauthorized(c)

    const thread = await prisma.agentThread.findFirst({ where: { id: c.req.param('id'), userId } })
    if (!thread) return notFound(c, '对话不存在。')

    const input = c.req.valid('json')
    const userMessage = await prisma.agentMessage.create({
      data: { userId, threadId: thread.id, role: 'USER', content: input.content },
    })

    let assistantContent = ''
    let structuredOutputType = input.structuredOutputType
    let structuredOutput = input.structuredOutput as any

    const pendingAction = isConfirmToolMessage(input.content)
      ? await prisma.agentToolAction.findFirst({
          where: { userId, status: 'pending_confirmation' },
          orderBy: { createdAt: 'desc' },
        })
      : null

    if (pendingAction) {
      await prisma.agentToolAction.update({ where: { id: pendingAction.id }, data: { status: 'approved' } })
      const execution = await executeAgentTool(
        { userId, source: 'web', confirmed: true, agentThreadId: thread.id, agentMessageId: userMessage.id },
        pendingAction.toolName,
        pendingAction.input,
      )
      assistantContent = formatToolReply(pendingAction.toolName, execution)
      structuredOutputType = 'agent_tool_result'
      structuredOutput = {
        confirmedActionId: pendingAction.id,
        executedActionId: execution.action?.id,
        toolName: pendingAction.toolName,
        needsConfirmation: execution.needsConfirmation,
      }
    } else {
      const toolIntent = await generateAgentToolIntent(userId, input.content)
      if (toolIntent) {
        const execution = await executeAgentTool(
          { userId, source: 'web', confirmed: false, agentThreadId: thread.id, agentMessageId: userMessage.id },
          toolIntent.toolName,
          toolIntent.input,
        )
        assistantContent = formatToolReply(toolIntent.toolName, execution)
        structuredOutputType = 'agent_tool_result'
        structuredOutput = {
          toolIntent,
          toolActionId: execution.action?.id,
          needsConfirmation: execution.needsConfirmation,
        }
      }
    }

    if (!assistantContent) {
      assistantContent = (await generateAssistantReply(userId, thread.id, input.content)).content
    }

    const assistantMessage = await prisma.agentMessage.create({
      data: {
        userId,
        threadId: thread.id,
        role: 'ASSISTANT',
        content: assistantContent,
        structuredOutputType,
        structuredOutput,
      },
    })

    await prisma.agentThread.update({ where: { id: thread.id }, data: { updatedAt: new Date() } })
    return c.json({ data: { userMessage, assistantMessage } })
  })
  .post('/structured-output/confirm', zValidator('json', confirmStructuredOutputSchema), async (c) => {
    const userId = await getCurrentUserId(c)
    if (!userId) return unauthorized(c)

    const input = c.req.valid('json')
    const message = await prisma.agentMessage.findFirst({ where: { id: input.messageId, userId } })
    if (!message) return notFound(c, '结构化输出不存在。')

    return c.json({ data: { confirmed: true, outputType: input.outputType, messageId: message.id } })
  })

export default app
