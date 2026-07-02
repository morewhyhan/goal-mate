import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '../../validator'
import { prisma } from '@/lib/db'
import { getCurrentUserId, notFound, unauthorized } from '../../context'
import { generateAgentToolIntent, generateAssistantReply } from '@/lib/agent-runtime'
import { executeAgentTool, listAgentTools } from '@/lib/agent-tools'
import { detectConfirmToolMessage, formatAgentToolReply } from '@/lib/agent-tool-shared.mjs'

const createThreadSchema = z.object({ title: z.string().min(1), goalId: z.string().uuid().optional() })
const createMessageSchema = z.object({
  content: z.string().min(1),
  structuredOutputType: z.string().optional(),
  structuredOutput: z.unknown().optional(),
})
const executeToolSchema = z.object({
  toolName: z.string().min(1),
  input: z.unknown().optional(),
  confirmed: z.boolean().optional(),
  agentThreadId: z.string().uuid().optional(),
  agentMessageId: z.string().uuid().optional(),
})
const rejectToolActionSchema = z.object({
  reason: z.string().optional(),
})

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
  .post('/tools/actions/:id/confirm', async (c) => {
    const userId = await getCurrentUserId(c)
    if (!userId) return unauthorized(c)

    const action = await prisma.agentToolAction.findFirst({ where: { id: c.req.param('id'), userId } })
    if (!action) return notFound(c, '工具动作不存在。')
    if (action.status !== 'pending_confirmation') {
      return c.json({ data: { action, confirmed: false, message: '该工具动作不在待确认状态。' } })
    }

    await prisma.agentToolAction.update({ where: { id: action.id }, data: { status: 'approved' } })
    const execution = await executeAgentTool(
      {
        userId,
        source: 'web',
        confirmed: true,
        agentThreadId: action.agentThreadId || undefined,
        agentMessageId: action.agentMessageId || undefined,
      },
      action.toolName,
      action.input,
    )

    let assistantMessage = null
    if (action.agentThreadId) {
      assistantMessage = await prisma.agentMessage.create({
        data: {
          userId,
          threadId: action.agentThreadId,
          role: 'ASSISTANT',
          content: formatAgentToolReply(action.toolName, execution),
          structuredOutputType: 'agent_tool_result',
          structuredOutput: {
            confirmedActionId: action.id,
            executedActionId: execution.action?.id,
            toolName: action.toolName,
            needsConfirmation: execution.needsConfirmation,
          },
        },
      })
      await prisma.agentThread.update({ where: { id: action.agentThreadId }, data: { updatedAt: new Date() } })
    }

    return c.json({ data: { confirmed: true, actionId: action.id, execution, assistantMessage } })
  })
  .post('/tools/actions/:id/reject', zValidator('json', rejectToolActionSchema), async (c) => {
    const userId = await getCurrentUserId(c)
    if (!userId) return unauthorized(c)

    const action = await prisma.agentToolAction.findFirst({ where: { id: c.req.param('id'), userId } })
    if (!action) return notFound(c, '工具动作不存在。')
    const input = c.req.valid('json')
    const rejected = await prisma.agentToolAction.update({
      where: { id: action.id },
      data: {
        status: 'rejected',
        errorMessage: input.reason || '用户取消执行。',
      },
    })

    let assistantMessage = null
    if (action.agentThreadId) {
      assistantMessage = await prisma.agentMessage.create({
        data: {
          userId,
          threadId: action.agentThreadId,
          role: 'ASSISTANT',
          content: `已取消执行：${action.toolName}`,
          structuredOutputType: 'agent_tool_result',
          structuredOutput: {
            rejectedActionId: action.id,
            toolName: action.toolName,
            needsConfirmation: false,
          },
        },
      })
      await prisma.agentThread.update({ where: { id: action.agentThreadId }, data: { updatedAt: new Date() } })
    }

    return c.json({ data: { rejected, assistantMessage } })
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

    const pendingAction = detectConfirmToolMessage(input.content)
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
      assistantContent = formatAgentToolReply(pendingAction.toolName, execution)
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
        assistantContent = formatAgentToolReply(toolIntent.toolName, execution)
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

export default app
