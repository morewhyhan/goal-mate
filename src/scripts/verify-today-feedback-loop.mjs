import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const shouldWrite = process.argv.includes('--write')
const keepData = process.argv.includes('--keep-data')
const baseUrl = process.env.GOAL_MATE_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
const scriptDir = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDir, '..', '..')
const runId = Date.now()
const email = process.env.GOAL_MATE_TODAY_FEEDBACK_EMAIL || `today-feedback-${runId}@goalmate.local`
const password = process.env.GOAL_MATE_TODAY_FEEDBACK_PASSWORD || 'today-feedback-pass-123'
const results = []

function record(id, purpose, ok, evidence = '') {
  results.push({ id, purpose, ok, evidence })
}

function maskEmail(value) {
  return value.replace(/^(.{3}).+@/, '$1...@')
}

function sanitize(value) {
  return String(value || '').replaceAll('|', '\\|').replace(/\n/g, '<br>')
}

async function cleanupUser() {
  await prisma.user.deleteMany({ where: { email } })
}

async function authRequest(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: baseUrl,
    },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = text
  }
  return { response, text, json }
}

function extractCookie(response) {
  const setCookie = response.headers.get('set-cookie') || ''
  const match = setCookie.match(/goal-mate\.session_token=[^;]+/) || setCookie.match(/hononext\.session_token=[^;]+/)
  if (!match) throw new Error('Missing session cookie in auth response.')
  return match[0]
}

async function api(path, cookie, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  })
  const text = await response.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = text
  }
  return { response, text, json }
}

async function createFirstGoal(cookie) {
  const thread = await api('/api/agent/threads', cookie, {
    method: 'POST',
    body: JSON.stringify({ title: 'Today 反馈闭环验证' }),
  })
  const threadId = thread.json?.data?.id
  if (!thread.response.ok || !threadId) {
    throw new Error(`create thread failed: ${thread.response.status}; ${thread.text.slice(0, 200)}`)
  }

  const goalInput = [
    '我想在21天内完成一个能真实推进自己的目标系统，',
    '当前已经有网页和 Agent，但我需要每天只看下一步并反馈完成情况，',
    '如果没完成，系统要判断原因并调整明天的推进方式。',
  ].join('')
  const draft = await api(`/api/agent/threads/${threadId}/messages`, cookie, {
    method: 'POST',
    body: JSON.stringify({ content: goalInput }),
  })
  const assistant = draft.json?.data?.assistantMessage
  const structured = assistant?.structuredOutput || {}
  const toolResult = structured?.tool_result?.result
  const activationActionId = structured?.activation_result?.action?.id
  if (!draft.response.ok || !toolResult?.goal?.id || !toolResult?.dailyAction?.id || !activationActionId) {
    throw new Error(`first goal draft failed: ${draft.response.status}; ${draft.text.slice(0, 400)}`)
  }

  const confirm = await api(`/api/agent/tools/actions/${activationActionId}/confirm`, cookie, { method: 'POST' })
  const activation = confirm.json?.data?.execution?.result
  if (!confirm.response.ok || activation?.goal?.status !== 'ACTIVE' || activation?.goal?.isCurrentFocus !== true) {
    throw new Error(`goal activation failed: ${confirm.response.status}; ${confirm.text.slice(0, 400)}`)
  }

  return {
    threadId,
    goalId: toolResult.goal.id,
    actionId: toolResult.dailyAction.id,
    activationActionId,
  }
}

async function run() {
  const health = await api('/api/health', '')
  record('TFL-HEALTH', 'local API is reachable before Today feedback verification', health.response.ok, `GET /api/health status=${health.response.status}`)
  if (!health.response.ok) return

  await cleanupUser()
  const signup = await authRequest('/api/auth/sign-up/email', { email, password, name: 'Today Feedback User' })
  const cookie = extractCookie(signup.response)
  const user = await prisma.user.findUnique({ where: { email } })
  record('TFL-AUTH', 'a clean user can register and get a session for Today feedback', signup.response.ok && Boolean(user?.id), `user=${maskEmail(email)}`)
  if (!user) return

  const initialCounts = {
    goals: await prisma.goal.count({ where: { userId: user.id } }),
    checkins: await prisma.checkin.count({ where: { userId: user.id } }),
    markdown: await prisma.markdownDocument.count({ where: { userId: user.id } }),
  }
  record(
    'TFL-CLEAN-WORKSPACE',
    'Today feedback verifier starts from a clean user workspace',
    initialCounts.goals === 0 && initialCounts.checkins === 0 && initialCounts.markdown === 0,
    `goals=${initialCounts.goals}; checkins=${initialCounts.checkins}; markdown=${initialCounts.markdown}`,
  )

  const firstGoal = await createFirstGoal(cookie)
  record(
    'TFL-FIRST-GOAL',
    'clean user can create and activate a goal through Agent before using Today',
    Boolean(firstGoal.goalId && firstGoal.actionId),
    `goal=${firstGoal.goalId}; action=${firstGoal.actionId}; thread=${firstGoal.threadId}`,
  )

  const todayBefore = await api('/api/today', cookie)
  const action = todayBefore.json?.data?.action
  record(
    'TFL-TODAY-READY',
    'Today exposes the Agent-created current goal and one actionable next step before feedback',
    todayBefore.response.ok && todayBefore.json?.data?.goal?.id === firstGoal.goalId && action?.id,
    `goal=${todayBefore.json?.data?.goal?.id || 'missing'}; action=${action?.title || 'missing'}`,
  )
  if (!action?.id) return

  const feedbackText = `没完成，动作还是太大，我需要先缩小到一个 5 分钟版本 ${runId}`
  const checkin = await api('/api/today/checkin', cookie, {
    method: 'POST',
    body: JSON.stringify({
      actionId: action.id,
      result: 'not_done',
      userFeedback: feedbackText,
    }),
  })
  const result = checkin.json?.data || {}
  record(
    'TFL-CHECKIN-API',
    'Today check-in endpoint accepts user feedback and returns control-loop artifacts',
    checkin.response.ok
      && result.checkin?.id
      && result.diagnosis?.id
      && result.logEntry?.id
      && result.markdownDocument?.id
      && result.controlLoopEpisode?.id,
    `status=${checkin.response.status}; checkin=${result.checkin?.id || 'missing'}; diagnosis=${result.diagnosis?.category || 'missing'}; episode=${result.controlLoopEpisode?.status || 'missing'}`,
  )

  const updatedAction = await prisma.dailyAction.findFirst({ where: { id: action.id, userId: user.id } })
  const diagnosis = await prisma.diagnosis.findFirst({ where: { userId: user.id, actionId: action.id }, orderBy: { createdAt: 'desc' } })
  const checkinRows = await prisma.checkin.findMany({ where: { userId: user.id, actionId: action.id }, orderBy: { createdAt: 'desc' } })
  record(
    'TFL-STATE-UPDATE',
    'Today feedback updates DailyAction, Check-in and Diagnosis state in the database',
    updatedAction?.status === 'NOT_DONE'
      && checkinRows[0]?.result === 'NOT_DONE'
      && Boolean(diagnosis?.category)
      && ['MOTIVATION', 'ABILITY', 'PROMPT', 'PATH', 'CONDITION', 'GOAL', 'UNKNOWN'].includes(diagnosis.category),
    `action=${updatedAction?.status || 'missing'}; checkin=${checkinRows[0]?.result || 'missing'}; diagnosis=${diagnosis?.category || 'missing'}`,
  )

  const dayLog = await prisma.markdownDocument.findFirst({
    where: {
      userId: user.id,
      type: 'DAY',
      content: { contains: String(runId) },
    },
    orderBy: { updatedAt: 'desc' },
  })
  const rollups = await prisma.markdownDocument.count({
    where: {
      userId: user.id,
      type: { in: ['YEAR', 'QUARTER', 'MONTH', 'WEEK'] },
    },
  })
  record(
    'TFL-LOGS',
    'Today feedback writes a Markdown daily log and maintains log rollups for Logs page context',
    Boolean(dayLog?.id && dayLog.content.includes(feedbackText) && rollups >= 1),
    `dayLog=${dayLog?.path || 'missing'}; rollups=${rollups}`,
  )

  const metaDoc = await prisma.markdownDocument.findFirst({
    where: {
      userId: user.id,
      type: 'SYSTEM',
      path: { startsWith: 'system/meta-cognition/' },
      content: { contains: String(runId) },
    },
    orderBy: { updatedAt: 'desc' },
  })
  record(
    'TFL-META-COGNITION',
    'Today feedback creates meta-cognition evidence that can change the next intervention and AI thinking rule',
    Boolean(metaDoc?.id && /policy_delta|AI|下次|干预/.test(metaDoc.content)),
    metaDoc?.path || 'missing',
  )

  const todayAfter = await api('/api/today', cookie)
  const momentum = todayAfter.json?.data?.momentum || []
  const activeMomentum = momentum.filter((item) => Number(item.level || 0) > 0 || Number(item.count || 0) > 0)
  record(
    'TFL-TODAY-AFTER',
    'Today reflects submitted feedback through momentum data instead of leaving the page visually unchanged',
    todayAfter.response.ok && activeMomentum.length >= 1,
    `momentumDays=${momentum.length}; activeDays=${activeMomentum.length}`,
  )

  const goals = await api('/api/goals', cookie)
  const goal = (goals.json?.data || []).find((item) => item.id === firstGoal.goalId)
  const goalHasFeedback = goal?.dailyActions?.some((item) => item.id === action.id && item.status === 'NOT_DONE')
    && goal?.checkins?.some((item) => item.id === result.checkin?.id)
    && goal?.diagnoses?.some((item) => item.id === result.diagnosis?.id)
  record(
    'TFL-GOALS-REFLECT',
    'Goals read model reflects Today feedback as read-only state, not just a transient API response',
    Boolean(goals.response.ok && goalHasFeedback),
    `goal=${goal?.title || 'missing'}; actionStatus=${goal?.dailyActions?.find((item) => item.id === action.id)?.status || 'missing'}; checkins=${goal?.checkins?.length || 0}; diagnoses=${goal?.diagnoses?.length || 0}`,
  )

  const logs = await api('/api/logs/tree', cookie)
  const logVisible = (logs.json?.data || []).some((item) => item.path === dayLog?.path)
  record(
    'TFL-LOGS-API',
    'Logs API exposes the Markdown evidence generated by Today feedback',
    logs.response.ok && logVisible,
    `logVisible=${logVisible}; path=${dayLog?.path || 'missing'}`,
  )
}

function toMarkdown() {
  const failed = results.filter((item) => !item.ok)
  return [
    '# Goal Mate Today Feedback Loop Verification',
    '',
    `- Time: ${new Date().toISOString()}`,
    `- Base URL: ${baseUrl}`,
    `- Test user: ${maskEmail(email)}`,
    `- Test data kept: ${keepData ? 'yes' : 'no'}`,
    `- Result: ${failed.length === 0 ? 'PASS' : 'FAIL'}`,
    '',
    '## Scope',
    '',
    'This report proves a clean user can create a goal through Agent, submit feedback on Today, and have that feedback persisted into DailyAction, Check-in, Diagnosis, Markdown Logs, Momentum and Goals read state. It does not prove long-running QQ delivery or live model quality.',
    '',
    '| ID | Purpose | Result | Evidence |',
    '| --- | --- | --- | --- |',
    ...results.map((result) => `| ${result.id} | ${result.purpose} | ${result.ok ? 'PASS' : 'FAIL'} | ${sanitize(result.evidence)} |`),
    '',
  ].join('\n')
}

try {
  await run()
} catch (error) {
  record('TFL-RUNTIME', 'Today feedback verifier completes without crashing', false, error instanceof Error ? error.message : String(error))
} finally {
  if (!keepData) {
    try {
      await cleanupUser()
      record('TFL-CLEANUP', 'temporary Today feedback user and data are removed', true, 'cleanup completed')
    } catch (error) {
      record('TFL-CLEANUP', 'temporary Today feedback user and data are removed', false, error instanceof Error ? error.message : String(error))
    }
  }
  await prisma.$disconnect()
}

const markdown = toMarkdown()
console.log(markdown)
if (shouldWrite) {
  writeFileSync(resolve(projectRoot, 'docs/plans/today-feedback-loop-last-run.md'), markdown)
}

if (results.some((result) => !result.ok)) {
  process.exitCode = 1
}
