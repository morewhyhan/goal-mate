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
const email = process.env.GOAL_MATE_QQ_REPLY_EMAIL || `qq-reply-${runId}@goalmate.local`
const scriptDir = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDir, '..', '..')
const results = []

function record(id, purpose, ok, evidence = '') {
  results.push({ id, purpose, ok, evidence })
}

function maskEmail(value) {
  return value.replace(/^(.{3}).+@/, '$1...@')
}

async function cleanupUser() {
  await prisma.user.deleteMany({ where: { email } })
}

async function seedWorkspace() {
  const user = await prisma.user.create({
    data: {
      email,
      name: 'QQ Scheduler Reply User',
      emailVerified: true,
    },
  })
  const goal = await prisma.goal.create({
    data: {
      userId: user.id,
      title: '验证 QQ 主动提醒回复闭环',
      rawInput: '验证主动提醒后，用户通过 QQ 回复会进入 Check-in、Logs、Review 和调度事件状态。',
      interpretedGoal: '证明 QQ Scheduler reply loop 可以真实写入系统状态。',
      status: 'ACTIVE',
      isCurrentFocus: true,
      horizonStart: new Date(),
      horizonEnd: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  })
  const condition = await prisma.goalCondition.create({
    data: {
      userId: user.id,
      goalId: goal.id,
      title: '用户回复能进入控制闭环',
      type: 'HARD',
      status: 'MISSING',
      whyRequired: '主动提醒如果不能写入反馈，系统无法调整下一步。',
    },
  })
  const keyResult = await prisma.keyResult.create({
    data: {
      userId: user.id,
      goalId: goal.id,
      title: 'QQ 回复产生结构化反馈证据',
      metricType: 'BOOLEAN',
      currentValue: 'false',
      targetValue: 'true',
      progress: 0,
      whyNecessary: '这是证明主动推进链路存在的最低结果。',
    },
  })
  const stage = await prisma.stagePlan.create({
    data: {
      userId: user.id,
      goalId: goal.id,
      title: '本地回复闭环验收',
      stageGoal: '让一次 evening review 回复完整进入系统状态。',
      startDate: new Date(),
      endDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
      linkedConditionIds: [condition.id],
      successSignals: ['SchedulerEvent responded', 'Checkin exists', 'Daily review exists'],
      status: 'ACTIVE',
      sortOrder: 0,
    },
  })
  const action = await prisma.dailyAction.create({
    data: {
      userId: user.id,
      goalId: goal.id,
      stagePlanId: stage.id,
      conditionId: condition.id,
      actionDate: new Date(),
      title: '回复一次晚上复盘提醒',
      reason: '验证 QQ 主动提醒回复闭环。',
      doneWhen: '用户回复被记录为 Check-in，并生成日志和复盘。',
      minimumStep: '回复“没完成，太难了”。',
      estimatedMinutes: 2,
      fallbackAction: '只回复没完成原因。',
      checkinQuestion: '今天这一步完成了吗？如果没完成，原因是什么？',
      status: 'PLANNED',
    },
  })
  const thread = await prisma.agentThread.create({
    data: {
      userId: user.id,
      goalId: goal.id,
      title: 'QQ evening review c2c fake-openid',
    },
  })
  const schedulerMessage = await prisma.agentMessage.create({
    data: {
      userId: user.id,
      threadId: thread.id,
      role: 'ASSISTANT',
      content: '今晚复盘：今天这一步完成了吗？如果没完成，原因是什么？',
      structuredOutputType: 'qq_scheduler_send',
      structuredOutput: { eventType: 'evening_review' },
    },
  })
  const schedulerEvent = await prisma.schedulerEvent.create({
    data: {
      userId: user.id,
      eventType: 'evening_review',
      channel: 'qq',
      dueKey: `verify-evening-${runId}`,
      scheduledFor: new Date(),
      status: 'sent',
      messageText: schedulerMessage.content,
      sentAt: new Date(),
      agentThreadId: thread.id,
      agentMessageId: schedulerMessage.id,
      externalMessageId: `verify-message-${runId}`,
      payload: { verification: true },
    },
  })
  const userMessage = await prisma.agentMessage.create({
    data: {
      userId: user.id,
      threadId: thread.id,
      role: 'USER',
      content: '没完成，太难了，今天时间也不够。',
    },
  })

  return { user, goal, condition, keyResult, stage, action, thread, schedulerEvent, userMessage }
}

async function run() {
  await cleanupUser()
  const seeded = await seedWorkspace()
  record('QSR-SEED', 'test workspace has a current goal, action, QQ thread and sent evening scheduler event', Boolean(seeded.user.id && seeded.action.id && seeded.schedulerEvent.id), `user=${maskEmail(email)}; action=${seeded.action.id}; event=${seeded.schedulerEvent.id}`)

  const result = await processQqSchedulerReply(prisma, {
    userId: seeded.user.id,
    thread: seeded.thread,
    userMessage: seeded.userMessage,
    context: {
      contextType: 'c2c',
      contextId: `verify-openid-${runId}`,
      messageId: `verify-reply-${runId}`,
      text: '没完成，太难了，今天时间也不够。',
    },
    executeAgentTool: (context, toolName, input) => executeAgentToolWithPrisma(prisma, context, toolName, input),
  })

  record(
    'QSR-PROCESS-REPLY',
    'scheduler reply processor classifies QQ reply and returns a user-facing acknowledgement',
    Boolean(result?.reply && result.feedback?.result === 'NOT_DONE' && result.feedback?.reasonCategory === 'ABILITY'),
    `reply=${String(result?.reply || '').slice(0, 80)}; result=${result?.feedback?.result}; reason=${result?.feedback?.reasonCategory}`,
  )

  const [eventAfter, checkins, diagnoses, dailyDocs, reviews, toolActions, actionAfter, conditionAfter, keyResultAfter, metaDocs] = await Promise.all([
    prisma.schedulerEvent.findUnique({ where: { id: seeded.schedulerEvent.id } }),
    prisma.checkin.findMany({ where: { userId: seeded.user.id } }),
    prisma.diagnosis.findMany({ where: { userId: seeded.user.id } }),
    prisma.markdownDocument.findMany({ where: { userId: seeded.user.id, type: 'DAY' } }),
    prisma.review.findMany({ where: { userId: seeded.user.id, type: 'DAILY' } }),
    prisma.agentToolAction.findMany({ where: { userId: seeded.user.id, source: 'scheduler' }, orderBy: { createdAt: 'asc' } }),
    prisma.dailyAction.findUnique({ where: { id: seeded.action.id } }),
    prisma.goalCondition.findUnique({ where: { id: seeded.condition.id } }),
    prisma.keyResult.findUnique({ where: { id: seeded.keyResult.id } }),
    prisma.markdownDocument.findMany({ where: { userId: seeded.user.id, type: 'SYSTEM', path: { contains: `system/meta-cognition/${seeded.goal.id}` } } }),
  ])

  record(
    'QSR-EVENT-RESPONDED',
    'SchedulerEvent is marked responded and stores reply feedback payload',
    Boolean(eventAfter?.status === 'responded' && eventAfter?.payload?.reply?.feedback?.result === 'NOT_DONE'),
    `status=${eventAfter?.status}; feedback=${eventAfter?.payload?.reply?.feedback?.result || 'missing'}`,
  )
  record(
    'QSR-CHECKIN-DIAGNOSIS',
    'QQ reply creates Check-in and diagnosis through shared Agent tools',
    Boolean(checkins.length >= 1 && checkins[0].result === 'NOT_DONE' && diagnoses.length >= 1 && diagnoses[0].category === 'ABILITY'),
    `checkins=${checkins.length}; result=${checkins[0]?.result}; diagnoses=${diagnoses.length}; category=${diagnoses[0]?.category}`,
  )
  record(
    'QSR-LOG-REVIEW',
    'evening review reply writes daily Markdown evidence and daily Review',
    Boolean(dailyDocs.some((item) => item.content.includes('晚上复盘反馈') && item.content.includes('太难')) && reviews.length >= 1),
    `dailyDocs=${dailyDocs.length}; reviews=${reviews.length}`,
  )
  const metaHypotheses = metaDocs.flatMap((document) => Array.isArray(document.frontmatter?.hypotheses) ? document.frontmatter.hypotheses : [])
  const latestMeta = metaHypotheses[0] || {}
  record(
    'QSR-META-COGNITION',
    'evening review reply writes meta-cognition that can affect the next intervention and AI thinking rule',
    Boolean(
      metaDocs.some((document) => document.content.includes('Meta-Cognition') && document.content.includes('Review 会把该判断交给下一次 Intervention Planner 使用'))
        && latestMeta.policy_delta
        && latestMeta.ai_self_reflection?.next_thinking_rule
        && latestMeta.verification_signal,
    ),
    `metaDocs=${metaDocs.length}; hypotheses=${metaHypotheses.length}; nextThinking=${latestMeta.ai_self_reflection?.next_thinking_rule ? 'yes' : 'no'}; policyDelta=${latestMeta.policy_delta ? 'yes' : 'no'}`,
  )
  record(
    'QSR-AUDIT',
    'scheduler reply records AgentToolAction audit for checkin, log and review',
    ['checkin.submit', 'log.write_daily', 'review.generate'].every((name) => toolActions.some((action) => action.toolName === name && action.status !== 'failed')),
    `actions=${toolActions.map((action) => `${action.toolName}:${action.status}`).join(', ')}`,
  )
  record(
    'QSR-STATE-UPDATE',
    'feedback affects goal execution state instead of only appending chat history',
    Boolean(actionAfter?.status === 'NOT_DONE' && conditionAfter && keyResultAfter && typeof keyResultAfter.progress === 'number'),
    `action=${actionAfter?.status}; condition=${conditionAfter?.status}; krProgress=${keyResultAfter?.progress}`,
  )
}

function toMarkdown() {
  return [
    '# Goal Mate QQ Scheduler Reply Loop Verification',
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
  record('QSR-RUNTIME', 'QQ scheduler reply verifier completes without crashing', false, error instanceof Error ? error.message : String(error))
} finally {
  if (!keepData) {
    try {
      await cleanupUser()
      record('QSR-CLEANUP', 'temporary QQ scheduler reply user and data are removed', true, 'cleanup completed')
    } catch (error) {
      record('QSR-CLEANUP', 'temporary QQ scheduler reply user and data are removed', false, error instanceof Error ? error.message : String(error))
    }
  }
  await prisma.$disconnect()
}

const markdown = toMarkdown()
console.log(markdown)
if (shouldWrite) {
  writeFileSync(resolve(projectRoot, 'docs/plans/qq-scheduler-reply-loop-last-run.md'), markdown)
}

if (results.some((result) => !result.ok)) {
  process.exitCode = 1
}
