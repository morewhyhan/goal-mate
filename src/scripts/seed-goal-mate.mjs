import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const seedEmail = process.env.GOAL_MATE_SEED_EMAIL || 'demo@goalmate.local'
const seedName = process.env.GOAL_MATE_SEED_NAME || 'Goal Mate Demo'

function nowAt(date) {
  return new Date(`${date}T08:30:00.000+08:00`)
}

async function main() {
  const user = await prisma.user.upsert({
    where: { email: seedEmail },
    update: { name: seedName },
    create: {
      email: seedEmail,
      name: seedName,
      emailVerified: true,
    },
  })

  await prisma.externalActionRequest.deleteMany({ where: { userId: user.id } })
  await prisma.qqMessageEvent.deleteMany({ where: { userId: user.id } })
  await prisma.qqChatBinding.deleteMany({ where: { userId: user.id } })
  await prisma.telegramUpdateEvent.deleteMany({ where: { userId: user.id } })
  await prisma.telegramChatBinding.deleteMany({ where: { userId: user.id } })
  await prisma.integrationAccount.deleteMany({ where: { userId: user.id } })
  await prisma.userSetting.deleteMany({ where: { userId: user.id } })
  await prisma.modelConfig.deleteMany({ where: { userId: user.id } })
  await prisma.markdownDocumentLink.deleteMany({ where: { userId: user.id } })
  await prisma.markdownDocument.deleteMany({ where: { userId: user.id } })
  await prisma.agentMessage.deleteMany({ where: { userId: user.id } })
  await prisma.agentThread.deleteMany({ where: { userId: user.id } })
  await prisma.review.deleteMany({ where: { userId: user.id } })
  await prisma.diagnosis.deleteMany({ where: { userId: user.id } })
  await prisma.checkin.deleteMany({ where: { userId: user.id } })
  await prisma.dailyAction.deleteMany({ where: { userId: user.id } })
  await prisma.stagePlan.deleteMany({ where: { userId: user.id } })
  await prisma.goalCondition.deleteMany({ where: { userId: user.id } })
  await prisma.keyResult.deleteMany({ where: { userId: user.id } })
  await prisma.goalReasoningCard.deleteMany({ where: { userId: user.id } })
  await prisma.logEntry.deleteMany({ where: { userId: user.id } })
  await prisma.goal.deleteMany({ where: { userId: user.id } })

  await prisma.userSetting.create({
    data: {
      userId: user.id,
      general: { locale: 'zh-CN', timezone: 'Asia/Shanghai', week_start: 'monday' },
      goals: { max_active_goals: 1, review_cadence: 'weekly' },
      logs: {
        vault_root: 'logs/',
        naming_pattern: 'YYYY/Q#/YYYY-MM/W##/YYYY-MM-DD.md',
        auto_write_checkin: true,
        auto_write_review: true,
        preserve_user_edits: true,
      },
      today: { generate_time: '08:30', low_energy_mode: true, heatmap_scope: 'year' },
      agent: {
        can_read_goals: true,
        can_read_logs: true,
        memory_enabled: true,
        require_confirm_goal_changes: true,
        require_confirm_setting_changes: true,
      },
      notifications: {
        morning_checkin_time: '08:30',
        evening_review_time: '21:30',
        quiet_hours: '23:00-07:30',
        channel: 'web',
        max_daily_prompts: 2,
      },
      dataPrivacy: { redact_secrets: true, export_markdown: true, local_first_mode: false },
    },
  })

  await prisma.modelConfig.create({
    data: {
      userId: user.id,
      provider: 'B.AI',
      model: process.env.GOAL_MATE_MODEL || 'gpt-5-nano',
      reasoningModel: process.env.GOAL_MATE_REASONING_MODEL || '',
      apiBase: process.env.GOAL_MATE_MODEL_API_BASE || 'https://api.b.ai',
      apiKeyRef: '',
      usage: 'CHAT',
      isDefault: true,
      temperature: 0.3,
    },
  })

  const goal = await prisma.goal.create({
    data: {
      userId: user.id,
      title: '长期目标推进系统',
      rawInput: '在一个较长周期内，把一个重要结果拆成可证明的 KR、必要条件、阶段计划和每日行动，并通过反馈持续校正。',
      interpretedGoal: '让长期目标从愿望变成可执行、可反馈、可验证、可迭代的推进系统。',
      horizonStart: nowAt('2026-01-01'),
      horizonEnd: nowAt('2026-12-31'),
      status: 'ACTIVE',
      isCurrentFocus: true,
    },
  })

  const conditions = await Promise.all([
    prisma.goalCondition.create({ data: { userId: user.id, goalId: goal.id, title: '结果指标可被验证', type: 'HARD', status: 'PARTIAL', whyRequired: '长期目标必须能被真实证据验证。' } }),
    prisma.goalCondition.create({ data: { userId: user.id, goalId: goal.id, title: '每日核心行动窗口稳定', type: 'HARD', status: 'MISSING', whyRequired: '核心行动窗口用于验证目标是否能稳定推进。' } }),
    prisma.goalCondition.create({ data: { userId: user.id, goalId: goal.id, title: '反馈能反向调整计划', type: 'ASSUMED', status: 'PARTIAL', whyRequired: '反馈必须能改变下一步，而不是只留下记录。' } }),
    prisma.goalCondition.create({ data: { userId: user.id, goalId: goal.id, title: '输出证据持续沉淀', type: 'HARD', status: 'MISSING', whyRequired: '长期推进必须留下可复盘、可验证的证据。' } }),
    prisma.goalCondition.create({ data: { userId: user.id, goalId: goal.id, title: '关键资产持续形成可见增量', type: 'SUPPORTING', status: 'PARTIAL', whyRequired: '目标推进需要沉淀成可复用资产。' } }),
  ])

  await Promise.all([
    prisma.keyResult.create({ data: { userId: user.id, goalId: goal.id, title: '核心结果达到可验证标准', metricType: 'PERCENT', currentValue: '18%', targetValue: '100%', progress: 0.18, whyNecessary: '长期目标必须能被结果证明。' } }),
    prisma.keyResult.create({ data: { userId: user.id, goalId: goal.id, title: '关键能力通过阶段验收', metricType: 'PERCENT', currentValue: '24%', targetValue: '100%', progress: 0.24, whyNecessary: '结果背后必须有可复用能力支撑。' } }),
    prisma.keyResult.create({ data: { userId: user.id, goalId: goal.id, title: '稳定输出形成外部反馈', metricType: 'COUNT', currentValue: '9', targetValue: '52', progress: 0.17, whyNecessary: '长期推进需要持续输出和外部反馈。' } }),
    prisma.keyResult.create({ data: { userId: user.id, goalId: goal.id, title: '项目资产达到可演示或可复用状态', metricType: 'TEXT', currentValue: '核心框架已收敛', targetValue: '可演示 / 可复用', progress: 0.34, whyNecessary: '长期目标需要沉淀成真实资产。' } }),
  ])

  const stagePlans = []
  const stageDefinitions = [
    {
      title: 'Q1：确认方向',
      stageGoal: '确认目标、验收标准、关键结果和最小可执行闭环。',
      startDate: '2026-01-01',
      endDate: '2026-03-31',
      linkedConditionIds: [conditions[0].id, conditions[1].id, conditions[2].id],
      successSignals: ['目标可被验证', '每日行动可以稳定发生'],
      status: 'COMPLETED',
    },
    {
      title: 'Q2：搭建系统',
      stageGoal: '把关键条件拆成周计划和日行动，并建立反馈记录。',
      startDate: '2026-04-01',
      endDate: '2026-06-30',
      linkedConditionIds: [conditions[0].id, conditions[1].id, conditions[2].id],
      successSignals: ['周计划能落到日行动', '反馈能反向调整路径'],
      status: 'COMPLETED',
    },
    {
      title: 'Q3：稳定推进',
      stageGoal: '稳定执行关键行动，持续收集证据并修正失控风险。',
      startDate: '2026-07-01',
      endDate: '2026-09-30',
      linkedConditionIds: [conditions[3].id, conditions[4].id],
      successSignals: ['核心行动持续发生', '关键风险能提前干预'],
      status: 'ACTIVE',
    },
    {
      title: 'Q4：验收沉淀',
      stageGoal: '完成最终验收、复盘有效策略，并沉淀下一周期可复用资产。',
      startDate: '2026-10-01',
      endDate: '2026-12-31',
      linkedConditionIds: conditions.map((condition) => condition.id),
      successSignals: ['KR 有证据支撑', '形成下一周期可复用策略'],
      status: 'DRAFT',
    },
  ]
  for (const [index, stage] of stageDefinitions.entries()) {
    stagePlans.push(await prisma.stagePlan.create({
      data: {
        userId: user.id,
        goalId: goal.id,
        title: stage.title,
        stageGoal: stage.stageGoal,
        startDate: nowAt(stage.startDate),
        endDate: nowAt(stage.endDate),
        linkedConditionIds: stage.linkedConditionIds,
        successSignals: stage.successSignals,
        status: stage.status,
        sortOrder: index + 1,
      },
    }))
  }
  const firstStage = stagePlans[2]

  const card = await prisma.goalReasoningCard.create({
    data: {
      userId: user.id,
      goalId: goal.id,
      version: 1,
      purposeSummary: '建立目标、行动、反馈和复盘的稳定推进闭环。',
      successSignals: ['核心结果改善', '关键能力推进', '持续输出', '形成可演示增量'],
      sufficientConditionSet: '关键结果、核心行动、反馈记录和复盘调整同时稳定发生，则主目标大概率推进。',
      currentGapConditionId: conditions[1].id,
      recommendedFocus: '先验证每日核心行动是否能稳定发生。',
      confidenceScore: 0.72,
      evidence: ['用户明确了 8 周推进周期', '用户给出了结果、能力、输出、项目四类推进线索'],
      status: 'CONFIRMED',
    },
  })

  await prisma.goal.update({ where: { id: goal.id }, data: { currentReasoningCardId: card.id } })

  const actionDefinitions = [
    { date: '2026-04-03', stage: stagePlans[1], condition: conditions[1], title: '确认本周唯一主行动', doneWhen: '把本周目标压缩成一个今天能完成的主行动。', minimumStep: '只写一句今天要推进什么。', fallbackAction: '只确认下一次开始时间。', status: 'DONE', estimatedMinutes: 30 },
    { date: '2026-05-12', stage: stagePlans[1], condition: conditions[2], title: '记录一次执行反馈', doneWhen: '记录完成情况、阻塞原因和下一次调整。', minimumStep: '只写完成 / 部分 / 没做。', fallbackAction: '只回答为什么没做。', status: 'PARTIAL', estimatedMinutes: 20 },
    { date: '2026-07-03', stage: stagePlans[2], condition: conditions[1], title: '完成今天的核心推进动作', doneWhen: '完成当前阶段最关键的一步，并记录结果。', minimumStep: '先做 10 分钟最低成本版本。', fallbackAction: '状态差时只执行预设替代动作。', status: 'PLANNED', estimatedMinutes: 60 },
    { date: '2026-07-04', stage: stagePlans[2], condition: conditions[0], title: '检查当前路径是否仍然有效', doneWhen: '确认目标方向、难度和提醒是否仍然匹配当前状态。', minimumStep: '只判断方向、难度、提醒三者哪一个最有问题。', fallbackAction: '只把问题发给 Agent。', status: 'PLANNED', estimatedMinutes: 30 },
    { date: '2026-07-10', stage: stagePlans[2], condition: conditions[3], title: '产出一个可复用结果片段', doneWhen: '完成一个可以沉淀到日志、文档或项目资产里的结果片段。', minimumStep: '先写一个标题和三条要点。', fallbackAction: '只保存一个待处理问题。', status: 'PLANNED', estimatedMinutes: 90 },
    { date: '2026-07-17', stage: stagePlans[2], condition: conditions[4], title: '补齐一个关键缺口', doneWhen: '针对当前缺口完成一次可见修正。', minimumStep: '只定位缺口，不要求完成修正。', fallbackAction: '只把缺口写入日志。', status: 'PLANNED', estimatedMinutes: 90 },
    { date: '2026-08-07', stage: stagePlans[2], condition: conditions[3], title: '生成一次阶段复盘', doneWhen: '总结本阶段哪些干预有效，哪些假设需要调整。', minimumStep: '只列一条有效和一条无效。', fallbackAction: '只让 Agent 生成复盘草稿。', status: 'PLANNED', estimatedMinutes: 45 },
    { date: '2026-10-12', stage: stagePlans[3], condition: conditions[4], title: '整理最终验收材料', doneWhen: '把关键结果、证据和下一周期策略整理成可复用材料。', minimumStep: '先列出 5 个验收证据。', fallbackAction: '只整理一个证据。', status: 'PLANNED', estimatedMinutes: 90 },
  ]
  await Promise.all(actionDefinitions.map((action) => prisma.dailyAction.create({
    data: {
      userId: user.id,
      goalId: goal.id,
      stagePlanId: action.stage.id,
      conditionId: action.condition.id,
      actionDate: nowAt(action.date),
      title: action.title,
      reason: '这一步用于补齐当前阶段最关键的推进条件。',
      doneWhen: action.doneWhen,
      minimumStep: action.minimumStep,
      estimatedMinutes: action.estimatedMinutes,
      fallbackAction: action.fallbackAction,
      checkinQuestion: '今天完成后告诉我：完成、部分完成、没做，以及主要原因。',
      status: action.status,
    },
  })))

  const dailyMarkdown = `# 2026-07-03\n\n## 今日主目标\n\n- 目标：长期目标推进系统\n- 当前关键条件：每日核心行动窗口稳定\n\n## 今日行动\n\n- 行动：完成今天的核心推进动作\n- 完成标准：完成当前阶段最关键的一步，并记录结果\n\n## 自由记录\n\n今天重点是验证这个节奏能否真实发生。\n`
  const dailyLogPath = 'logs/2026/Q3/2026-07/W27/2026-07-03.md'

  await prisma.logEntry.create({
    data: {
      userId: user.id,
      periodType: 'DAY',
      title: '2026-07-03.md',
      path: dailyLogPath,
      linkedGoalIds: [goal.id],
      linkedActionIds: [],
      content: dailyMarkdown,
    },
  })

  await prisma.markdownDocument.create({
    data: {
      userId: user.id,
      type: 'DAY',
      title: '2026-07-03.md',
      path: dailyLogPath,
      content: dailyMarkdown,
      frontmatter: {
        period: 'day',
        date: '2026-07-03',
        goalTitle: goal.title,
      },
      linkedGoalIds: [goal.id],
      linkedActionIds: [],
      source: 'SEED',
    },
  })

  const thread = await prisma.agentThread.create({ data: { userId: user.id, goalId: goal.id, title: '长期目标推进' } })
  await prisma.agentMessage.create({ data: { userId: user.id, threadId: thread.id, role: 'ASSISTANT', content: '我已经读取当前主目标、KR 和最近日志。今天最重要的是验证稳定节奏能不能发生。' } })
  await prisma.agentMessage.create({ data: { userId: user.id, threadId: thread.id, role: 'USER', content: '如果今天没有完成核心推进动作，应该怎么调整？' } })
  await prisma.agentMessage.create({ data: { userId: user.id, threadId: thread.id, role: 'ASSISTANT', content: '我会先判断是动作太大、提醒不合适，还是目标吸引力不足。如果只是能力问题，明天把动作缩小到最低成本版本。' } })

  console.log(`Seeded Goal Mate demo data for ${user.email}`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
