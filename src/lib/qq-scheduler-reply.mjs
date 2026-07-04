import { formatAgentToolDatePath } from './agent-tool-shared.mjs'

function formatReminderType(type) {
  if (type === 'morning_planning') return '早晨规划'
  if (type === 'midday_check') return '中午检查'
  if (type === 'evening_review') return '晚上复盘'
  if (type === 'weekly_review') return '周复盘'
  return type
}

export function classifyQqSchedulerReply(text) {
  const content = String(text || '').trim()
  const lower = content.toLowerCase()
  const done = /(完成|做完|已做|搞定|done|finished|ok了|好了)/i.test(content)
  const notDone = /(没做|没完成|未完成|没推进|没开始|失败|做不了|不想做|太难|忘了|来不及|拖延)/i.test(content)
  const partial = /(做了一点|一部分|部分|还差|进行中|started|partial)/i.test(content)

  let result = 'PARTIAL'
  if (done && !notDone) result = 'DONE'
  if (notDone) result = 'NOT_DONE'
  if (partial) result = 'PARTIAL'
  if (!done && !notDone && !partial) result = lower.length <= 6 ? 'NO_RESPONSE' : 'PARTIAL'

  let reasonCategory = 'UNKNOWN'
  if (/(不想|没意义|不重要|没动力|不值得|抗拒)/i.test(content)) reasonCategory = 'MOTIVATION'
  if (/(太难|不会|不知道怎么|做不了|累|困|没精力|时间不够|来不及)/i.test(content)) reasonCategory = 'ABILITY'
  if (/(忘|没提醒|时间不对|没看到|错过)/i.test(content)) reasonCategory = 'PROMPT'
  if (/(方向|路径|计划不对|不是关键|不知道为什么做)/i.test(content)) reasonCategory = 'PATH'

  const adjustment = result === 'DONE'
    ? '保持当前推进节奏，明天继续围绕关键条件推进下一步。'
    : reasonCategory === 'ABILITY'
      ? '明天把行动缩小到更容易开始的最小步骤。'
      : reasonCategory === 'PROMPT'
        ? '需要调整提醒时间或提醒方式。'
        : reasonCategory === 'MOTIVATION'
          ? '需要重新确认这个目标是否仍然重要。'
          : reasonCategory === 'PATH'
            ? '需要检查当前行动是否真的对应关键条件。'
            : '先记录反馈，下一步继续缩小动作并观察。'

  return { result, reasonCategory, userFeedback: content, adjustment }
}

export async function findRecentQqSchedulerEvent(prisma, userId, now = new Date()) {
  const hours = Number(process.env.QQ_SCHEDULER_REPLY_WINDOW_HOURS || '18')
  const threshold = new Date(now.getTime() - Math.max(1, hours) * 60 * 60 * 1000)
  return prisma.schedulerEvent.findFirst({
    where: {
      userId,
      channel: 'qq',
      status: 'sent',
      sentAt: { gte: threshold },
    },
    orderBy: { sentAt: 'desc' },
  })
}

async function buildSchedulerDailyLogContent(prisma, userId, schedulerEvent, feedback) {
  const dateInfo = formatAgentToolDatePath(new Date())
  const existing = await prisma.markdownDocument.findUnique({ where: { userId_path: { userId, path: dateInfo.path } } })
  const section = [
    `## ${formatReminderType(schedulerEvent.eventType)}反馈`,
    '',
    `- 时间：${new Date().toISOString()}`,
    `- 用户回复：${feedback.userFeedback}`,
    `- 系统判断：${feedback.result}`,
    `- 原因分类：${feedback.reasonCategory}`,
    `- 调整建议：${feedback.adjustment}`,
  ].join('\n')

  return existing?.content ? `${existing.content}\n\n${section}` : `# ${dateInfo.title}\n\n${section}`
}

export async function processQqSchedulerReply(prisma, options) {
  const { userId, thread, userMessage, context, executeAgentTool } = options
  const schedulerEvent = await findRecentQqSchedulerEvent(prisma, userId)
  if (!schedulerEvent) return null

  const feedback = classifyQqSchedulerReply(context.text)
  const toolResults = []

  if (schedulerEvent.eventType !== 'morning_planning' && schedulerEvent.eventType !== 'weekly_review') {
    const checkinExecution = await executeAgentTool(
      { userId, source: 'scheduler', confirmed: true, agentThreadId: thread.id, agentMessageId: userMessage.id },
      'checkin.submit',
      {
        result: feedback.result.toLowerCase(),
        reasonCategory: feedback.reasonCategory,
        userFeedback: feedback.userFeedback,
        adjustment: feedback.adjustment,
      },
    )
    toolResults.push({ toolName: 'checkin.submit', execution: checkinExecution })
  }

  const logContent = await buildSchedulerDailyLogContent(prisma, userId, schedulerEvent, feedback)
  const logExecution = await executeAgentTool(
    { userId, source: 'scheduler', confirmed: true, agentThreadId: thread.id, agentMessageId: userMessage.id },
    'log.write_daily',
    {
      title: formatAgentToolDatePath(new Date()).title,
      content: logContent,
    },
  )
  toolResults.push({ toolName: 'log.write_daily', execution: logExecution })

  if (schedulerEvent.eventType === 'weekly_review') {
    const reviewExecution = await executeAgentTool(
      { userId, source: 'scheduler', confirmed: true, agentThreadId: thread.id, agentMessageId: userMessage.id },
      'review.generate',
      { type: 'weekly', nextFocus: feedback.adjustment },
    )
    toolResults.push({ toolName: 'review.generate', execution: reviewExecution })
  }

  if (schedulerEvent.eventType === 'evening_review') {
    const reviewExecution = await executeAgentTool(
      { userId, source: 'scheduler', confirmed: true, agentThreadId: thread.id, agentMessageId: userMessage.id },
      'review.generate',
      { type: 'daily', nextFocus: feedback.adjustment },
    )
    toolResults.push({ toolName: 'review.generate', execution: reviewExecution })
  }

  await prisma.schedulerEvent.update({
    where: { id: schedulerEvent.id },
    data: {
      status: 'responded',
      payload: {
        previousPayload: schedulerEvent.payload || {},
        reply: {
          contextType: context.contextType,
          contextId: context.contextId,
          messageId: context.messageId,
          text: context.text,
          feedback,
          processedAt: new Date().toISOString(),
        },
      },
    },
  })

  const failed = toolResults.filter((item) => item.execution?.action?.status === 'failed')
  if (failed.length) {
    return {
      reply: [
        '我收到了这次反馈，但有一部分没有写入成功。',
        ...failed.map((item) => `- ${item.toolName}：${item.execution.action.errorMessage || '未知错误'}`),
        '已保留原始回复，后面可以继续补录。',
      ].join('\n'),
      feedback,
      toolResults,
      schedulerEventId: schedulerEvent.id,
    }
  }

  if (feedback.result === 'DONE') {
    return {
      reply: '已记录：这一步完成了。我把反馈写入了今日日志，下一次会继续围绕当前目标推进。',
      feedback,
      toolResults,
      schedulerEventId: schedulerEvent.id,
    }
  }
  if (feedback.result === 'NOT_DONE') {
    return {
      reply: `已记录：今天没有完成。我的当前判断是 ${feedback.reasonCategory}，下一步建议：${feedback.adjustment}`,
      feedback,
      toolResults,
      schedulerEventId: schedulerEvent.id,
    }
  }
  return {
    reply: `已记录这次进展反馈。当前判断：${feedback.result}；下一步：${feedback.adjustment}`,
    feedback,
    toolResults,
    schedulerEventId: schedulerEvent.id,
  }
}
