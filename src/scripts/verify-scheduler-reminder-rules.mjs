import { writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PrismaClient } from '@prisma/client'
import { closeSchedulerWorker, tick } from './scheduler-worker.mjs'
import { resolveQqBotConfig, saveQqBotConfig } from '../lib/qq-bot-config.mjs'

const prisma = new PrismaClient()
const shouldWrite = process.argv.includes('--write')
const keepData = process.argv.includes('--keep-data')
const runId = Date.now()
const email = process.env.GOAL_MATE_SCHEDULER_RULES_EMAIL || `scheduler-rules-${runId}@goalmate.local`
const disabledEmail = `scheduler-disabled-${runId}@goalmate.local`
const scriptDir = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDir, '..', '..')
const timezone = 'Asia/Shanghai'
const now = new Date()
const results = []
let fakeQq = null

function record(id, purpose, ok, evidence = '') {
  results.push({ id, purpose, ok, evidence })
}

function maskEmail(value) {
  return value.replace(/^(.{3}).+@/, '$1...@')
}

async function startFakeQqServer() {
  const tokenRequests = []
  const messages = []
  const server = createServer((req, res) => {
    let raw = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      raw += chunk
    })
    req.on('end', () => {
      let body = null
      try {
        body = raw ? JSON.parse(raw) : null
      } catch {
        body = { raw }
      }

      if (req.method === 'POST' && req.url === '/app/getAppAccessToken') {
        tokenRequests.push({ body })
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ access_token: `fake-qq-access-${runId}`, expires_in: 7200 }))
        return
      }

      if (req.method === 'POST' && /\/v2\/users\/[^/]+\/messages/.test(String(req.url || ''))) {
        messages.push({ url: req.url, body })
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ id: `fake-qq-message-${messages.length}`, message_id: `fake-qq-message-${messages.length}` }))
        return
      }

      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'not_found', url: req.url }))
    })
  })

  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return {
    tokenRequests,
    messages,
    apiBase: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolveClose) => server.close(resolveClose)),
  }
}

function localParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)
  return Object.fromEntries(parts.map((part) => [part.type, part.value]))
}

function formatMinute(totalMinutes) {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440
  const hour = Math.floor(normalized / 60)
  const minute = normalized % 60
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function quietRangeAround(parts) {
  const current = Number(parts.hour) * 60 + Number(parts.minute)
  return `${formatMinute(current - 1)}-${formatMinute(current + 1)}`
}

function currentSchedule(parts) {
  return `${parts.hour}:${parts.minute}`
}

function currentWeeklySchedule(parts) {
  return `${String(parts.weekday || '').slice(0, 3).toUpperCase()} ${currentSchedule(parts)}`
}

async function cleanupUser() {
  await prisma.user.deleteMany({ where: { email: { in: [email, disabledEmail] } } })
}

async function createRule(userId, input) {
  return prisma.reminderRule.create({
    data: {
      userId,
      reminderType: input.reminderType,
      channel: 'qq',
      schedule: input.schedule,
      timezone,
      maxPerDay: input.maxPerDay ?? 1,
      quietHours: { range: input.quietHours || '23:00-07:30' },
      enabled: input.enabled ?? true,
      metadata: { source: 'verify_scheduler_rules' },
    },
  })
}

async function seedUser() {
  const user = await prisma.user.create({
    data: {
      email,
      name: 'Scheduler Rules User',
      emailVerified: true,
    },
  })
  await saveQqBotConfig(prisma, user.id, {
    appId: `verify-app-${runId}`,
    token: `verify-token-${runId}`,
    apiBase: fakeQq?.apiBase || 'https://api.sgroup.qq.com',
    enabled: true,
  })
  return user
}

async function seedGoalActionAndBinding(user) {
  const horizonEnd = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)
  const goal = await prisma.goal.create({
    data: {
      userId: user.id,
      title: `验证主动推进目标 ${runId}`,
      rawInput: '验证 Scheduler 主动消息能指向今天行动。',
      interpretedGoal: '让主动提醒成为可反馈的行动推进，而不是固定闹钟。',
      horizonStart: now,
      horizonEnd,
      status: 'ACTIVE',
      isCurrentFocus: true,
    },
  })
  const condition = await prisma.goalCondition.create({
    data: {
      userId: user.id,
      goalId: goal.id,
      title: `补齐主动提醒内容闭环 ${runId}`,
      type: 'HARD',
      status: 'PARTIAL',
      whyRequired: '如果主动提醒不指向当前行动，用户收到消息也不知道下一步做什么。',
    },
  })
  const stage = await prisma.stagePlan.create({
    data: {
      userId: user.id,
      goalId: goal.id,
      title: `主动提醒验收阶段 ${runId}`,
      stageGoal: '证明 Scheduler 发送内容包含当前行动、最小启动和可验证反馈。',
      startDate: now,
      endDate: horizonEnd,
      linkedConditionIds: [condition.id],
      successSignals: ['fake QQ 收到消息', 'SchedulerEvent 记录 planner_source'],
      status: 'ACTIVE',
      sortOrder: 1,
    },
  })
  const action = await prisma.dailyAction.create({
    data: {
      userId: user.id,
      goalId: goal.id,
      stagePlanId: stage.id,
      conditionId: condition.id,
      actionDate: now,
      title: `完成主动提醒内容验收 ${runId}`,
      reason: '证明主动提醒能让用户一眼知道现在要做什么。',
      doneWhen: `fake QQ 收到包含行动标题和 Planner 决策的消息。`,
      minimumStep: '只捕获一次 Scheduler 发送请求。',
      fallbackAction: `如果状态差，只回复完成/没完成 ${runId}`,
      checkinQuestion: '这条提醒是否让你知道下一步？',
      status: 'PLANNED',
    },
  })
  const binding = await prisma.qqChatBinding.create({
    data: {
      userId: user.id,
      contextType: 'c2c',
      contextId: `fake-c2c-${runId}`,
      username: `fake-user-${runId}`,
      nickname: 'Fake QQ User',
      status: 'ENABLED',
    },
  })
  await prisma.qqMessageEvent.create({
    data: {
      userId: user.id,
      eventId: `fake-qq-source-${runId}`,
      eventType: 'C2C_MESSAGE_CREATE',
      contextType: binding.contextType,
      contextId: binding.contextId,
      messageText: '上一条 QQ 消息，用于主动回复上下文。',
      payload: { id: `fake-source-message-${runId}` },
      status: 'received',
    },
  })
  return { goal, condition, stage, action, binding }
}

async function seedDisabledQqUser() {
  const user = await prisma.user.create({
    data: {
      email: disabledEmail,
      name: 'Disabled Scheduler QQ User',
      emailVerified: true,
    },
  })
  await saveQqBotConfig(prisma, user.id, {
    appId: `disabled-app-${runId}`,
    token: `disabled-token-${runId}`,
    apiBase: 'https://api.sgroup.qq.com',
    enabled: false,
  })
  return user
}

async function countEvents(userId, eventType) {
  return prisma.schedulerEvent.count({ where: { userId, eventType } })
}

async function latestEvent(userId, eventType) {
  return prisma.schedulerEvent.findFirst({
    where: { userId, eventType },
    orderBy: { createdAt: 'desc' },
  })
}

async function run() {
  await cleanupUser()
  fakeQq = await startFakeQqServer()
  const user = await seedUser()
  const disabledUser = await seedDisabledQqUser()
  const parts = localParts(now, timezone)
  const [ownQqConfig, disabledQqConfig, globalQqConfig] = await Promise.all([
    resolveQqBotConfig(prisma, user.id),
    resolveQqBotConfig(prisma, disabledUser.id),
    resolveQqBotConfig(prisma),
  ])

  const morningRule = await createRule(user.id, {
    reminderType: 'morning_planning',
    schedule: '08:30',
    enabled: true,
  })
  const disabledRule = await createRule(user.id, {
    reminderType: 'midday_check',
    schedule: '12:30',
    enabled: false,
  })

  record(
    'SRR-SEED',
    'test user has QQ config and user-owned reminder rules without relying on env defaults',
    Boolean(user.id && disabledUser.id && morningRule.id && disabledRule.id),
    `user=${maskEmail(email)}; disabledUser=${maskEmail(disabledEmail)}; morning=${morningRule.id}; disabled=${disabledRule.id}`,
  )
  record(
    'SRR-QQ-CONFIG-ISOLATION',
    'QQ config resolution is user-scoped and global resolution ignores newer disabled accounts',
    Boolean(
      ownQqConfig.configured
        && ownQqConfig.userId === user.id
        && ownQqConfig.appId === `verify-app-${runId}`
        && !disabledQqConfig.configured
        && disabledQqConfig.disabledBySettings
        && globalQqConfig.configured
        && globalQqConfig.userId === user.id,
    ),
    `own=${ownQqConfig.source}/${ownQqConfig.appId}; disabledConfigured=${disabledQqConfig.configured}; globalUser=${globalQqConfig.userId === user.id ? 'enabled-user' : 'other'}`,
  )

  await tick({ forceReminderType: 'morning_planning', now })
  const morningEvent = await latestEvent(user.id, 'morning_planning')
  record(
    'SRR-ENABLED-FORCED-DUE',
    'enabled user reminder rule is consumed by Scheduler even when another user has a newer disabled QQ config',
    Boolean(
      morningEvent?.status === 'failed'
        && morningEvent?.reminderRuleId === morningRule.id
        && morningEvent?.payload?.schedule === '08:30'
        && morningEvent?.errorMessage === 'No enabled QQ binding.',
    ),
    `status=${morningEvent?.status}; rule=${morningEvent?.reminderRuleId}; schedule=${morningEvent?.payload?.schedule}; error=${morningEvent?.errorMessage}`,
  )

  record(
    'SRR-DISABLED-NOT-CONSUMED',
    'disabled reminder rule is not consumed even when another rule is forced',
    await countEvents(user.id, 'midday_check') === 0,
    `middayEvents=${await countEvents(user.id, 'midday_check')}`,
  )

  const maxRule = await createRule(user.id, {
    reminderType: 'evening_review',
    schedule: currentSchedule(parts),
    enabled: true,
    maxPerDay: 1,
  })
  await prisma.schedulerEvent.create({
    data: {
      userId: user.id,
      reminderRuleId: maxRule.id,
      eventType: 'evening_review',
      channel: 'qq',
      dueKey: `existing-evening-${runId}`,
      scheduledFor: now,
      status: 'sent',
      sentAt: now,
      messageText: 'existing sent event',
      payload: { verification: true },
    },
  })
  await tick({ now })
  record(
    'SRR-MAX-PER-DAY',
    'Scheduler respects maxPerDay and does not create another event after today already has a sent event',
    await countEvents(user.id, 'evening_review') === 1,
    `eveningEvents=${await countEvents(user.id, 'evening_review')}; maxPerDay=${maxRule.maxPerDay}`,
  )

  const quietRule = await createRule(user.id, {
    reminderType: 'weekly_review',
    schedule: currentWeeklySchedule(parts),
    enabled: true,
    quietHours: quietRangeAround(parts),
  })
  await tick({ now })
  record(
    'SRR-QUIET-HOURS',
    'Scheduler respects quietHours and skips a due rule inside the quiet window',
    await countEvents(user.id, 'weekly_review') === 0,
    `weeklyEvents=${await countEvents(user.id, 'weekly_review')}; schedule=${quietRule.schedule}; quiet=${quietRule.quietHours?.range}`,
  )

  const seeded = await seedGoalActionAndBinding(user)
  const contentRule = await createRule(user.id, {
    reminderType: 'midday_check',
    schedule: '12:30',
    enabled: true,
    maxPerDay: 1,
  })
  await tick({ forceReminderType: 'midday_check', now: new Date(now.getTime() + 3000) })
  const sentEvent = await latestEvent(user.id, 'midday_check')
  const assistantMessage = sentEvent?.agentMessageId
    ? await prisma.agentMessage.findUnique({ where: { id: sentEvent.agentMessageId } })
    : null
  const audit = await prisma.agentToolAction.findFirst({
    where: { userId: user.id, toolName: 'reminder.send', targetId: contentRule.id },
    orderBy: { createdAt: 'desc' },
  })
  const sentContent = String(sentEvent?.messageText || '')
  const decision = sentEvent?.payload?.intervention_decision || {}
  const captured = fakeQq.messages[0]

  record(
    'SRR-FAKE-QQ-SENT',
    'Scheduler can use the user-configured QQ API base to get token and send a bound QQ message',
    Boolean(
      sentEvent?.status === 'sent'
        && fakeQq.tokenRequests.length === 1
        && fakeQq.messages.length === 1
        && captured?.url?.includes(seeded.binding.contextId)
        && captured?.body?.content === sentEvent.messageText
        && captured?.body?.msg_id === `fake-source-message-${runId}`,
    ),
    `status=${sentEvent?.status}; tokenCalls=${fakeQq.tokenRequests.length}; sends=${fakeQq.messages.length}; url=${captured?.url || 'missing'}`,
  )

  record(
    'SRR-PLANNER-MESSAGE-CONTENT',
    'sent Scheduler message points to today action, fallback action and an auditable intervention decision instead of a blank fixed reminder',
    Boolean(
      sentContent.includes(seeded.action.title)
        && sentContent.includes(seeded.action.fallbackAction)
        && decision.target_goal_id === seeded.goal.id
        && decision.target_condition_id === seeded.condition.id
        && decision.question_or_message
        && decision.risk_point
        && decision.verification_signal,
    ),
    `planner=${decision.planner_source}; type=${decision.intervention_type}; message=${sentContent.replace(/\s+/g, ' ').slice(0, 180)}`,
  )

  record(
    'SRR-SCHEDULER-AUDIT',
    'Scheduler sent reminder is persisted as AgentMessage and AgentToolAction with planner_source for later review',
    Boolean(
      assistantMessage?.structuredOutputType === 'scheduler_reminder'
        && assistantMessage.content === sentEvent?.messageText
        && assistantMessage.structuredOutput?.planner_source === decision.planner_source
        && audit?.status === 'executed'
        && audit?.result?.intervention_decision?.verification_signal,
    ),
    `assistant=${assistantMessage?.id || 'missing'}; audit=${audit?.status || 'missing'}; planner=${assistantMessage?.structuredOutput?.planner_source || 'missing'}`,
  )
}

function toMarkdown() {
  return [
    '# Goal Mate Scheduler Reminder Rules Verification',
    '',
    `- Time: ${new Date().toISOString()}`,
    `- Test user: ${maskEmail(email)}`,
    `- Test data kept: ${keepData ? 'yes' : 'no'}`,
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
  record('SRR-RUNTIME', 'scheduler reminder rules verifier completes without crashing', false, error instanceof Error ? error.message : String(error))
} finally {
  if (!keepData) {
    try {
      await cleanupUser()
      record('SRR-CLEANUP', 'temporary scheduler rules user and data are removed', true, 'cleanup completed')
    } catch (error) {
      record('SRR-CLEANUP', 'temporary scheduler rules user and data are removed', false, error instanceof Error ? error.message : String(error))
    }
  }
  if (fakeQq) {
    try {
      await fakeQq.close()
    } catch {
      // ignore fake server close errors
    }
  }
  await prisma.$disconnect()
  await closeSchedulerWorker()
}

const markdown = toMarkdown()
console.log(markdown)
if (shouldWrite) {
  writeFileSync(resolve(projectRoot, 'docs/plans/scheduler-reminder-rules-last-run.md'), markdown)
}

if (results.some((result) => !result.ok)) {
  process.exitCode = 1
}
