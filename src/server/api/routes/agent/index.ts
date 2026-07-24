import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '../../validator'
import { prisma } from '@/lib/db'
import { getCurrentUserId, notFound, unauthorized } from '../../context'
import { generateAgentToolIntent, generateAssistantReply } from '@/lib/agent-runtime'
import { executeAgentTool, listAgentTools } from '@/lib/agent-tools'
import { detectConfirmToolMessage, formatAgentToolReply } from '@/lib/agent-tool-shared.mjs'
import { hasModelApiKey } from '@/lib/model-secret.mjs'

const createThreadSchema = z.object({ title: z.string().min(1), goalId: z.string().uuid().optional() })
const updateThreadSchema = z.object({
  title: z.string().min(1).max(80).optional(),
  goalId: z.string().uuid().nullable().optional(),
  status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
})
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

function firstNonEmptyLine(content: string) {
  return content.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || ''
}

function extractLabeledValue(content: string, labels: string[]) {
  const lines = content.split(/\r?\n/)
  for (const label of labels) {
    const line = lines.find((item) => item.includes(label))
    if (!line) continue
    const value = line.slice(line.indexOf(label) + label.length).replace(/^[:：]\s*/, '').trim()
    if (value) return value
  }
  return ''
}

function parseLooseDate(value: string) {
  const text = value.trim()
  if (!text) return undefined
  const normalized = text
    .replace(/[年月]/g, '-')
    .replace(/日/g, '')
    .replace(/\./g, '-')
    .replace(/\//g, '-')
  const parsed = new Date(normalized)
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
  const monthDay = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日?/)
  if (monthDay) {
    const year = new Date().getFullYear()
    const parsedMonthDay = new Date(year, Number(monthDay[1]) - 1, Number(monthDay[2]))
    if (!Number.isNaN(parsedMonthDay.getTime())) return parsedMonthDay.toISOString()
  }
  return undefined
}

function parseRelativeDeadline(content: string) {
  const match = content.match(/(\d+)\s*(天|日|周|个月|月|年)\s*(内|之内|以后|后)?/)
  if (!match) return undefined
  const amount = Number(match[1])
  if (!Number.isFinite(amount) || amount <= 0) return undefined
  const date = new Date()
  const unit = match[2]
  if (unit === '天' || unit === '日') date.setDate(date.getDate() + amount)
  if (unit === '周') date.setDate(date.getDate() + amount * 7)
  if (unit === '个月' || unit === '月') date.setMonth(date.getMonth() + amount)
  if (unit === '年') date.setFullYear(date.getFullYear() + amount)
  return date.toISOString()
}

function extractDeadline(content: string) {
  const labeled = extractLabeledValue(content, ['截止时间是', '截止时间', '截止到', '期限是', '到'])
  const explicitDate = parseLooseDate(labeled) || parseLooseDate((content.match(/(\d{4}[年/-]\d{1,2}[月/-]\d{1,2}日?|\d{1,2}月\d{1,2}日?)/)?.[1] || ''))
  return explicitDate || parseRelativeDeadline(content)
}

function extractDesiredResult(content: string) {
  const labeled = extractLabeledValue(content, ['我想达到的结果是', '想达到的结果是', '目标结果是', '目标是', '结果是'])
  if (labeled) return labeled
  const sentence = firstNonEmptyLine(content)
    .replace(/^(我想|我希望|希望|我要|我准备|准备|帮我|请你|麻烦你|目标是|计划是)\s*/u, '')
    .replace(/[。！？!?.].*$/u, '')
    .trim()
  return sentence || content.trim()
}

function extractCurrentState(content: string) {
  const labeled = extractLabeledValue(content, ['我现在的情况是', '现在的情况是', '当前情况是', '目前情况是', '现在是'])
  if (labeled) return labeled
  const currentMatch = content.match(/(现在|目前|当前)[，,：:\s]*(.{4,80})/)
  return currentMatch?.[2]?.trim() || ''
}

function isGoalLikeContent(content: string) {
  return /(我想|我希望|希望|我要|我准备|目标|计划|想要|帮我规划|提升|完成|达成|减到|学会|写完|上线|通过|考到|做到)/u.test(content)
}

function hasMeasurableSignal(content: string) {
  return /(\d+|一|二|三|四|五|六|七|八|九|十|百|千|万).*(斤|公斤|分|篇|字|小时|分钟|天|周|个月|次|个|%|％)|从\s*\d+.*到\s*\d+|完成|上线|发布|通过|考到|减到|写完|跑通/u.test(content)
}

function hasTimeSignal(content: string, deadline?: string) {
  return Boolean(deadline || /(今天|明天|本周|这周|下周|月底|年底|暑假|寒假|季度|年度|年前|月前|\d+\s*(天|日|周|个月|月|年)\s*(内|之内)?)/u.test(content))
}

function hasCurrentStateSignal(content: string, currentState: string) {
  return Boolean(currentState || /(现在|目前|当前|已经|还没有|刚开始|卡在|最大问题|最难|从\s*\d+)/u.test(content))
}

function shouldUseFirstGoalDraft(content: string, existingGoalCount: number, structuredOutputType?: string) {
  if (existingGoalCount > 0) return false
  if (structuredOutputType === 'first_goal_intake') return true
  if (!isGoalLikeContent(content)) return false
  const deadline = extractDeadline(content)
  const currentState = extractCurrentState(content)
  const desiredResult = extractDesiredResult(content)
  const hasOutcome = desiredResult.length >= 8 || hasMeasurableSignal(content)
  return hasOutcome && (hasTimeSignal(content, deadline) || hasCurrentStateSignal(content, currentState) || hasMeasurableSignal(content))
}

function shouldClarifyFirstGoal(content: string, existingGoalCount: number, structuredOutputType?: string) {
  if (existingGoalCount > 0 || structuredOutputType === 'first_goal_intake') return false
  return isGoalLikeContent(content) && !shouldUseFirstGoalDraft(content, existingGoalCount, structuredOutputType)
}

function buildFirstGoalClarification(content: string) {
  const desiredResult = extractDesiredResult(content)
  const deadline = extractDeadline(content)
  const currentState = extractCurrentState(content)
  if (!desiredResult || desiredResult.length < 8) {
    return '你最终想看到什么可验证结果？用一句话说清楚“到什么程度算成”。'
  }
  if (!hasTimeSignal(content, deadline)) {
    return '这个结果希望到哪一天，或者哪个周期结束时看到？'
  }
  if (!hasCurrentStateSignal(content, currentState)) {
    return '你现在处在什么状态？只说当前水平和最卡的一点就够。'
  }
  return '我还差一个判断：这件事最容易失控的点是什么？比如太难、忘记、时间不对，还是方向不确定。'
}

function inferDailyAction(content: string) {
  if (/(减肥|体重|运动|健身|走路|跑步|饮食|睡眠)/u.test(content)) {
    return {
      title: '完成 10 分钟低门槛身体管理动作',
      doneWhen: '完成 10 分钟走路、拉伸或记录今天第一餐，并回复实际完成情况。',
      minimumStep: '先站起来走 2 分钟，或者写下今天第一餐吃什么。',
      estimatedMinutes: 10,
      fallbackAction: '状态很差时，只记录一条饮食或体重事实。',
      checkinQuestion: '这一步完成了吗？如果没完成，是太难、忘了，还是时间不对？',
    }
  }
  if (/(英语|背单词|学习|考试|阅读|默写|课程)/u.test(content)) {
    return {
      title: '完成 10 分钟最小学习动作',
      doneWhen: '学习 10 分钟，并记录一个已完成内容或一个卡住点。',
      minimumStep: '先打开材料，读或背 2 分钟。',
      estimatedMinutes: 10,
      fallbackAction: '状态很差时，只复习 3 个最小知识点。',
      checkinQuestion: '这 10 分钟完成了吗？卡住点是什么？',
    }
  }
  if (/(写|文章|日记|公众号|视频|内容|自媒体|发布)/u.test(content)) {
    return {
      title: '写 300 字可继续扩展的草稿',
      doneWhen: '写出 300 字草稿，哪怕很粗糙，也要能继续修改。',
      minimumStep: '先写 3 个要点。',
      estimatedMinutes: 15,
      fallbackAction: '状态很差时，只写一个标题和 3 个要点。',
      checkinQuestion: '草稿写出来了吗？如果没写，是没题目、太难，还是时间不对？',
    }
  }
  if (/(项目|代码|开发|产品|软件|上线|实现|比赛|仓库)/u.test(content)) {
    return {
      title: '推进一个 15 分钟可验证开发小步',
      doneWhen: '完成一个能被看见的小改动、文档补充或问题定位记录。',
      minimumStep: '先打开项目，写下当前最小可推进点。',
      estimatedMinutes: 15,
      fallbackAction: '状态很差时，只定位一个文件或写一条待办证据。',
      checkinQuestion: '这个小步是否留下了可验证证据？',
    }
  }
  return {
    title: '完成 10 分钟与目标直接相关的最小动作',
    doneWhen: '完成一个可以被描述和反馈的小动作，并回复实际结果。',
    minimumStep: '只开始 2 分钟。',
    estimatedMinutes: 10,
    fallbackAction: '状态很差时，只记录当前事实和下一步障碍。',
    checkinQuestion: '这一步完成了吗？没完成的主要原因是什么？',
  }
}

function buildFirstGoalDraftInput(content: string) {
  const desiredResult = extractDesiredResult(content)
  const deadline = extractDeadline(content)
  const currentState = extractCurrentState(content)
  const titleSource = desiredResult || firstNonEmptyLine(content).replace(/^我想/, '').trim()
  const title = titleSource.length > 36 ? `${titleSource.slice(0, 36)}...` : titleSource
  if (!title) return null
  const dailyAction = inferDailyAction(content)

  return {
    title,
    rawInput: content,
    interpretedGoal: [
      desiredResult ? `目标结果：${desiredResult}` : '',
      deadline ? `截止时间：${deadline.slice(0, 10)}` : '',
      currentState ? `当前情况：${currentState}` : '',
    ].filter(Boolean).join('\n') || content,
    horizonStart: new Date().toISOString(),
    ...(deadline ? { horizonEnd: deadline } : {}),
    purposeSummary: desiredResult || title,
    successSignals: [
      desiredResult || title,
      deadline ? `在 ${deadline.slice(0, 10)} 前看到可验证变化` : '形成可验证的现实变化',
      '每天有完成、部分完成或没完成的反馈证据',
    ],
    keyResults: [
      {
        title: `达到可验证结果：${title}`,
        metricType: 'TEXT',
        currentValue: currentState || '当前状态待继续校准',
        targetValue: desiredResult || title,
        progress: 0,
        whyNecessary: '这是判断目标是否真的落地的直接结果。',
      },
      {
        title: '形成稳定的每日行动和反馈证据',
        metricType: 'TEXT',
        currentValue: '未形成稳定反馈',
        targetValue: '每天至少留下完成、部分完成或未完成原因',
        progress: 0,
        whyNecessary: '没有反馈证据，AI 无法持续调整下一步。',
      },
      {
        title: '识别并控制主要失控风险',
        metricType: 'TEXT',
        currentValue: '风险点待验证',
        targetValue: '关键风险点有提前提示、兜底动作和复盘证据',
        progress: 0,
        whyNecessary: '目标推进失败通常发生在风险点失控，而不是任务列表不够多。',
      },
    ],
    necessaryConditions: [
      {
        title: '成功标准和时间边界足够清楚',
        conditionType: 'hard',
        status: deadline && desiredResult ? 'partial' : 'missing',
        whyRequired: '没有验收标准，系统无法判断目标是否真的完成。',
      },
      {
        title: '今日行动足够小，能立刻启动',
        conditionType: 'hard',
        status: 'partial',
        whyRequired: '目标必须落到今天能做的一步，才能进入反馈闭环。',
      },
      {
        title: '主要风险点进入可提醒、可兜底、可复盘状态',
        conditionType: 'assumed',
        status: 'missing',
        whyRequired: '失控风险如果没有提前处理，目标会在关键时刻脱离系统控制。',
      },
    ],
    stagePlans: [
      {
        title: '澄清和启动',
        stageGoal: '确认验收标准，完成第一次最小行动，建立反馈入口。',
        successSignals: ['目标标准可复述', 'Today 有唯一下一步', '第一次反馈已产生'],
        sortOrder: 0,
      },
      {
        title: '稳定推进',
        stageGoal: '让每日行动、反馈和风险提示形成稳定节奏。',
        successSignals: ['连续产生反馈证据', '未完成原因能被分类', '行动难度可调整'],
        sortOrder: 1,
      },
      {
        title: '复盘调整',
        stageGoal: '根据反馈更新路径、风险控制和下一阶段重点。',
        successSignals: ['日志沉淀有效判断', '下一步由反馈自动调整', '旧假设被验证或修正'],
        sortOrder: 2,
      },
    ],
    evidence: ['用户通过首次自然语言目标输入。', currentState ? `当前状态：${currentState}` : '当前状态仍需继续追问校准。'],
    dailyAction,
  }
}

async function maybeBuildForcedGoalDraftIntent(userId: string, content: string, structuredOutputType?: string) {
  const existingGoalCount = await prisma.goal.count({ where: { userId } })
  if (!shouldUseFirstGoalDraft(content, existingGoalCount, structuredOutputType)) return null

  const defaultModel = await prisma.modelConfig.findFirst({
    where: { userId, isDefault: true },
    orderBy: { createdAt: 'asc' },
  })
  if (hasModelApiKey(defaultModel)) return null

  const input = buildFirstGoalDraftInput(content)
  if (!input) return null
  return {
    toolName: 'goal.create_draft',
    input,
    confidence: 1,
    reason: '首次目标输入，直接生成目标草案。',
  }
}

async function maybeBuildFirstGoalClarification(userId: string, content: string, structuredOutputType?: string) {
  const existingGoalCount = await prisma.goal.count({ where: { userId } })
  if (!shouldClarifyFirstGoal(content, existingGoalCount, structuredOutputType)) return null
  return {
    content: buildFirstGoalClarification(content),
    structuredOutputType: 'first_goal_clarification',
    structuredOutput: {
      natural_reply: buildFirstGoalClarification(content),
      missing: 'first_goal_required_fact',
      requires_confirmation: false,
    },
  }
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
  .patch('/threads/:id', zValidator('json', updateThreadSchema), async (c) => {
    const userId = await getCurrentUserId(c)
    if (!userId) return unauthorized(c)

    const thread = await prisma.agentThread.findFirst({ where: { id: c.req.param('id'), userId } })
    if (!thread) return notFound(c, '对话不存在。')

    const input = c.req.valid('json')
    const data: Record<string, unknown> = {}
    if (typeof input.title === 'string') data.title = input.title.trim()
    if ('goalId' in input) data.goalId = input.goalId || null
    if (input.status) data.status = input.status

    const updated = await prisma.agentThread.update({ where: { id: thread.id }, data })
    return c.json({ data: updated })
  })
  .delete('/threads/:id', async (c) => {
    const userId = await getCurrentUserId(c)
    if (!userId) return unauthorized(c)

    const thread = await prisma.agentThread.findFirst({ where: { id: c.req.param('id'), userId } })
    if (!thread) return notFound(c, '对话不存在。')

    await prisma.agentThread.delete({ where: { id: thread.id } })
    return c.json({ data: { id: thread.id, deleted: true } })
  })
  .delete('/threads/:id/messages', async (c) => {
    const userId = await getCurrentUserId(c)
    if (!userId) return unauthorized(c)

    const thread = await prisma.agentThread.findFirst({ where: { id: c.req.param('id'), userId } })
    if (!thread) return notFound(c, '对话不存在。')

    const deleted = await prisma.agentMessage.deleteMany({ where: { userId, threadId: thread.id } })
    await prisma.agentThread.update({ where: { id: thread.id }, data: { updatedAt: new Date() } })
    return c.json({ data: { threadId: thread.id, deletedMessages: deleted.count } })
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
          where: {
            userId,
            status: 'pending_confirmation',
            source: 'web',
            agentThreadId: thread.id,
          },
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
        natural_reply: assistantContent,
        tool_intent: { toolName: pendingAction.toolName, input: pendingAction.input },
        requires_confirmation: false,
        tool_result: execution,
        confirmedActionId: pendingAction.id,
        executedActionId: execution.action?.id,
        toolName: pendingAction.toolName,
        needsConfirmation: execution.needsConfirmation,
      }
    } else {
      const firstGoalClarification = await maybeBuildFirstGoalClarification(userId, input.content, input.structuredOutputType)
      if (firstGoalClarification) {
        assistantContent = firstGoalClarification.content
        structuredOutputType = firstGoalClarification.structuredOutputType
        structuredOutput = firstGoalClarification.structuredOutput
      } else {
        const toolIntent = await maybeBuildForcedGoalDraftIntent(userId, input.content, input.structuredOutputType)
          || await generateAgentToolIntent(userId, input.content)
        if (toolIntent) {
        const execution = await executeAgentTool(
          { userId, source: 'web', confirmed: false, agentThreadId: thread.id, agentMessageId: userMessage.id },
          toolIntent.toolName,
          toolIntent.input,
        )
        assistantContent = formatAgentToolReply(toolIntent.toolName, execution)
        structuredOutputType = 'agent_tool_result'
        let activationExecution: any = null
        if (toolIntent.toolName === 'goal.create_draft' && execution?.result?.goal?.id) {
          activationExecution = await executeAgentTool(
            { userId, source: 'web', confirmed: false, agentThreadId: thread.id, agentMessageId: userMessage.id },
            'goal.update',
            { goalId: execution.result.goal.id, status: 'ACTIVE', isCurrentFocus: true },
          )
          assistantContent = [
            assistantContent,
            '',
            '如果这个目标方向对，下一步确认激活为当前主目标。激活后 Today 会使用它生成今天的行动。',
          ].join('\n')
        }
        structuredOutput = {
          natural_reply: assistantContent,
          tool_intent: toolIntent,
          requires_confirmation: activationExecution?.needsConfirmation || execution.needsConfirmation,
          tool_result: execution,
          activation_result: activationExecution,
          toolIntent,
          toolActionId: activationExecution?.action?.id || execution.action?.id,
          needsConfirmation: activationExecution?.needsConfirmation || execution.needsConfirmation,
        }
        }
      }
    }

    if (!assistantContent) {
      const reply = await generateAssistantReply(userId, thread.id, input.content)
      assistantContent = reply.content
      structuredOutputType = structuredOutputType || 'agent_reply'
      structuredOutput = structuredOutput || reply.structuredOutput
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
