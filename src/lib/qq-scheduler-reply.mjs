import { formatAgentToolDatePath } from './agent-tool-shared.mjs'
import {
  isLikelyQqSchedulerFeedback,
  renderQqSchedulerFeedback,
} from './qq-message-renderer.mjs'

const DAY_MS = 24 * 60 * 60 * 1000

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function formatReminderType(type) {
  if (type === 'morning_planning') return '早晨规划'
  if (type === 'midday_check') return '中午检查'
  if (type === 'evening_review') return '晚上复盘'
  if (type === 'weekly_review') return '周复盘'
  return type
}

export function buildSecretarySchedulerReply(feedback, options = {}) {
  // User-facing renderer contract: 先不催执行；internal diagnosis labels stay in persistence only.
  return renderQqSchedulerFeedback(feedback, options)
}

export function classifyQqSchedulerReply(text) {
  const content = String(text || '').trim()
  const lower = content.toLowerCase()
  const done = /(完成|做完|已做|搞定|done|finished|ok了|好了)/i.test(content)
  const noResponse = /(未回复|不回了|不回|沉默|no[_ -]?response)/i.test(content)
  const notDone = /(^0$|^不$|没做|没做到|没完成|未完成|没推进|没开始|还没|失败|做不了|不想做|不想弄|不想搞|不搞|不弄|不干|不继续|不知道|没想过|没想好|太难|太忙|没空|没时间|没有时间|没工夫|忘了|来不及|拖延|下次吧|明天再说|先放着|放着吧|算了|取消|停止|暂停|停了|放弃|别烦|烦|躺)/i.test(content)
  const partial = /(做了一点|一部分|部分|还差|进行中|started|partial|搜|打开了|看了|写了|喝了一口|健康|学习|工作|(^|\s)在($|\s)|^1\s*在$|^1$|到$|继续|嗯|行$|好吧|好$|是$)/i.test(content)

  let result = 'PARTIAL'
  if (done && !notDone) result = 'DONE'
  if (notDone) result = 'NOT_DONE'
  if (partial && !notDone) result = 'PARTIAL'
  if (noResponse) result = 'NO_RESPONSE'
  if (!done && !notDone && !partial && !noResponse) result = lower.length <= 6 ? 'NO_RESPONSE' : 'PARTIAL'

  let reasonCategory = 'UNKNOWN'
  if (/(^0$|^不$|不想|没意义|不重要|没动力|不值得|抗拒|不搞|不弄|不干|不继续|算了|取消|停止|暂停|停了|放弃|别烦|烦|躺|明天再说|先放着|放着吧)/i.test(content)) reasonCategory = 'MOTIVATION'
  if (/(没做到|还没|下次吧|太难|太忙|没空|没时间|没有时间|没工夫|不会|不知道怎么|不知道从哪|想不出来|做不了|累|困|没精力|时间不够|来不及|麻烦|费劲)/i.test(content)) reasonCategory = 'ABILITY'
  if (/(忘|没提醒|时间不对|没看到|错过)/i.test(content)) reasonCategory = 'PROMPT'
  if (/(方向|路径|计划不对|不是关键|不知道为什么做|不知道|没想过|没想好)/i.test(content)) reasonCategory = 'PATH'

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

async function buildSchedulerDailyLogContent(prisma, userId, schedulerEvent, feedback, logDate = new Date(), now = new Date()) {
  const dateInfo = formatAgentToolDatePath(logDate)
  const existing = await prisma.markdownDocument.findUnique({ where: { userId_path: { userId, path: dateInfo.path } } })
  const section = [
    `## ${formatReminderType(schedulerEvent.eventType)}反馈`,
    '',
    `- 时间：${now.toISOString()}`,
    `- 用户回复：${feedback.userFeedback}`,
    `- 系统判断：${feedback.result}`,
    `- 原因分类：${feedback.reasonCategory}`,
    `- 调整建议：${feedback.adjustment}`,
  ].join('\n')

  return existing?.content ? `${existing.content}\n\n${section}` : `# ${dateInfo.title}\n\n${section}`
}

export async function processQqSchedulerReply(prisma, options) {
  const { userId, thread, userMessage, context, executeAgentTool } = options
  const now = options.now || new Date()
  const logDate = options.logDate || now
  const schedulerEvent = options.schedulerEvent || await findRecentQqSchedulerEvent(prisma, userId, now)
  if (!schedulerEvent) return null
  if (!isLikelyQqSchedulerFeedback(context.text, schedulerEvent, context)) return null

  const feedback = classifyQqSchedulerReply(context.text)
  const toolResults = []
  let nextCommitment = null
  let reminderAdjustment = null
  const schedulerPayload = asRecord(schedulerEvent.payload)
  const contactContext = asRecord(schedulerPayload.contact_context)
  const interventionDecision = asRecord(schedulerPayload.intervention_decision)
  const targetActionId = schedulerPayload.actionId
    || schedulerPayload.dailyActionId
    || schedulerPayload.targetActionId
    || contactContext.currentActionId
    || interventionDecision.target_action_id
    || ''
  const targetGoalId = schedulerPayload.goalId
    || schedulerPayload.targetGoalId
    || contactContext.goalId
    || interventionDecision.target_goal_id
    || ''

  if (schedulerEvent.eventType !== 'morning_planning' && schedulerEvent.eventType !== 'weekly_review') {
    const checkinExecution = await executeAgentTool(
      { userId, source: 'scheduler', confirmed: true, agentThreadId: thread.id, agentMessageId: userMessage.id },
      'checkin.submit',
      {
        ...(targetActionId ? { actionId: targetActionId } : {}),
        result: feedback.result.toLowerCase(),
        reasonCategory: feedback.reasonCategory,
        userFeedback: feedback.userFeedback,
        adjustment: feedback.adjustment,
      },
    )
    nextCommitment = checkinExecution?.result?.nextCommitment || null
    reminderAdjustment = checkinExecution?.result?.reminderAdjustment || null
    toolResults.push({ toolName: 'checkin.submit', execution: checkinExecution })
  }

  const logContent = await buildSchedulerDailyLogContent(prisma, userId, schedulerEvent, feedback, logDate, now)
  const logExecution = await executeAgentTool(
    { userId, source: 'scheduler', confirmed: true, agentThreadId: thread.id, agentMessageId: userMessage.id },
    'log.write_daily',
    {
      title: formatAgentToolDatePath(logDate).title,
      date: logDate.toISOString(),
      content: logContent,
      linkedGoalIds: targetGoalId ? [targetGoalId] : [],
      linkedActionIds: targetActionId ? [targetActionId] : [],
    },
  )
  toolResults.push({ toolName: 'log.write_daily', execution: logExecution })

  if (schedulerEvent.eventType === 'weekly_review') {
    const reviewExecution = await executeAgentTool(
      { userId, source: 'scheduler', confirmed: true, agentThreadId: thread.id, agentMessageId: userMessage.id },
      'review.generate',
      {
        type: 'weekly',
        periodStart: new Date(logDate.getTime() - 6 * DAY_MS).toISOString(),
        periodEnd: logDate.toISOString(),
        nextFocus: feedback.adjustment,
      },
    )
    toolResults.push({ toolName: 'review.generate', execution: reviewExecution })
  }

  if (schedulerEvent.eventType === 'evening_review') {
    const reviewExecution = await executeAgentTool(
      { userId, source: 'scheduler', confirmed: true, agentThreadId: thread.id, agentMessageId: userMessage.id },
      'review.generate',
      {
        type: 'daily',
        periodStart: logDate.toISOString(),
        periodEnd: logDate.toISOString(),
        nextFocus: feedback.adjustment,
      },
    )
    toolResults.push({ toolName: 'review.generate', execution: reviewExecution })
  }

  await prisma.schedulerEvent.update({
    where: { id: schedulerEvent.id },
    data: {
      status: 'responded',
      payload: {
        ...schedulerPayload,
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
      reply: renderQqSchedulerFeedback(feedback, { writeFailed: true }),
      feedback,
      toolResults,
      schedulerEventId: schedulerEvent.id,
    }
  }

  return {
    reply: renderQqSchedulerFeedback(feedback, { nextCommitment, reminderAdjustment }),
    feedback,
    toolResults,
    schedulerEventId: schedulerEvent.id,
  }
}
