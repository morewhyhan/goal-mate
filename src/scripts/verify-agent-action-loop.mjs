import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'node:fs'

const prisma = new PrismaClient()
const baseUrl = process.env.GOAL_MATE_BASE_URL || 'http://127.0.0.1:3000'
const cookie = process.env.GOAL_MATE_COOKIE || ''
const shouldWrite = process.argv.includes('--write')
const shouldWriteReport = process.argv.includes('--write-report') || shouldWrite

const requiredTools = [
  'goal.list',
  'goal.get',
  'goal.create_draft',
  'goal.update',
  'today.get',
  'today.set_next_action',
  'checkin.submit',
  'log.write_daily',
  'review.generate',
  'reminder.schedule',
  'settings.model.get',
  'settings.model.update',
]

const results = []

function record(id, purpose, ok, evidence = '') {
  results.push({ id, purpose, ok, evidence })
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      cookie,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  })
  const text = await response.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  if (!response.ok) {
    throw new Error(`${options.method || 'GET'} ${path} returned ${response.status}: ${text.slice(0, 300)}`)
  }
  return body
}

function noSecretLeak(value) {
  const text = JSON.stringify(value)
  return !/sk-[A-Za-z0-9_-]{12,}/.test(text)
}

function todayText() {
  const date = new Date()
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function readProjectFile(path) {
  return readFileSync(path, 'utf8')
}

function verifySharedRuntimeContracts() {
  const sharedCatalog = readProjectFile('src/lib/agent-tool-shared.mjs')
  const readHandlers = readProjectFile('src/lib/agent-tool-read-handlers.mjs')
  const writeHandlers = readProjectFile('src/lib/agent-tool-write-handlers.mjs')
  const executor = readProjectFile('src/lib/agent-tool-executor.mjs')
  const webRuntime = readProjectFile('src/lib/agent-tools.ts')
  const qqWorker = readProjectFile('src/scripts/qq-bot-worker.mjs')
  const schedulerWorker = readProjectFile('src/scripts/scheduler-worker.mjs')
  const combinedHandlers = `${readHandlers}\n${writeHandlers}`

  record(
    'AAL-SHARED-CATALOG',
    'shared tool catalog contains every P0 tool',
    requiredTools.every((tool) => sharedCatalog.includes(`name: '${tool}'`)),
    `required=${requiredTools.length}`,
  )
  record(
    'AAL-SHARED-HANDLERS',
    'shared read/write handlers cover every P0 tool',
    requiredTools.every((tool) => combinedHandlers.includes(`'${tool}'`)),
    'read and write handler files scanned',
  )
  record(
    'AAL-SHARED-EXECUTOR',
    'shared executor centralizes confirmation, execution and audit writing',
    executor.includes('executeAgentToolWithPrisma') && executor.includes('recordAgentToolActionWithPrisma') && executor.includes('pending_confirmation') && executor.includes('agentToolAction.create'),
    'src/lib/agent-tool-executor.mjs scanned',
  )
  record(
    'AAL-WEB-SHARED-RUNTIME',
    'Web Agent executes through shared executor',
    webRuntime.includes('executeAgentToolWithPrisma') && !webRuntime.includes('agentToolAction.create'),
    'src/lib/agent-tools.ts is a thin adapter',
  )
  record(
    'AAL-QQ-SHARED-RUNTIME',
    'QQ Agent executes through shared executor without duplicated tool branches',
    qqWorker.includes('executeAgentToolWithPrisma') && qqWorker.includes("source: 'scheduler'") && !qqWorker.includes("if (toolName === 'goal.list')") && !qqWorker.includes('async function getCurrentGoal'),
    'src/scripts/qq-bot-worker.mjs is channel adapter and scheduler reply adapter',
  )
  record(
    'AAL-SCHEDULER-SHARED-AUDIT',
    'Scheduler reminder.send audit uses shared audit writer without exposing a user-callable tool',
    schedulerWorker.includes('recordAgentToolActionWithPrisma') && schedulerWorker.includes("toolName: 'reminder.send'") && !sharedCatalog.includes("name: 'reminder.send'"),
    'src/scripts/scheduler-worker.mjs and shared catalog scanned',
  )
}

async function executeTool(toolName, input = {}, confirmed = false) {
  return request('/api/agent/tools/execute', {
    method: 'POST',
    body: JSON.stringify({ toolName, input, confirmed }),
  })
}

async function confirmToolAction(id) {
  return request(`/api/agent/tools/actions/${id}/confirm`, { method: 'POST' })
}

async function run() {
  verifySharedRuntimeContracts()

  assert(cookie, 'GOAL_MATE_COOKIE is required for Agent Action Loop verification')

  const health = await request('/api/health')
  record('AAL-HEALTH', 'API health identifies Goal Mate', health.product === 'goal-mate', `product=${health.product}`)

  const tools = await request('/api/agent/tools')
  const toolNames = tools.data?.map((tool) => tool.name) || []
  record(
    'AAL-TOOLS',
    'Agent exposes complete P0 tool registry',
    requiredTools.every((tool) => toolNames.includes(tool)),
    `tools=${toolNames.join(', ')}`,
  )

  const control = await request('/api/settings/control-center')
  const userId = control.data?.settings?.userId || control.data?.model?.userId
  record(
    'AAL-SETTINGS-CENTER',
    'Settings Control Center returns model, reminders, runtime status, policy and audit surfaces',
    Boolean(control.data?.model && Array.isArray(control.data?.reminderRules) && control.data?.runtimeStatus && control.data?.permissionPolicy && Array.isArray(control.data?.toolActions) && Array.isArray(control.data?.schedulerEvents)),
    `model=${control.data?.model?.model}; reminders=${control.data?.reminderRules?.length || 0}; actions=${control.data?.toolActions?.length || 0}; runtime=${Object.keys(control.data?.runtimeStatus || {}).join(',')}`,
  )
  record(
    'AAL-SETTINGS-SECRETS',
    'Settings Control Center does not leak API secrets',
    noSecretLeak(control),
    'secret scan passed',
  )

  const goalList = await executeTool('goal.list')
  record(
    'AAL-READ-GOAL',
    'read tool goal.list executes without confirmation',
    Boolean(goalList.data?.needsConfirmation === false && Array.isArray(goalList.data?.result)),
    `needsConfirmation=${goalList.data?.needsConfirmation}; count=${goalList.data?.result?.length || 0}`,
  )

  const today = await executeTool('today.get')
  const latestAction = today.data?.result?.actions?.[0]
  record(
    'AAL-READ-TODAY',
    'read tool today.get exposes current next action',
    Boolean(today.data?.needsConfirmation === false && today.data?.result?.goal && Array.isArray(today.data?.result?.actions)),
    latestAction ? latestAction.title : 'no action',
  )

  if (shouldWrite) {
    const pending = await executeTool(
      'today.set_next_action',
      {
        title: `验收动作 ${todayText()}`,
        reason: 'Agent Action Loop 写入型验收。',
        doneWhen: '验证脚本可以看到该行动被创建。',
        minimumStep: '打开系统确认下一步行动存在。',
        estimatedMinutes: 5,
        fallbackAction: '只记录一行验收反馈。',
        checkinQuestion: '这次验收动作是否成功？',
      },
      false,
    )
    record(
      'AAL-EXECUTE-PENDING',
      'execute tool creates pending confirmation before writing business state',
      Boolean(pending.data?.needsConfirmation === true && pending.data?.action?.status === 'pending_confirmation'),
      `action=${pending.data?.action?.id}; status=${pending.data?.action?.status}`,
    )

    const executedAction = await confirmToolAction(pending.data?.action?.id)
    const executedResult = executedAction.data?.execution?.result
    const executedAudit = executedAction.data?.execution?.action
    record(
      'AAL-EXECUTE-CONFIRMED',
      'confirm endpoint writes business data and audit action',
      Boolean(executedAction.data?.confirmed === true && executedAudit?.status === 'executed' && executedResult?.id),
      `toolAction=${executedAudit?.id}; dailyAction=${executedResult?.id}`,
    )

    const checkin = await executeTool(
      'checkin.submit',
      {
        actionId: executedResult?.id,
        result: 'partial',
        reasonCategory: 'ABILITY',
        userFeedback: 'Agent Action Loop 验收：部分完成。',
        adjustment: '继续缩小动作并记录。',
      },
      true,
    )
    record(
      'AAL-CHECKIN-WRITE',
      'checkin.submit can create Checkin and audit action',
      Boolean(checkin.data?.action?.status === 'executed' && checkin.data?.result?.id),
      `checkin=${checkin.data?.result?.id}; audit=${checkin.data?.action?.id}`,
    )

    const log = await executeTool(
      'log.write_daily',
      {
        title: todayText(),
        content: `# ${todayText()}\n\n## Agent Action Loop 验收\n\n- 工具确认：已验证\n- Check-in：已验证\n`,
      linkedActionIds: [executedResult?.id].filter(Boolean),
      },
      true,
    )
    record(
      'AAL-LOG-WRITE',
      'log.write_daily can write Markdown document and audit action',
      Boolean(log.data?.action?.status === 'executed' && log.data?.result?.path),
      `path=${log.data?.result?.path}; audit=${log.data?.action?.id}`,
    )

    const reminders = await request('/api/settings/reminders', {
      method: 'PUT',
      body: JSON.stringify({
        rules: [
          { reminderType: 'morning_planning', channel: 'qq', schedule: '08:30', timezone: 'Asia/Shanghai', maxPerDay: 1, enabled: true },
          { reminderType: 'midday_check', channel: 'qq', schedule: '12:30', timezone: 'Asia/Shanghai', maxPerDay: 1, enabled: true },
          { reminderType: 'evening_review', channel: 'qq', schedule: '21:30', timezone: 'Asia/Shanghai', maxPerDay: 1, enabled: true },
          { reminderType: 'weekly_review', channel: 'qq', schedule: 'SUN 21:00', timezone: 'Asia/Shanghai', maxPerDay: 1, enabled: true },
        ],
      }),
    })
    record(
      'AAL-REMINDER-WRITE',
      'settings reminders endpoint persists scheduler rules',
      Boolean(reminders.data?.length >= 4),
      `rules=${reminders.data?.map((rule) => `${rule.reminderType}:${rule.schedule}`).join(', ')}`,
    )
  } else {
    record('AAL-WRITE-SKIPPED', 'write-path checks require --write', true, 'run pnpm verify:agent-loop:write for mutating checks')
  }

  const exported = await request('/api/settings/export')
  record(
    'AAL-EXPORT',
    'export includes Agent Action Loop data without leaking secrets',
    Boolean(exported.data && Array.isArray(exported.data.reminderRules) && Array.isArray(exported.data.toolActions) && Array.isArray(exported.data.schedulerEvents) && Array.isArray(exported.data.qqChatBindings) && noSecretLeak(exported)),
    `keys=${Object.keys(exported.data || {}).join(', ')}`,
  )

  if (userId) {
    const [toolActionCount, reminderRuleCount, schedulerEventCount] = await Promise.all([
      prisma.agentToolAction.count({ where: { userId } }),
      prisma.reminderRule.count({ where: { userId } }),
      prisma.schedulerEvent.count({ where: { userId } }),
    ])
    record(
      'AAL-DB-CONTRACT',
      'database has Agent Action Loop persistence surfaces',
      reminderRuleCount >= 4 && toolActionCount >= 0 && schedulerEventCount >= 0,
      `toolActions=${toolActionCount}; reminderRules=${reminderRuleCount}; schedulerEvents=${schedulerEventCount}`,
    )
  } else {
    record('AAL-DB-CONTRACT', 'database has Agent Action Loop persistence surfaces', false, 'missing userId from control center')
  }
}

try {
  await run()
} catch (error) {
  record('AAL-RUNTIME', 'Agent Action Loop verifier did not crash', false, error instanceof Error ? error.message : String(error))
} finally {
  await prisma.$disconnect()
}

const lines = [
  '# Agent Action Loop v0.2 Verification',
  '',
  `- Base URL: ${baseUrl}`,
  `- Time: ${new Date().toISOString()}`,
  `- Authenticated: ${cookie ? 'yes' : 'no'}`,
  `- Mutating checks: ${shouldWrite ? 'yes' : 'no'}`,
  '',
  '| ID | Purpose | Result | Evidence |',
  '| --- | --- | --- | --- |',
  ...results.map((result) => `| ${result.id} | ${result.purpose} | ${result.ok ? 'PASS' : 'FAIL'} | ${String(result.evidence || '').replaceAll('|', '\\|')} |`),
  '',
]

const markdown = lines.join('\n')
console.log(markdown)

if (shouldWriteReport) {
  const { writeFileSync } = await import('node:fs')
  writeFileSync('../docs/plans/agent-action-loop-v0.2-last-run.md', markdown)
}

process.exit(results.every((result) => result.ok) ? 0 : 1)
