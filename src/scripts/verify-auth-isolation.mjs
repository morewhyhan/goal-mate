import { existsSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const shouldWrite = process.argv.includes('--write')
const keepData = process.argv.includes('--keep-data')
const baseUrl = process.env.GOAL_MATE_BASE_URL || process.env.NEXT_PUBLIC_BETTER_AUTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
const scriptDir = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(scriptDir, '..')
const projectRoot = resolve(appRoot, '..')
const runId = Date.now()
const userAEmail = process.env.GOAL_MATE_ISOLATION_USER_A || `isolation-a-${runId}@goalmate.local`
const userBEmail = process.env.GOAL_MATE_ISOLATION_USER_B || `isolation-b-${runId}@goalmate.local`
const password = process.env.GOAL_MATE_ISOLATION_PASSWORD || 'isolation-pass-123'
const titleA = `A-only goal ${runId}`
const titleB = `B-only goal ${runId}`
const logPathA = `logs/isolation/${runId}/a.md`
const logPathB = `logs/isolation/${runId}/b.md`
const threadTitleA = `A-only thread ${runId}`
const threadTitleB = `B-only thread ${runId}`
const modelProviderA = `AOnlyProvider${runId}`
const modelProviderB = `BOnlyProvider${runId}`
const modelSecretA = `sk-isolation-a-${runId}-secret-token`
const modelSecretB = `sk-isolation-b-${runId}-secret-token`
const results = []

function record(id, purpose, ok, evidence = '') {
  results.push({ id, purpose, ok, evidence })
}

function maskEmail(email) {
  return email.replace(/^(.{3}).+@/, '$1...@')
}

async function cleanupUsers() {
  await prisma.user.deleteMany({ where: { email: { in: [userAEmail, userBEmail] } } })
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
  return { response, json, text }
}

function extractCookie(response) {
  const setCookie = response.headers.get('set-cookie') || ''
  const match = setCookie.match(/goal-mate\.session_token=[^;]+/) || setCookie.match(/hononext\.session_token=[^;]+/)
  if (!match) throw new Error('Missing session cookie in auth response.')
  return match[0]
}

async function signUp(email, name) {
  const result = await authRequest('/api/auth/sign-up/email', { email, password, name })
  if (!result.response.ok) {
    throw new Error(`sign-up failed for ${email}: ${result.response.status} ${result.text.slice(0, 300)}`)
  }
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user) throw new Error(`user not found after sign-up: ${email}`)
  return { user, cookie: extractCookie(result.response) }
}

async function apiGet(path, cookie) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: cookie ? { cookie } : undefined,
  })
  const text = await response.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = text
  }
  return { response, json, text }
}

async function apiJson(path, cookie, method, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
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
  return { response, json, text }
}

function dataArray(json) {
  return Array.isArray(json?.data) ? json.data : []
}

function textIncludes(value, needle) {
  return JSON.stringify(value).includes(needle)
}

async function createWorkspaceData(userId, marker) {
  const goal = await prisma.goal.create({
    data: {
      userId,
      title: marker.title,
      rawInput: marker.title,
      interpretedGoal: marker.title,
      status: 'ACTIVE',
      isCurrentFocus: true,
      horizonStart: new Date('2026-07-01T00:00:00.000Z'),
      horizonEnd: new Date('2026-09-01T00:00:00.000Z'),
    },
  })
  const condition = await prisma.goalCondition.create({
    data: {
      userId,
      goalId: goal.id,
      title: `${marker.title} condition`,
      type: 'HARD',
      status: 'MISSING',
      whyRequired: 'isolation verification',
    },
  })
  await prisma.dailyAction.create({
    data: {
      userId,
      goalId: goal.id,
      conditionId: condition.id,
      actionDate: new Date(),
      title: `${marker.title} action`,
      doneWhen: `${marker.title} done`,
      minimumStep: `${marker.title} minimum`,
      fallbackAction: `${marker.title} fallback`,
      status: 'PLANNED',
    },
  })
  const log = await prisma.markdownDocument.create({
    data: {
      userId,
      type: 'DAY',
      title: marker.path.split('/').pop() || marker.path,
      path: marker.path,
      content: `# ${marker.title}`,
      linkedGoalIds: [goal.id],
      linkedActionIds: [],
      source: 'USER',
    },
  })
  await prisma.logEntry.create({
    data: {
      userId,
      periodType: 'DAY',
      title: marker.path.split('/').pop() || marker.path,
      path: marker.path,
      content: `# ${marker.title}`,
      linkedGoalIds: [goal.id],
      linkedActionIds: [],
    },
  })
  const thread = await prisma.agentThread.create({
    data: {
      userId,
      goalId: goal.id,
      title: marker.threadTitle,
      status: 'ACTIVE',
    },
  })
  await prisma.agentMessage.create({
    data: {
      userId,
      threadId: thread.id,
      role: 'USER',
      content: `${marker.threadTitle} message`,
    },
  })

  return { goal, log, thread }
}

async function configureModel(cookie, marker, apiKey) {
  return apiJson('/api/models', cookie, 'POST', {
    provider: marker.provider,
    model: `${marker.provider}-model`,
    apiBase: 'https://example.invalid',
    apiKey,
    usage: 'CHAT',
    isDefault: false,
    temperature: 0.1,
  })
}

async function run() {
  const health = await apiGet('/api/health')
  record('ISO-HEALTH', 'local API is reachable before isolation verification', health.response.ok, `GET /api/health status=${health.response.status}`)
  if (!health.response.ok) return

  await cleanupUsers()
  const authA = await signUp(userAEmail, 'Isolation A')
  const authB = await signUp(userBEmail, 'Isolation B')
  record('ISO-AUTH-USERS', 'two independent authenticated users can be created', true, `a=${maskEmail(userAEmail)}; b=${maskEmail(userBEmail)}`)

  const dataA = await createWorkspaceData(authA.user.id, {
    title: titleA,
    path: logPathA,
    threadTitle: threadTitleA,
    provider: modelProviderA,
  })
  const dataB = await createWorkspaceData(authB.user.id, {
    title: titleB,
    path: logPathB,
    threadTitle: threadTitleB,
    provider: modelProviderB,
  })
  record('ISO-SEED', 'test data is seeded under separate userIds', true, `aGoal=${dataA.goal.id}; bGoal=${dataB.goal.id}`)

  const modelA = await configureModel(authA.cookie, { provider: modelProviderA }, modelSecretA)
  const modelB = await configureModel(authB.cookie, { provider: modelProviderB }, modelSecretB)
  const modelASecretLeak = textIncludes(modelA.json, modelSecretA) || textIncludes(modelA.json, modelSecretB)
  const modelBSecretLeak = textIncludes(modelB.json, modelSecretA) || textIncludes(modelB.json, modelSecretB)
  record('ISO-MODEL-KEY-A', 'user A can save own model API key without response leaking it', modelA.response.ok && modelA.json?.data?.apiKeyConfigured === true && modelA.json?.data?.apiKeySource === 'user_encrypted' && !modelASecretLeak, `status=${modelA.response.status}; source=${modelA.json?.data?.apiKeySource}`)
  record('ISO-MODEL-KEY-B', 'user B can save own model API key without response leaking it', modelB.response.ok && modelB.json?.data?.apiKeyConfigured === true && modelB.json?.data?.apiKeySource === 'user_encrypted' && !modelBSecretLeak, `status=${modelB.response.status}; source=${modelB.json?.data?.apiKeySource}`)

  const storedModels = await prisma.modelConfig.findMany({
    where: { userId: { in: [authA.user.id, authB.user.id] }, provider: { in: [modelProviderA, modelProviderB] } },
  })
  const storedA = storedModels.find((item) => item.userId === authA.user.id && item.provider === modelProviderA)
  const storedB = storedModels.find((item) => item.userId === authB.user.id && item.provider === modelProviderB)
  const encryptedAtRest = Boolean(
    storedA?.apiKeyRef?.startsWith('enc:v1:')
    && storedB?.apiKeyRef?.startsWith('enc:v1:')
    && storedA.apiKeyRef !== storedB.apiKeyRef
    && !storedA.apiKeyRef.includes(modelSecretA)
    && !storedA.apiKeyRef.includes(modelSecretB)
    && !storedB.apiKeyRef.includes(modelSecretA)
    && !storedB.apiKeyRef.includes(modelSecretB),
  )
  record('ISO-MODEL-KEY-AT-REST', 'per-user model API keys are encrypted at rest and differ by user', encryptedAtRest, `aRef=${storedA?.apiKeyRef?.slice(0, 6) || 'missing'}; bRef=${storedB?.apiKeyRef?.slice(0, 6) || 'missing'}`)

  const unauthGoals = await apiGet('/api/goals')
  record('ISO-UNAUTH-GUARD', 'private goals API rejects unauthenticated access', unauthGoals.response.status === 401, `GET /api/goals status=${unauthGoals.response.status}`)

  const aGoals = await apiGet('/api/goals', authA.cookie)
  const bGoals = await apiGet('/api/goals', authB.cookie)
  record('ISO-GOALS-A', 'user A goals list contains A data and not B data', aGoals.response.ok && textIncludes(aGoals.json, titleA) && !textIncludes(aGoals.json, titleB), `status=${aGoals.response.status}; count=${dataArray(aGoals.json).length}`)
  record('ISO-GOALS-B', 'user B goals list contains B data and not A data', bGoals.response.ok && textIncludes(bGoals.json, titleB) && !textIncludes(bGoals.json, titleA), `status=${bGoals.response.status}; count=${dataArray(bGoals.json).length}`)

  const bReadsAGoal = await apiGet(`/api/goals/${dataA.goal.id}`, authB.cookie)
  record('ISO-GOAL-ID-BLOCK', 'user B cannot read user A goal by direct id', bReadsAGoal.response.status === 404, `GET /api/goals/:aGoal status=${bReadsAGoal.response.status}`)

  const aLogs = await apiGet('/api/logs/tree', authA.cookie)
  const bLogs = await apiGet('/api/logs/tree', authB.cookie)
  record('ISO-LOGS-A', 'user A logs tree contains A log and not B log', aLogs.response.ok && textIncludes(aLogs.json, logPathA) && !textIncludes(aLogs.json, logPathB), `status=${aLogs.response.status}; count=${dataArray(aLogs.json).length}`)
  record('ISO-LOGS-B', 'user B logs tree contains B log and not A log', bLogs.response.ok && textIncludes(bLogs.json, logPathB) && !textIncludes(bLogs.json, logPathA), `status=${bLogs.response.status}; count=${dataArray(bLogs.json).length}`)

  const bReadsALog = await apiGet(`/api/logs/${dataA.log.id}`, authB.cookie)
  record('ISO-LOG-ID-BLOCK', 'user B cannot read user A log by direct id', bReadsALog.response.status === 404, `GET /api/logs/:aLog status=${bReadsALog.response.status}`)

  const aThreads = await apiGet('/api/agent/threads', authA.cookie)
  const bThreads = await apiGet('/api/agent/threads', authB.cookie)
  record('ISO-THREADS-A', 'user A agent threads contain A thread and not B thread', aThreads.response.ok && textIncludes(aThreads.json, threadTitleA) && !textIncludes(aThreads.json, threadTitleB), `status=${aThreads.response.status}; count=${dataArray(aThreads.json).length}`)
  record('ISO-THREADS-B', 'user B agent threads contain B thread and not A thread', bThreads.response.ok && textIncludes(bThreads.json, threadTitleB) && !textIncludes(bThreads.json, threadTitleA), `status=${bThreads.response.status}; count=${dataArray(bThreads.json).length}`)

  const bReadsAMessages = await apiGet(`/api/agent/threads/${dataA.thread.id}/messages`, authB.cookie)
  record('ISO-THREAD-ID-BLOCK', 'user B cannot read user A thread messages by direct id', bReadsAMessages.response.status === 404, `GET /api/agent/threads/:aThread/messages status=${bReadsAMessages.response.status}`)

  const aModels = await apiGet('/api/models', authA.cookie)
  const bModels = await apiGet('/api/models', authB.cookie)
  record('ISO-MODELS-A', 'user A models contain A provider and not B provider', aModels.response.ok && textIncludes(aModels.json, modelProviderA) && !textIncludes(aModels.json, modelProviderB), `status=${aModels.response.status}`)
  record('ISO-MODELS-B', 'user B models contain B provider and not A provider', bModels.response.ok && textIncludes(bModels.json, modelProviderB) && !textIncludes(bModels.json, modelProviderA), `status=${bModels.response.status}`)

  const aExport = await apiGet('/api/settings/export', authA.cookie)
  const bExport = await apiGet('/api/settings/export', authB.cookie)
  record('ISO-EXPORT-A', 'user A export contains only A workspace markers and no raw model key', aExport.response.ok && textIncludes(aExport.json, titleA) && textIncludes(aExport.json, logPathA) && textIncludes(aExport.json, modelProviderA) && !textIncludes(aExport.json, titleB) && !textIncludes(aExport.json, logPathB) && !textIncludes(aExport.json, modelProviderB) && !textIncludes(aExport.json, modelSecretA) && !textIncludes(aExport.json, modelSecretB), `status=${aExport.response.status}`)
  record('ISO-EXPORT-B', 'user B export contains only B workspace markers and no raw model key', bExport.response.ok && textIncludes(bExport.json, titleB) && textIncludes(bExport.json, logPathB) && textIncludes(bExport.json, modelProviderB) && !textIncludes(bExport.json, titleA) && !textIncludes(bExport.json, logPathA) && !textIncludes(bExport.json, modelProviderA) && !textIncludes(bExport.json, modelSecretA) && !textIncludes(bExport.json, modelSecretB), `status=${bExport.response.status}`)
}

function toMarkdown() {
  return [
    '# Goal Mate Auth Isolation Verification',
    '',
    `- Time: ${new Date().toISOString()}`,
    `- Base URL: ${baseUrl}`,
    `- Test users: ${maskEmail(userAEmail)}, ${maskEmail(userBEmail)}`,
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
  record('ISO-RUNTIME', 'auth isolation verifier completes without crashing', false, error instanceof Error ? error.message : String(error))
} finally {
  if (!keepData) {
    try {
      await cleanupUsers()
      record('ISO-CLEANUP', 'temporary isolation users and data are removed', true, 'cleanup completed')
    } catch (error) {
      record('ISO-CLEANUP', 'temporary isolation users and data are removed', false, error instanceof Error ? error.message : String(error))
    }
  }
  await prisma.$disconnect()
}

const markdown = toMarkdown()
console.log(markdown)
if (shouldWrite) {
  writeFileSync(resolve(projectRoot, 'docs/plans/auth-isolation-last-run.md'), markdown)
}

if (results.some((result) => !result.ok)) {
  process.exitCode = 1
}
