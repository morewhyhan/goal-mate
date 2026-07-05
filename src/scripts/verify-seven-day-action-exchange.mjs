import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PrismaClient } from '@prisma/client'
import { executeAgentToolWithPrisma } from '../lib/agent-tool-executor.mjs'
import { processQqSchedulerReply } from '../lib/qq-scheduler-reply.mjs'

const prisma = new PrismaClient()
const shouldWrite = process.argv.includes('--write')
const keepData = process.argv.includes('--keep-data')
const runId = Date.now()
const email = process.env.GOAL_MATE_SEVEN_DAY_EMAIL || `seven-day-exchange-${runId}@goalmate.local`
const scriptDir = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDir, '..', '..')
const results = []
const DAY_MS = 24 * 60 * 60 * 1000
const baseDate = new Date(2026, 6, 6, 8, 0, 0)

const dayPlans = [
  {
    day: 1,
    reply: '没做，太难',
    expectedReason: 'ABILITY',
    action: '打开目标文档，只写一句拖了最久的原因',
    doneWhen: '写出一句真实原因就算完成',
    minimumStep: '打开文档 30 秒',
    fallbackAction: '只回“太难”两个字',
    nextCommitment: '明天 09:10，只打开文档 2 分钟，写一句“下一步卡在哪里”。做到一句就停。',
    userModel: '用户不是没有目标，而是初始动作太大，启动成本高于行动收益。',
    agentStrategy: '下一次先把动作压到 2 分钟以内，再看是否能启动。',
  },
  {
    day: 2,
    reply: '没做，忘了',
    expectedReason: 'PROMPT',
    action: '上午打开文档 2 分钟，写一句卡点',
    doneWhen: '留下一个卡点句子',
    minimumStep: '看一眼文档标题',
    fallbackAction: '只在 QQ 回复“忘了”',
    nextCommitment: '明天 08:40，在开始刷手机前先发一次提示；你只需要打开文档并复制昨天那句卡点。',
    userModel: '用户愿意反馈，但风险点发生在上午开始分心之前。',
    agentStrategy: '提示要前置到风险点前，不等晚上失败后补救。',
  },
  {
    day: 3,
    reply: '没做，不想做',
    expectedReason: 'MOTIVATION',
    action: '风险点前打开文档，复制昨天卡点',
    doneWhen: '文档里出现昨天卡点的复制记录',
    minimumStep: '复制一句话',
    fallbackAction: '只回复“不想做”',
    nextCommitment: '明天先不推执行。20:30 只回答一个问题：这个目标还值得继续 7 天吗？',
    userModel: '用户出现目标真实性风险，不适合继续硬推任务。',
    agentStrategy: '先审目标真实性，再安排动作；不把“不想做”误判成懒。',
  },
  {
    day: 4,
    reply: '没做，路径不对',
    expectedReason: 'PATH',
    action: '只回答这个目标还值不值得继续',
    doneWhen: '明确继续、暂停或重定义其中一个选择',
    minimumStep: '回复一个词：继续/暂停/重定义',
    fallbackAction: '只回复“路径不对”',
    nextCommitment: '明天 10:00，不做完整任务，只确认当前这一步到底补哪个缺口。写出一个缺口就算完成。',
    userModel: '用户不是单纯不行动，而是当前动作和目标缺口没有对齐。',
    agentStrategy: '下一次先校准路径，再安排行动；避免忙错方向。',
  },
  {
    day: 5,
    reply: '做了一点，写了缺口',
    expectedReason: 'UNKNOWN',
    action: '写出当前目标最关键缺口',
    doneWhen: '写出一个缺口，并能解释为什么它影响目标推进',
    minimumStep: '写“缺口：”三个字',
    fallbackAction: '只写一个关键词',
    nextCommitment: '明天 09:30，只围绕这个缺口做 5 分钟；产出一条可验证痕迹，不要求完整完成。',
    userModel: '用户在路径对齐后可以产生部分行动，适合逐步增加可验证输出。',
    agentStrategy: '保留小动作，不立即加码；用证据确认这个路径是否有效。',
  },
  {
    day: 6,
    reply: '做了，5分钟',
    expectedReason: 'UNKNOWN',
    action: '围绕关键缺口做 5 分钟并留下痕迹',
    doneWhen: '产生一条可指向目标缺口的痕迹',
    minimumStep: '打开文件并停留 1 分钟',
    fallbackAction: '截图或写一句当前状态',
    nextCommitment: '明天 09:30，重复 5 分钟，不加码；只看它能不能连续发生。',
    userModel: '用户可以在低负载承诺下完成行动，不能因一次完成就提高仓位。',
    agentStrategy: '继续验证稳定性，不把一次完成当成稳定规律。',
  },
  {
    day: 7,
    reply: '做了，愿意99继续',
    expectedReason: 'UNKNOWN',
    action: '重复 5 分钟可验证行动',
    doneWhen: '留下第二条可验证行动痕迹',
    minimumStep: '打开昨天的痕迹',
    fallbackAction: '只回复今天是否还愿意继续',
    nextCommitment: '下一阶段保持 5 分钟承诺三天；如果继续完成，再把单次行动提高到 8 分钟。',
    userModel: '用户感知到决策成本下降，并出现愿意尝试 99 元/月的信号。',
    agentStrategy: '商业验证进入下一阶段：继续证明付费后仍能产生行动增量。',
  },
]

function record(id, purpose, ok, evidence = '') {
  results.push({ id, purpose, ok, evidence })
}

function maskEmail(value) {
  return value.replace(/^(.{3}).+@/, '$1...@')
}

function compact(value, max = 220) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max)}...` : text
}

function pad(value) {
  return String(value).padStart(2, '0')
}

function addDays(date, days) {
  return new Date(date.getTime() + days * DAY_MS)
}

function dateForDay(day, hour = 21, minute = 30) {
  const date = addDays(baseDate, day - 1)
  date.setHours(hour, minute, 0, 0)
  return date
}

function getWeekNumber(date) {
  const copied = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = copied.getUTCDay() || 7
  copied.setUTCDate(copied.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(copied.getUTCFullYear(), 0, 1))
  return Math.ceil((((copied.getTime() - yearStart.getTime()) / DAY_MS) + 1) / 7)
}

function dateParts(date) {
  const year = date.getFullYear()
  const month = `${year}-${pad(date.getMonth() + 1)}`
  const quarter = `Q${Math.floor(date.getMonth() / 3) + 1}`
  const week = `W${pad(getWeekNumber(date))}`
  const day = `${year}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  return {
    title: `${day} 日志`,
    path: `logs/${year}/${quarter}/${month}/${week}/${day}.md`,
  }
}

function countQuestions(text) {
  return (String(text || '').match(/[？?]/g) || []).length
}

function auditAssistantExchange(reply) {
  const text = String(reply || '')
  const issues = []
  if (!text.trim()) issues.push('empty')
  if (text.length > 140) issues.push('too_long')
  if (countQuestions(text) > 1) issues.push('too_many_questions')
  if (/加油|坚持|相信自己|继续努力|你必须|自律太差|原因分类|能力不足|动机不足/u.test(text)) issues.push('bad_tone')
  if (!/(明天|下一次|今天|只|先|缩|提前|暂停|重定义|缺口|证据|不加码|保留|风险点)/u.test(text)) issues.push('no_exchange_value')
  return { ok: issues.length === 0, issues, sample: compact(text, 180) }
}

function classifyActionEvidence(text) {
  if (/做了|完成|写了|5分钟|痕迹|缺口/u.test(text) && !/没做/u.test(text)) return true
  return /做了一点/u.test(text)
}

function buildDailyLogContent(plan, feedback, assistantReply, stats) {
  const date = dateForDay(plan.day)
  const dateInfo = dateParts(date)
  const resultLabel = feedback.result
  const paymentBlock = plan.day === 7 ? [
    '',
    '## 7 天商业验证摘要',
    '',
    `- 连续回复：${stats.replyDays}/7`,
    `- 可验证行动：${stats.evidenceDays}/7`,
    `- 决策成本降低信号：${stats.decisionCostSignal ? '有' : '无'}`,
    `- 99 元/月意愿信号：${stats.paymentSignal ? '有' : '无'}`,
    `- 判断：${stats.replyDays >= 7 && stats.evidenceDays >= 3 && stats.decisionCostSignal && stats.paymentSignal ? '达到模拟付费意愿最低条件' : '未达到最低条件'}`,
    '- 边界：这是本地模拟商业验证，不等于真实付费。',
  ] : []

  return [
    `# ${dateInfo.title}`,
    '',
    '## 今日事实',
    '',
    `- 计划行动：${plan.action}`,
    `- 用户低摩擦回复：${plan.reply}`,
    `- Agent 回应：${assistantReply}`,
    '',
    '## 多目标进展',
    '',
    '- v0.1 商业验证只看一个主目标，避免用多目标复杂度掩盖行动交换是否成立。',
    '',
    '## 未完成事项',
    '',
    resultLabel === 'DONE' ? '- 今日承诺已发生。' : `- 原计划未完整发生：${plan.reply}`,
    '',
    '## 偏差与失控点',
    '',
    `- 风险类型：${feedback.reasonCategory}`,
    `- 反馈质量：${plan.reply.length <= 14 ? '低摩擦，可继续使用' : '信息较长，需要压缩入口'}`,
    '',
    '## 未完成原因诊断',
    '',
    `- 诊断：${feedback.adjustment}`,
    `- 证据：用户回复“${plan.reply}”。`,
    '',
    '## 风险控制策略',
    '',
    `- 风险类型：${feedback.reasonCategory}`,
    `- 控制动作：${plan.agentStrategy}`,
    '- 后续验证信号：明天是否愿意继续回复，以及是否留下可验证行动痕迹。',
    '',
    '## 明日计划调整',
    '',
    `- 下一承诺：${plan.nextCommitment}`,
    `- 做什么：${plan.action}`,
    `- 什么时候做：${plan.nextCommitment.match(/\d{2}:\d{2}/u)?.[0] || '下一阶段固定时间'}`,
    `- 完成标准：${plan.doneWhen}`,
    `- 为什么更容易发生：${plan.minimumStep}；失败时 ${plan.fallbackAction}。`,
    '',
    '## 用户模型更新',
    '',
    `- ${plan.userModel}`,
    '',
    '## Agent 策略更新',
    '',
    `- ${plan.agentStrategy}`,
    ...paymentBlock,
    '',
  ].join('\n')
}

async function cleanupUser() {
  await prisma.user.deleteMany({ where: { email } })
}

async function seedWorkspace() {
  const user = await prisma.user.create({
    data: {
      email,
      name: 'Seven Day Action Exchange User',
      emailVerified: true,
    },
  })
  await prisma.userSetting.create({
    data: {
      userId: user.id,
      general: { timezone: 'Asia/Shanghai' },
      goals: { review_cadence: 'weekly', current_goal_limit: 1 },
      logs: { auto_write_checkin: true, auto_write_review: true, vault_root: 'logs' },
      today: { show_only_next_action: true, heatmap_scope: 'week' },
      agent: { can_read_goals: true, can_read_logs: true, memory_enabled: true, require_confirm_goal_changes: true, require_confirm_setting_changes: true },
      notifications: { morning: '08:30', midday: '12:30', evening: '21:30', channel: 'qq', max_daily_prompts: 3 },
      dataPrivacy: { export_markdown: true },
    },
  })
  await prisma.qqChatBinding.create({
    data: {
      userId: user.id,
      contextType: 'c2c',
      contextId: `seven-day-openid-${runId}`,
      nickname: 'seven-day-user',
      status: 'ENABLED',
      permissions: undefined,
    },
  }).catch(async () => null)
  const goal = await prisma.goal.create({
    data: {
      userId: user.id,
      title: '7 天内把一个长期拖延目标推起来',
      rawInput: '我有一个拖了很久的重要目标，希望 AI 每天用很轻的方式推动我，最后让我真的开始行动。',
      interpretedGoal: '通过 7 天低摩擦行动交换，让用户从长期拖延进入连续可验证行动。',
      status: 'ACTIVE',
      isCurrentFocus: true,
      horizonStart: baseDate,
      horizonEnd: addDays(baseDate, 6),
    },
  })
  const keyResults = await Promise.all([
    prisma.keyResult.create({ data: { userId: user.id, goalId: goal.id, title: '7 天连续回复 Agent', metricType: 'COUNT', currentValue: '0', targetValue: '7', progress: 0, whyNecessary: '持续回复是行动交换系统成立的最低前提。' } }),
    prisma.keyResult.create({ data: { userId: user.id, goalId: goal.id, title: '至少 3 天产生可验证行动', metricType: 'COUNT', currentValue: '0', targetValue: '3', progress: 0, whyNecessary: '用户付费买的是推进结果，不是聊天。' } }),
    prisma.keyResult.create({ data: { userId: user.id, goalId: goal.id, title: '出现 99 元/月继续使用意愿', metricType: 'BOOLEAN', currentValue: 'false', targetValue: 'true', progress: 0, whyNecessary: '这是第一阶段商业验证的价格信号。' } }),
  ])
  const condition = await prisma.goalCondition.create({
    data: {
      userId: user.id,
      goalId: goal.id,
      title: '每次回复都换来更低行动成本的下一步',
      type: 'HARD',
      status: 'MISSING',
      whyRequired: '如果用户回复后没有获得交换价值，持续回复和付费都不成立。',
    },
  })
  const stage = await prisma.stagePlan.create({
    data: {
      userId: user.id,
      goalId: goal.id,
      title: '7 天目标推进实验',
      stageGoal: '证明一个强惰性用户能通过低摩擦回复持续被推进行动。',
      startDate: baseDate,
      endDate: addDays(baseDate, 6),
      linkedConditionIds: [condition.id],
      successSignals: ['7 天连续回复', '至少 3 天有可验证行动', '出现 99 元/月意愿信号'],
      status: 'ACTIVE',
      sortOrder: 0,
    },
  })
  const thread = await prisma.agentThread.create({
    data: {
      userId: user.id,
      goalId: goal.id,
      title: '7 天行动交换验证 QQ 会话',
    },
  })
  for (const type of ['morning_planning', 'midday_check', 'evening_review']) {
    await prisma.reminderRule.create({
      data: {
        userId: user.id,
        goalId: goal.id,
        reminderType: type,
        channel: 'qq',
        schedule: type === 'morning_planning' ? '08:30' : type === 'midday_check' ? '12:30' : '21:30',
        maxPerDay: 1,
        enabled: true,
        metadata: { verification: 'seven-day-action-exchange' },
      },
    })
  }
  return { user, goal, keyResults, condition, stage, thread }
}

async function createActionAndSchedulerEvents(seed, plan) {
  const actionDate = dateForDay(plan.day, 8, 30)
  const action = await prisma.dailyAction.create({
    data: {
      userId: seed.user.id,
      goalId: seed.goal.id,
      stagePlanId: seed.stage.id,
      conditionId: seed.condition.id,
      actionDate,
      title: plan.action,
      reason: '7 天行动交换验证：每一天都用低摩擦反馈换更容易执行的下一步。',
      doneWhen: plan.doneWhen,
      minimumStep: plan.minimumStep,
      estimatedMinutes: plan.day <= 2 ? 20 : plan.day <= 4 ? 8 : 5,
      fallbackAction: plan.fallbackAction,
      checkinQuestion: '只回一个短句：做了 / 没做，太难 / 没做，忘了 / 没做，不想做 / 没做，路径不对。',
      status: 'PLANNED',
    },
  })
  for (const eventType of ['morning_planning', 'midday_check', 'evening_review']) {
    const when = eventType === 'morning_planning' ? dateForDay(plan.day, 8, 30) : eventType === 'midday_check' ? dateForDay(plan.day, 12, 30) : dateForDay(plan.day, 21, 30)
    const message = eventType === 'morning_planning'
      ? `今天只做一步：${plan.action}。最低启动：${plan.minimumStep}。`
      : eventType === 'midday_check'
        ? '中午只确认有没有卡住。可直接回：做了 / 太难 / 忘了 / 不想做 / 路径不对。'
        : `晚上复盘，只回短句即可：${plan.doneWhen}。没做也可以直接说原因。`
    const agentMessage = await prisma.agentMessage.create({
      data: {
        userId: seed.user.id,
        threadId: seed.thread.id,
        role: 'ASSISTANT',
        content: message,
        structuredOutputType: 'qq_scheduler_send',
        structuredOutput: { eventType, actionId: action.id, goalId: seed.goal.id },
      },
    })
    await prisma.schedulerEvent.create({
      data: {
        userId: seed.user.id,
        eventType,
        channel: 'qq',
        dueKey: `seven-day-${plan.day}-${eventType}-${runId}`,
        scheduledFor: when,
        status: 'sent',
        messageText: message,
        sentAt: when,
        agentThreadId: seed.thread.id,
        agentMessageId: agentMessage.id,
        externalMessageId: `seven-day-${plan.day}-${eventType}-out-${runId}`,
        payload: { verification: true, actionId: action.id, goalId: seed.goal.id, day: plan.day },
      },
    })
  }
  return action
}

async function writeRichDailyLog(seed, plan, feedback, assistantReply, stats, action) {
  const logDate = dateForDay(plan.day)
  const dateInfo = dateParts(logDate)
  const content = buildDailyLogContent(plan, feedback, assistantReply, stats)
  return executeAgentToolWithPrisma(
    prisma,
    { userId: seed.user.id, source: 'seven_day_action_exchange', confirmed: true, agentThreadId: seed.thread.id },
    'log.write_daily',
    {
      title: dateInfo.title,
      date: logDate.toISOString(),
      content,
      linkedGoalIds: [seed.goal.id],
      linkedActionIds: [action.id],
    },
  )
}

async function runDay(seed, plan, stats) {
  const action = await createActionAndSchedulerEvents(seed, plan)
  const userMessage = await prisma.agentMessage.create({
    data: {
      userId: seed.user.id,
      threadId: seed.thread.id,
      role: 'USER',
      content: plan.reply,
    },
  })
  await prisma.qqMessageEvent.create({
    data: {
      userId: seed.user.id,
      eventId: `seven-day-in-${plan.day}-${runId}`,
      eventType: 'message.received',
      contextType: 'c2c',
      contextId: `seven-day-openid-${runId}`,
      messageText: plan.reply,
      payload: { day: plan.day, verification: true },
      status: 'received',
      agentThreadId: seed.thread.id,
      agentMessageId: userMessage.id,
    },
  })
  const replyResult = await processQqSchedulerReply(prisma, {
    userId: seed.user.id,
    thread: seed.thread,
    userMessage,
    now: dateForDay(plan.day, 21, 40),
    logDate: dateForDay(plan.day, 21, 30),
    context: {
      contextType: 'c2c',
      contextId: `seven-day-openid-${runId}`,
      messageId: `seven-day-message-${plan.day}-${runId}`,
      text: plan.reply,
    },
    executeAgentTool: (context, toolName, input) => executeAgentToolWithPrisma(prisma, context, toolName, input),
  })
  const assistantMessage = await prisma.agentMessage.create({
    data: {
      userId: seed.user.id,
      threadId: seed.thread.id,
      role: 'ASSISTANT',
      content: replyResult?.reply || '记下了。明天只保留一个更小的入口。',
      structuredOutputType: 'seven_day_action_exchange_reply',
      structuredOutput: { feedback: replyResult?.feedback, day: plan.day },
    },
  })
  await prisma.qqMessageEvent.create({
    data: {
      userId: seed.user.id,
      eventId: `seven-day-out-${plan.day}-${runId}`,
      eventType: 'message.sent',
      contextType: 'c2c',
      contextId: `seven-day-openid-${runId}`,
      messageText: assistantMessage.content,
      payload: { day: plan.day, verification: true, feedback: replyResult?.feedback || null },
      status: 'sent',
      agentThreadId: seed.thread.id,
      replyMessageId: assistantMessage.id,
    },
  })
  if (classifyActionEvidence(plan.reply)) stats.evidenceDays += 1
  if (/少想|轻松|愿意|继续|99/u.test(plan.reply)) stats.decisionCostSignal = true
  if (/99|付费|继续/u.test(plan.reply)) stats.paymentSignal = true
  stats.replyDays += 1
  await writeRichDailyLog(seed, plan, replyResult?.feedback || { result: 'UNKNOWN', reasonCategory: 'UNKNOWN', adjustment: '记录反馈，明天继续缩小动作。' }, assistantMessage.content, stats, action)
  return { action, replyResult, assistantMessage }
}

async function updateCommercialKeyResults(seed, stats) {
  await prisma.keyResult.update({ where: { id: seed.keyResults[0].id }, data: { currentValue: String(stats.replyDays), progress: Math.min(1, stats.replyDays / 7), status: stats.replyDays >= 7 ? 'ACHIEVED' : 'ACTIVE' } })
  await prisma.keyResult.update({ where: { id: seed.keyResults[1].id }, data: { currentValue: String(stats.evidenceDays), progress: Math.min(1, stats.evidenceDays / 3), status: stats.evidenceDays >= 3 ? 'ACHIEVED' : 'ACTIVE' } })
  await prisma.keyResult.update({ where: { id: seed.keyResults[2].id }, data: { currentValue: stats.paymentSignal ? 'true' : 'false', progress: stats.paymentSignal ? 1 : 0, status: stats.paymentSignal ? 'ACHIEVED' : 'ACTIVE' } })
}

async function run() {
  await cleanupUser()
  const seed = await seedWorkspace()
  record('SEA-SEED', 'clean workspace has active goal, KR, condition, QQ binding and three reminder rules', Boolean(seed.user.id && seed.goal.id && seed.keyResults.length === 3), `user=${maskEmail(email)}; goal=${seed.goal.title}`)

  const stats = { replyDays: 0, evidenceDays: 0, decisionCostSignal: false, paymentSignal: false }
  const dayResults = []
  for (const plan of dayPlans) {
    dayResults.push({ plan, ...(await runDay(seed, plan, stats)) })
  }
  await updateCommercialKeyResults(seed, stats)

  const [events, respondedEvents, inboundEvents, outboundEvents, checkins, diagnoses, dailyDocs, metaDocs, keyResultsAfter, toolActions] = await Promise.all([
    prisma.schedulerEvent.findMany({ where: { userId: seed.user.id }, orderBy: { scheduledFor: 'asc' } }),
    prisma.schedulerEvent.findMany({ where: { userId: seed.user.id, status: 'responded' } }),
    prisma.qqMessageEvent.findMany({ where: { userId: seed.user.id, eventType: 'message.received' } }),
    prisma.qqMessageEvent.findMany({ where: { userId: seed.user.id, eventType: 'message.sent' } }),
    prisma.checkin.findMany({ where: { userId: seed.user.id }, orderBy: { createdAt: 'asc' } }),
    prisma.diagnosis.findMany({ where: { userId: seed.user.id }, orderBy: { createdAt: 'asc' } }),
    prisma.markdownDocument.findMany({ where: { userId: seed.user.id, type: 'DAY' }, orderBy: { path: 'asc' } }),
    prisma.markdownDocument.findMany({ where: { userId: seed.user.id, type: 'SYSTEM', path: { startsWith: 'system/meta-cognition/' } } }),
    prisma.keyResult.findMany({ where: { userId: seed.user.id, goalId: seed.goal.id }, orderBy: { createdAt: 'asc' } }),
    prisma.agentToolAction.findMany({ where: { userId: seed.user.id }, orderBy: { createdAt: 'asc' } }),
  ])

  const replyAudits = dayResults.map((item) => ({ day: item.plan.day, ...auditAssistantExchange(item.assistantMessage.content) }))
  const reasonSet = new Set(dayResults.map((item) => item.replyResult?.feedback?.reasonCategory).filter(Boolean))
  const lowFrictionReplies = dayPlans.every((plan) => plan.reply.length <= 14)
  const nextCommitmentDocs = dailyDocs.filter((doc) => /下一承诺：/.test(doc.content) && /做什么：/.test(doc.content) && /完成标准：/.test(doc.content) && /为什么更容易发生：/.test(doc.content))
  const completeControlLogs = dailyDocs.filter((doc) => /## 今日事实/.test(doc.content) && /## 未完成原因诊断/.test(doc.content) && /## 风险控制策略/.test(doc.content) && /## 明日计划调整/.test(doc.content) && /## 用户模型更新/.test(doc.content) && /## Agent 策略更新/.test(doc.content))
  const commercialSummary = dailyDocs.find((doc) => /7 天商业验证摘要/.test(doc.content))
  const noExtraLogTypes = dailyDocs.every((doc) => !/行动控制日志|action_control|control-log/u.test(`${doc.path}\n${doc.content}`))
  const paymentReady = stats.replyDays >= 7 && stats.evidenceDays >= 3 && stats.decisionCostSignal && stats.paymentSignal

  record('SEA-SCHEDULER-RHYTHM', 'seven-day run creates morning, midday and evening QQ scheduler events and processes one reply per day', events.length === 21 && respondedEvents.length === 7 && inboundEvents.length === 7 && outboundEvents.length === 7, `events=${events.length}; responded=${respondedEvents.length}; inbound=${inboundEvents.length}; outbound=${outboundEvents.length}`)
  record('SEA-LOW-FRICTION-REPLY', 'user can reply with short low-friction phrases instead of long diary text', lowFrictionReplies && stats.replyDays === 7, `replyDays=${stats.replyDays}; maxReplyLength=${Math.max(...dayPlans.map((plan) => plan.reply.length))}`)
  record('SEA-EXCHANGE-VALUE', 'each assistant response returns a concrete exchange value instead of only asking for check-in', replyAudits.every((audit) => audit.ok), JSON.stringify(replyAudits.map((audit) => ({ day: audit.day, ok: audit.ok, issues: audit.issues, sample: audit.sample }))))
  record('SEA-NEXT-COMMITMENT', 'each day log contains a next commitment with time/action/done-when/easier-reason', nextCommitmentDocs.length === 7, `nextCommitmentDocs=${nextCommitmentDocs.length}`)
  record('SEA-FAILURE-CONTROL', 'seven-day run covers different failure reasons and produces different control strategies', ['ABILITY', 'PROMPT', 'MOTIVATION', 'PATH'].every((item) => reasonSet.has(item)) && diagnoses.length >= 4, `reasons=${Array.from(reasonSet).join(',')}; diagnoses=${diagnoses.length}`)
  record('SEA-PROGRESS-EVIDENCE', 'the run proves progress through check-ins, KR changes and at least three verifiable action days', checkins.length >= 7 && stats.evidenceDays >= 3 && keyResultsAfter.some((kr) => kr.title.includes('至少 3 天') && kr.progress >= 1), `checkins=${checkins.length}; evidenceDays=${stats.evidenceDays}; kr=${keyResultsAfter.map((kr) => `${kr.title}:${kr.progress}`).join('; ')}`)
  record('SEA-NORMAL-LOGS', 'daily evidence is written into normal day logs and does not create a separate action-control log type', dailyDocs.length === 7 && completeControlLogs.length === 7 && noExtraLogTypes, `dailyDocs=${dailyDocs.length}; complete=${completeControlLogs.length}; noExtra=${noExtraLogTypes}`)
  record('SEA-META-COGNITION', 'daily replies create meta-cognition or equivalent Agent strategy evidence for next intervention', metaDocs.length >= 1 && dailyDocs.every((doc) => /Agent 策略更新/.test(doc.content)), `metaDocs=${metaDocs.length}; strategyLogs=${dailyDocs.filter((doc) => /Agent 策略更新/.test(doc.content)).length}`)
  record('SEA-PAYMENT-READINESS', 'simulated seven-day run reaches minimum payment-readiness signal without claiming real payment', paymentReady && Boolean(commercialSummary?.content.includes('本地模拟商业验证，不等于真实付费')), `replyDays=${stats.replyDays}; evidenceDays=${stats.evidenceDays}; decisionCost=${stats.decisionCostSignal}; paymentSignal=${stats.paymentSignal}`)
  record('SEA-AUDIT', 'shared Agent tool audit records scheduler/checkin/log/review actions during the run', ['checkin.submit', 'log.write_daily', 'review.generate'].every((name) => toolActions.some((action) => action.toolName === name && action.status !== 'failed')), `actions=${toolActions.map((action) => `${action.toolName}:${action.status}`).join(', ')}`)
}

function toMarkdown() {
  const passed = results.every((result) => result.ok)
  return [
    '# Seven-day Action Exchange Verification',
    '',
    `- Time: ${new Date().toISOString()}`,
    `- Result: ${passed ? 'PASS' : 'FAIL'}`,
    `- Test user: ${maskEmail(email)}`,
    `- Test data kept: ${keepData ? 'yes' : 'no'}`,
    '- Scope: local deterministic simulation of seven days of QQ-style action exchange, low-friction replies, next commitments, normal day logs, KR evidence and simulated payment-readiness signal.',
    '- Boundary: this does not prove a real user paid, does not operate the real QQ client, and does not prove live model-provider availability.',
    '',
    '| ID | Purpose | Result | Evidence |',
    '| --- | --- | --- | --- |',
    ...results.map((result) => `| ${result.id} | ${result.purpose} | ${result.ok ? 'PASS' : 'FAIL'} | ${String(result.evidence || '').replaceAll('|', '\\|')} |`),
    '',
  ].join('\n')
}

try {
  await run()
} catch (error) {
  record('SEA-RUNTIME', 'seven-day action exchange verifier completes without crashing', false, error instanceof Error ? error.message : String(error))
} finally {
  if (!keepData) {
    try {
      await cleanupUser()
      record('SEA-CLEANUP', 'temporary seven-day action exchange user and data are removed', true, 'cleanup completed')
    } catch (error) {
      record('SEA-CLEANUP', 'temporary seven-day action exchange user and data are removed', false, error instanceof Error ? error.message : String(error))
    }
  }
  await prisma.$disconnect()
}

const markdown = toMarkdown()
console.log(markdown)

if (shouldWrite) {
  writeFileSync(resolve(projectRoot, 'docs/plans/seven-day-action-exchange-last-run.md'), markdown)
}

process.exit(results.every((result) => result.ok) ? 0 : 1)
