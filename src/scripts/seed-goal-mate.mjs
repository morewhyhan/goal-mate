import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

function nowAt(date) {
  return new Date(`${date}T08:30:00.000+08:00`)
}

async function main() {
  const user = await prisma.user.upsert({
    where: { email: 'demo@goalmate.local' },
    update: { name: 'Goal Mate Demo' },
    create: {
      email: 'demo@goalmate.local',
      name: 'Goal Mate Demo',
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
      provider: 'DeepSeek',
      model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
      reasoningModel: 'deepseek-reasoner',
      apiBase: process.env.DEEPSEEK_API_BASE || 'https://api.deepseek.com',
      apiKeyRef: 'env:DEEPSEEK_API_KEY',
      usage: 'CHAT',
      isDefault: true,
      temperature: 0.3,
    },
  })

  const goal = await prisma.goal.create({
    data: {
      userId: user.id,
      title: '2026 暑假主目标推进',
      rawInput: '7 月 1 日到 9 月 1 日，体重从 165 斤到 130 斤，学完新概念英语二，日更 3000 字，推进软件杯和 Goal Mate。',
      interpretedGoal: '用两个月建立身体、英语、内容和项目四条主线的稳定推进闭环。',
      horizonStart: nowAt('2026-07-01'),
      horizonEnd: nowAt('2026-09-01'),
      status: 'ACTIVE',
      isCurrentFocus: true,
    },
  })

  const conditions = await Promise.all([
    prisma.goalCondition.create({ data: { userId: user.id, goalId: goal.id, title: '简单饮食可持续', type: 'HARD', status: 'PARTIAL', whyRequired: '饮食是减重目标的主要约束条件。' } }),
    prisma.goalCondition.create({ data: { userId: user.id, goalId: goal.id, title: '每天两小时走路窗口稳定', type: 'HARD', status: 'MISSING', whyRequired: '走路同时服务身体管理和英语输入，是当前最关键节奏。' } }),
    prisma.goalCondition.create({ data: { userId: user.id, goalId: goal.id, title: '英语输入和走路绑定', type: 'ASSUMED', status: 'PARTIAL', whyRequired: '把背单词绑定到走路可以降低额外启动成本。' } }),
    prisma.goalCondition.create({ data: { userId: user.id, goalId: goal.id, title: '每日 3000 字输出能沉淀到公开渠道', type: 'HARD', status: 'MISSING', whyRequired: '内容目标必须形成稳定公开输出。' } }),
    prisma.goalCondition.create({ data: { userId: user.id, goalId: goal.id, title: '项目每天至少推进一个可见增量', type: 'SUPPORTING', status: 'PARTIAL', whyRequired: '项目目标需要代码和文档的可见增量。' } }),
  ])

  await Promise.all([
    prisma.keyResult.create({ data: { userId: user.id, goalId: goal.id, title: '体重从 165 斤降到接近 130 斤', metricType: 'WEIGHT', currentValue: '165', targetValue: '130', progress: 0.18, whyNecessary: '身体管理目标需要可验证结果。' } }),
    prisma.keyResult.create({ data: { userId: user.id, goalId: goal.id, title: '新概念英语二完成默写并达到熟练', metricType: 'PERCENT', currentValue: '12%', targetValue: '100%', progress: 0.12, whyNecessary: '英语目标需要可检验熟练度。' } }),
    prisma.keyResult.create({ data: { userId: user.id, goalId: goal.id, title: '形成稳定日更 3000 字内容输出', metricType: 'COUNT', currentValue: '0', targetValue: '62', progress: 0.22, whyNecessary: '内容影响力需要稳定输出证明。' } }),
    prisma.keyResult.create({ data: { userId: user.id, goalId: goal.id, title: '软件杯和 Goal Mate 项目产出可演示结果', metricType: 'TEXT', currentValue: 'PRD 和框架收敛中', targetValue: '可演示版本', progress: 0.34, whyNecessary: '项目目标需要可展示成果。' } }),
  ])

  const firstStage = await prisma.stagePlan.create({
    data: {
      userId: user.id,
      goalId: goal.id,
      title: '第 1 周',
      stageGoal: '建立最小稳定节奏',
      startDate: nowAt('2026-07-01'),
      endDate: nowAt('2026-07-07'),
      linkedConditionIds: [conditions[1].id, conditions[2].id],
      successSignals: ['连续 5 天完成最低行动', '每天有日志反馈'],
      status: 'ACTIVE',
      sortOrder: 1,
    },
  })

  const card = await prisma.goalReasoningCard.create({
    data: {
      userId: user.id,
      goalId: goal.id,
      version: 1,
      purposeSummary: '暑假两个月内建立身体、英语、内容和项目的稳定推进闭环。',
      successSignals: ['体重趋势下降', '新概念英语二默写推进', '每日内容输出', '项目有可演示增量'],
      sufficientConditionSet: '饮食控制、走路窗口、英语绑定、内容输出和项目增量同时稳定发生，则暑假主目标大概率推进。',
      currentGapConditionId: conditions[1].id,
      recommendedFocus: '先验证每天两小时走路并背单词的稳定窗口。',
      confidenceScore: 0.72,
      evidence: ['用户明确了 2026-07-01 到 2026-09-01 的周期', '用户给出了体重、英语、内容、项目四条主线'],
      status: 'CONFIRMED',
    },
  })

  await prisma.goal.update({ where: { id: goal.id }, data: { currentReasoningCardId: card.id } })

  await prisma.dailyAction.create({
    data: {
      userId: user.id,
      goalId: goal.id,
      stagePlanId: firstStage.id,
      conditionId: conditions[1].id,
      actionDate: nowAt('2026-07-01'),
      title: '走路 2 小时，并同步背单词',
      reason: '这一步同时补齐身体管理和英语输入的稳定窗口。',
      doneWhen: '完成 120 分钟步行，并记录今天背过的单词范围。',
      minimumStep: '先出门走 10 分钟，同时打开单词音频。',
      estimatedMinutes: 120,
      fallbackAction: '如果状态差，只走 20 分钟并背 10 个词。',
      checkinQuestion: '今天完成后告诉我：完成、部分完成、没做，以及主要原因。',
      status: 'PLANNED',
    },
  })

  const dailyMarkdown = `# 2026-07-01\n\n## 今日主目标\n\n- 目标：2026 暑假主目标推进\n- 当前关键条件：每天两小时走路窗口稳定\n\n## 今日行动\n\n- 行动：走路 2 小时，并同步背单词\n- 完成标准：完成 120 分钟步行，并记录今天背过的单词范围\n\n## 自由记录\n\n今天重点是验证这个节奏能否真实发生。\n`
  const dailyLogPath = 'logs/2026/Q3/2026-07/W27/2026-07-01.md'

  await prisma.logEntry.create({
    data: {
      userId: user.id,
      periodType: 'DAY',
      title: '2026-07-01.md',
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
      title: '2026-07-01.md',
      path: dailyLogPath,
      content: dailyMarkdown,
      frontmatter: {
        period: 'day',
        date: '2026-07-01',
        goalTitle: goal.title,
      },
      linkedGoalIds: [goal.id],
      linkedActionIds: [],
      source: 'SEED',
    },
  })

  const thread = await prisma.agentThread.create({ data: { userId: user.id, goalId: goal.id, title: '暑假主目标拆解' } })
  await prisma.agentMessage.create({ data: { userId: user.id, threadId: thread.id, role: 'ASSISTANT', content: '我已经读取当前主目标、KR 和最近日志。今天最重要的是验证稳定节奏能不能发生。' } })
  await prisma.agentMessage.create({ data: { userId: user.id, threadId: thread.id, role: 'USER', content: '如果今天没有完成两小时走路，应该怎么调整？' } })
  await prisma.agentMessage.create({ data: { userId: user.id, threadId: thread.id, role: 'ASSISTANT', content: '我会先判断是动作太大、提醒不合适，还是目标吸引力不足。如果只是能力问题，明天把动作缩小到 20 分钟。' } })

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
