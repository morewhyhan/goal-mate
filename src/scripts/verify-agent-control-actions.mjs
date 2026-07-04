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
const email = process.env.GOAL_MATE_AGENT_CONTROL_EMAIL || `agent-control-${runId}@goalmate.local`
const password = process.env.GOAL_MATE_AGENT_CONTROL_PASSWORD || 'agent-control-pass-123'
const results = []

function record(id, purpose, ok, evidence = '') {
  results.push({ id, purpose, ok, evidence })
}

function maskEmail(value) {
  return value.replace(/^(.{3}).+@/, '$1...@')
}

function compact(value, max = 220) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return text.length <= max ? text : `${text.slice(0, max)}...`
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

async function executeTool(cookie, toolName, input = {}, confirmed = false) {
  return api('/api/agent/tools/execute', cookie, {
    method: 'POST',
    body: JSON.stringify({ toolName, input, confirmed }),
  })
}

async function confirmAction(cookie, actionId) {
  return api(`/api/agent/tools/actions/${actionId}/confirm`, cookie, { method: 'POST' })
}

function containsRawSecret(value, rawSecret) {
  return JSON.stringify(value || {}).includes(rawSecret)
}

async function run() {
  const health = await api('/api/health', '')
  record('ACA-HEALTH', 'local API is reachable before Agent control action verification', health.response.ok, `GET /api/health status=${health.response.status}`)
  if (!health.response.ok) return

  await cleanupUser()
  const signup = await authRequest('/api/auth/sign-up/email', { email, password, name: 'Agent Control User' })
  const cookie = extractCookie(signup.response)
  const user = await prisma.user.findUnique({ where: { email } })
  record('ACA-AUTH', 'a clean test user can register and get a session', signup.response.ok && Boolean(user?.id), `user=${maskEmail(email)}`)
  if (!user) return

  const rawModelSecret = `agent-control-key-${runId}`
  const modelInput = {
    provider: 'DeepSeek',
    model: `agent-control-model-${runId}`,
    reasoningModel: '',
    apiBase: 'https://api.deepseek.com',
    apiKey: rawModelSecret,
    temperature: 0.22,
  }
  const modelPending = await executeTool(cookie, 'settings.model.update', modelInput, false)
  const pendingModelAction = modelPending.json?.data?.action
  const modelCountBeforeConfirm = await prisma.modelConfig.count({ where: { userId: user.id } })
  record(
    'ACA-MODEL-PENDING',
    'Agent settings.model.update creates a pending confirmation instead of changing model config immediately',
    modelPending.response.ok
      && modelPending.json?.data?.needsConfirmation === true
      && pendingModelAction?.status === 'pending_confirmation'
      && pendingModelAction?.requiresConfirmation === true
      && modelCountBeforeConfirm === 0,
    `status=${modelPending.response.status}; action=${pendingModelAction?.id || 'missing'}; modelsBeforeConfirm=${modelCountBeforeConfirm}`,
  )

  const modelConfirmed = await confirmAction(cookie, pendingModelAction?.id)
  const modelResult = modelConfirmed.json?.data?.execution?.result
  const dbModel = await prisma.modelConfig.findFirst({ where: { userId: user.id, isDefault: true }, orderBy: { createdAt: 'asc' } })
  const modelRead = await executeTool(cookie, 'settings.model.get', {}, false)
  const exportedAfterModel = await api('/api/settings/export', cookie)
  record(
    'ACA-MODEL-CONFIRMED',
    'confirming Agent settings.model.update writes current user default model and read tool returns masked config',
    modelConfirmed.response.ok
      && modelConfirmed.json?.data?.confirmed === true
      && modelConfirmed.json?.data?.execution?.action?.status === 'executed'
      && dbModel?.model === modelInput.model
      && modelRead.json?.data?.needsConfirmation === false
      && modelRead.json?.data?.result?.apiKeyConfigured === true
      && modelRead.json?.data?.result?.apiKeyRef === 'sk-••••••••••••',
    `model=${dbModel?.model || 'missing'}; readMasked=${modelRead.json?.data?.result?.apiKeyRef || 'missing'}`,
  )
  record(
    'ACA-MODEL-SECRET',
    'Agent model update stores API key encrypted and no API/export response leaks the raw key',
    Boolean(
      dbModel?.apiKeyRef?.startsWith('enc:v1:')
        && !dbModel.apiKeyRef.includes(rawModelSecret)
        && !containsRawSecret(modelPending.json, rawModelSecret)
        && !containsRawSecret(modelConfirmed.json, rawModelSecret)
        && !containsRawSecret(modelRead.json, rawModelSecret)
        && !containsRawSecret(exportedAfterModel.json, rawModelSecret)
        && modelResult?.apiKeyRef?.startsWith('enc:v1:'),
    ),
    `apiKeyRef=${dbModel?.apiKeyRef?.slice(0, 6) || 'missing'}; exportStatus=${exportedAfterModel.response.status}`,
  )

  const reminderInput = {
    reminderType: 'midday_check',
    channel: 'qq',
    schedule: '13:17',
    timezone: 'Asia/Shanghai',
    maxPerDay: 1,
    quietHours: { range: '23:00-07:00' },
    enabled: true,
    metadata: { source: 'agent_control_verification', runId },
  }
  const reminderPending = await executeTool(cookie, 'reminder.schedule', reminderInput, false)
  const pendingReminderAction = reminderPending.json?.data?.action
  const reminderCountBeforeConfirm = await prisma.reminderRule.count({ where: { userId: user.id } })
  record(
    'ACA-REMINDER-PENDING',
    'Agent reminder.schedule creates a pending confirmation before writing ReminderRule',
    reminderPending.response.ok
      && reminderPending.json?.data?.needsConfirmation === true
      && pendingReminderAction?.status === 'pending_confirmation'
      && pendingReminderAction?.requiresConfirmation === true
      && reminderCountBeforeConfirm === 0,
    `status=${reminderPending.response.status}; action=${pendingReminderAction?.id || 'missing'}; remindersBeforeConfirm=${reminderCountBeforeConfirm}`,
  )

  const reminderConfirmed = await confirmAction(cookie, pendingReminderAction?.id)
  const reminderResult = reminderConfirmed.json?.data?.execution?.result
  const dbReminder = await prisma.reminderRule.findFirst({ where: { userId: user.id, reminderType: 'midday_check' }, orderBy: { createdAt: 'desc' } })
  const controlCenter = await api('/api/settings/control-center', cookie)
  const toolActions = controlCenter.json?.data?.toolActions || []
  const hasModelAudit = toolActions.some((action) => action.toolName === 'settings.model.update' && action.status === 'executed')
  const hasReminderAudit = toolActions.some((action) => action.toolName === 'reminder.schedule' && action.status === 'executed')
  record(
    'ACA-REMINDER-CONFIRMED',
    'confirming Agent reminder.schedule writes ReminderRule visible in Settings Control Center',
    reminderConfirmed.response.ok
      && reminderConfirmed.json?.data?.confirmed === true
      && reminderConfirmed.json?.data?.execution?.action?.status === 'executed'
      && dbReminder?.schedule === reminderInput.schedule
      && dbReminder?.maxPerDay === reminderInput.maxPerDay
      && controlCenter.json?.data?.reminderRules?.some((rule) => rule.id === dbReminder.id)
      && hasReminderAudit,
    `reminder=${dbReminder?.reminderType || 'missing'} ${dbReminder?.schedule || 'missing'}; audit=${hasReminderAudit}`,
  )
  record(
    'ACA-CONTROL-CENTER',
    'Settings Control Center exposes Agent-written model, reminder and tool audit surfaces for user review',
    controlCenter.response.ok
      && controlCenter.json?.data?.model?.model === modelInput.model
      && controlCenter.json?.data?.reminderRules?.some((rule) => rule.id === reminderResult?.id)
      && hasModelAudit
      && hasReminderAudit
      && !containsRawSecret(controlCenter.json, rawModelSecret),
    `model=${controlCenter.json?.data?.model?.model || 'missing'}; reminders=${controlCenter.json?.data?.reminderRules?.length || 0}; audits=${toolActions.length}`,
  )
}

function toMarkdown() {
  return [
    '# Goal Mate Agent Control Actions Verification',
    '',
    `- Time: ${new Date().toISOString()}`,
    `- Base URL: ${baseUrl}`,
    `- Test user: ${maskEmail(email)}`,
    `- Test data kept: ${keepData ? 'yes' : 'no'}`,
    '',
    '## Scope',
    '',
    'This report proves Web Agent tools can control system settings through confirmation: model configuration and reminder schedule changes are pending first, confirmed explicitly, persisted per user, redacted in responses/export, and visible in Settings Control Center audit surfaces.',
    '',
    '| ID | Purpose | Result | Evidence |',
    '| --- | --- | --- | --- |',
    ...results.map((result) => `| ${result.id} | ${result.purpose} | ${result.ok ? 'PASS' : 'FAIL'} | ${compact(result.evidence).replaceAll('|', '\\|')} |`),
    '',
  ].join('\n')
}

try {
  await run()
} catch (error) {
  record('ACA-RUNTIME', 'Agent control action verifier completes without crashing', false, error instanceof Error ? error.message : String(error))
} finally {
  if (!keepData) {
    try {
      await cleanupUser()
      record('ACA-CLEANUP', 'temporary Agent control user and data are removed', true, 'cleanup completed')
    } catch (error) {
      record('ACA-CLEANUP', 'temporary Agent control user and data are removed', false, error instanceof Error ? error.message : String(error))
    }
  }
  await prisma.$disconnect()
}

const markdown = toMarkdown()
console.log(markdown)
if (shouldWrite) {
  writeFileSync(resolve(projectRoot, 'docs/plans/agent-control-actions-last-run.md'), markdown)
}

if (results.some((result) => !result.ok)) {
  process.exitCode = 1
}
