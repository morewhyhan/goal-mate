import { createServer } from 'node:http'
import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PrismaClient } from '@prisma/client'
import { findQqAccountByBindingCode } from '../lib/qq-bot-config.mjs'

const prisma = new PrismaClient()
const shouldWrite = process.argv.includes('--write')
const keepData = process.argv.includes('--keep-data')
const baseUrl = process.env.GOAL_MATE_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
const scriptDir = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDir, '..', '..')
const runId = Date.now()
const email = process.env.GOAL_MATE_SETTINGS_SELF_SERVICE_EMAIL || `settings-self-${runId}@goalmate.local`
const password = process.env.GOAL_MATE_SETTINGS_SELF_SERVICE_PASSWORD || 'settings-self-pass-123'
const rawModelKey = `fixture-settings-self-service-model-key-${runId}`
const rawQqToken = `qq-settings-token-${runId}`
const results = []
let fakeModel = null
let fakeQq = null

function record(id, purpose, ok, evidence = '') {
  results.push({ id, purpose, ok, evidence })
}

function maskEmail(value) {
  return value.replace(/^(.{3}).+@/, '$1...@')
}

function sanitize(value) {
  return String(value || '').replaceAll('|', '\\|').replace(/\n/g, '<br>')
}

function containsRawSecret(value, secret) {
  return JSON.stringify(value || {}).includes(secret)
}

async function cleanupUser() {
  await prisma.user.deleteMany({ where: { email } })
}

async function startFakeModelServer() {
  const requests = []
  const server = createServer((req, res) => {
    let raw = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', () => {
      let body = null
      try {
        body = raw ? JSON.parse(raw) : null
      } catch {
        body = { raw }
      }
      if (req.method === 'POST' && req.url === '/chat/completions') {
        requests.push({ authorization: req.headers.authorization, body })
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({
          id: `settings-self-model-${runId}`,
          choices: [{ message: { role: 'assistant', content: 'ok' } }],
        }))
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
    requests,
    apiBase: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolveClose) => server.close(resolveClose)),
  }
}

async function startFakeQqServer() {
  const tokenRequests = []
  const server = createServer((req, res) => {
    let raw = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => { raw += chunk })
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
        res.end(JSON.stringify({ access_token: `fake-qq-token-${runId}`, expires_in: 7200 }))
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
    apiBase: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolveClose) => server.close(resolveClose)),
  }
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

async function run() {
  fakeModel = await startFakeModelServer()
  fakeQq = await startFakeQqServer()

  const health = await api('/api/health', '')
  record('SSS-HEALTH', 'local API is reachable before Settings self-service verification', health.response.ok, `GET /api/health status=${health.response.status}`)
  if (!health.response.ok) return

  await cleanupUser()
  const signup = await authRequest('/api/auth/sign-up/email', { email, password, name: 'Settings Self Service User' })
  const cookie = extractCookie(signup.response)
  const user = await prisma.user.findUnique({ where: { email } })
  record('SSS-AUTH', 'a clean user can register for Settings self-service configuration', signup.response.ok && Boolean(user?.id), `user=${maskEmail(email)}`)
  if (!user) return

  const initialControl = await api('/api/settings/control-center', cookie)
  record(
    'SSS-INITIAL-CONTROL-CENTER',
    'Settings Control Center is readable before user-managed configuration and does not inherit global QQ credentials',
    initialControl.response.ok
      && initialControl.json?.data?.runtimeStatus?.web?.status === 'ok'
      && initialControl.json?.data?.runtimeStatus?.qq?.status === 'missing_config'
      && initialControl.json?.data?.qqBotConfig?.source === 'settings_required'
      && initialControl.json?.data?.deploymentConfig?.uiManaged?.some((item) => String(item).includes('模型')),
    `model=${initialControl.json?.data?.runtimeStatus?.model?.status || 'missing'}; qq=${initialControl.json?.data?.runtimeStatus?.qq?.status || 'missing'}`,
  )

  const modelCreate = await api('/api/models', cookie, {
    method: 'POST',
    body: JSON.stringify({
      provider: 'DeepSeek',
      model: `settings-self-model-${runId}`,
      apiBase: fakeModel.apiBase,
      apiKey: rawModelKey,
      usage: 'CHAT',
      isDefault: true,
      temperature: 0.2,
    }),
  })
  const modelData = modelCreate.json?.data
  record(
    'SSS-MODEL-SAVE',
    'user can save model API configuration from Settings without response leaking raw API key',
    modelCreate.response.ok
      && modelData?.apiKeyConfigured === true
      && modelData?.apiKeySource === 'user_encrypted'
      && modelData?.apiKeyRef === 'sk-••••••••••••'
      && !containsRawSecret(modelCreate.json, rawModelKey),
    `status=${modelCreate.response.status}; model=${modelData?.model || 'missing'}; source=${modelData?.apiKeySource || 'missing'}`,
  )

  const modelTest = await api('/api/settings/models/test', cookie, { method: 'POST' })
  record(
    'SSS-MODEL-TEST',
    'Settings model test uses the current user default model and configured API Base',
    modelTest.response.ok
      && modelTest.json?.data?.ok === true
      && modelTest.json?.data?.model === modelData?.model
      && fakeModel.requests.length === 1
      && String(fakeModel.requests[0]?.authorization || '').includes(rawModelKey)
      && !containsRawSecret(modelTest.json, rawModelKey),
    `ok=${modelTest.json?.data?.ok}; model=${modelTest.json?.data?.model || 'missing'}; fakeCalls=${fakeModel.requests.length}`,
  )

  const dbModel = await prisma.modelConfig.findFirst({ where: { userId: user.id, isDefault: true }, orderBy: { updatedAt: 'desc' } })
  record(
    'SSS-MODEL-SECRET-AT-REST',
    'model API key is encrypted at rest under the current user',
    Boolean(dbModel?.apiKeyRef?.startsWith('enc:v1:') && !dbModel.apiKeyRef.includes(rawModelKey)),
    `apiKeyRef=${dbModel?.apiKeyRef?.slice(0, 6) || 'missing'}`,
  )

  const qqConfig = await api('/api/settings/qq-bot', cookie, {
    method: 'PUT',
    body: JSON.stringify({
      appId: `qq-settings-app-${runId}`,
      token: rawQqToken,
      apiBase: fakeQq.apiBase,
      intents: 33554432,
      allowedContextIds: '',
      enabled: true,
    }),
  })
  record(
    'SSS-QQ-SAVE',
    'user can save QQ Bot config from Settings without response leaking raw token',
    qqConfig.response.ok
      && qqConfig.json?.data?.configured === true
      && qqConfig.json?.data?.source === 'settings'
      && qqConfig.json?.data?.tokenConfigured === true
      && !containsRawSecret(qqConfig.json, rawQqToken),
    `status=${qqConfig.response.status}; source=${qqConfig.json?.data?.source || 'missing'}; configured=${qqConfig.json?.data?.configured}`,
  )

  const qqTest = await api('/api/settings/qq-bot/test', cookie, { method: 'POST' })
  record(
    'SSS-QQ-TEST',
    'Settings QQ test uses current user config and configured API Base before binding',
    qqTest.response.ok
      && qqTest.json?.data?.ok === true
      && qqTest.json?.data?.status === 'token_ok_no_binding'
      && fakeQq.tokenRequests.length === 1
      && fakeQq.tokenRequests[0]?.body?.appId === `qq-settings-app-${runId}`
      && fakeQq.tokenRequests[0]?.body?.clientSecret === rawQqToken
      && !containsRawSecret(qqTest.json, rawQqToken),
    `status=${qqTest.json?.data?.status || 'missing'}; fakeTokenCalls=${fakeQq.tokenRequests.length}`,
  )

  const binding = await api('/api/settings/qq-bot/binding-code', cookie, { method: 'POST' })
  const bindingCode = binding.json?.data?.code || ''
  const bindingAccount = await findQqAccountByBindingCode(prisma, bindingCode)
  record(
    'SSS-QQ-BINDING-CODE',
    'Settings generates an active QQ binding code that resolves only to the current user account',
    binding.response.ok
      && /^GM-[A-Z0-9]{6}$/.test(bindingCode)
      && bindingAccount?.userId === user.id,
    `code=${bindingCode || 'missing'}; owner=${bindingAccount?.userId === user.id}`,
  )

  const reminderPayload = {
    rules: [
      { reminderType: 'morning_planning', channel: 'qq', schedule: '08:10', timezone: 'Asia/Shanghai', maxPerDay: 1, quietHours: '23:00-07:30', enabled: true },
      { reminderType: 'midday_check', channel: 'qq', schedule: '12:40', timezone: 'Asia/Shanghai', maxPerDay: 1, quietHours: '23:00-07:30', enabled: true },
      { reminderType: 'evening_review', channel: 'qq', schedule: '21:20', timezone: 'Asia/Shanghai', maxPerDay: 1, quietHours: '23:00-07:30', enabled: true },
    ],
  }
  const reminders = await api('/api/settings/reminders', cookie, {
    method: 'PUT',
    body: JSON.stringify(reminderPayload),
  })
  record(
    'SSS-REMINDERS-SAVE',
    'user can configure morning, midday and evening reminder rhythm from Settings',
    reminders.response.ok
      && Array.isArray(reminders.json?.data)
      && reminders.json.data.length === 3
      && reminders.json.data.every((rule) => rule.metadata?.source === 'settings_ui' && rule.channel === 'qq'),
    `status=${reminders.response.status}; rules=${reminders.json?.data?.length || 0}`,
  )

  const behavior = await api('/api/settings', cookie, {
    method: 'PUT',
    body: JSON.stringify({
      logs: { auto_write_checkin: true, auto_write_review: true },
      agent: { can_read_goals: true, can_read_logs: true, memory_enabled: true, require_confirm_external_actions: true },
      today: { heatmap_scope: 'year', low_energy_mode: true },
    }),
  })
  record(
    'SSS-BEHAVIOR-SAVE',
    'user can configure behavior controls without creating a second fake scheduler source',
    behavior.response.ok
      && behavior.json?.data?.logs?.auto_write_checkin === true
      && behavior.json?.data?.agent?.can_read_logs === true
      && behavior.json?.data?.today?.low_energy_mode === true
      && behavior.json?.data?.notifications?.max_daily_prompts === 2,
    `logs=${behavior.json?.data?.logs?.auto_write_checkin}; agentLogs=${behavior.json?.data?.agent?.can_read_logs}; max=${behavior.json?.data?.notifications?.max_daily_prompts}`,
  )

  const controlCenter = await api('/api/settings/control-center', cookie)
  const modelStatus = controlCenter.json?.data?.runtimeStatus?.model
  const qqStatus = controlCenter.json?.data?.runtimeStatus?.qq
  const reminderTypes = new Set((controlCenter.json?.data?.reminderRules || []).map((rule) => rule.reminderType))
  record(
    'SSS-CONTROL-CENTER-READY',
    'Settings Control Center reflects user-managed model, QQ and reminder configuration in one place',
    controlCenter.response.ok
      && modelStatus?.status === 'configured'
      && controlCenter.json?.data?.model?.model === modelData?.model
      && qqStatus?.status === 'configured'
      && ['morning_planning', 'midday_check', 'evening_review'].every((item) => reminderTypes.has(item))
      && !containsRawSecret(controlCenter.json, rawModelKey)
      && !containsRawSecret(controlCenter.json, rawQqToken),
    `model=${modelStatus?.status || 'missing'}; qq=${qqStatus?.status || 'missing'}; reminders=${reminderTypes.size}`,
  )

  const exported = await api('/api/settings/export', cookie)
  record(
    'SSS-EXPORT-REDACTION',
    'settings export includes configuration metadata but never leaks model or QQ raw secrets',
    exported.response.ok
      && !containsRawSecret(exported.json, rawModelKey)
      && !containsRawSecret(exported.json, rawQqToken)
      && Array.isArray(exported.json?.data?.models)
      && Array.isArray(exported.json?.data?.reminderRules),
    `models=${exported.json?.data?.models?.length || 0}; reminders=${exported.json?.data?.reminderRules?.length || 0}`,
  )

  const qqAccount = await prisma.integrationAccount.findFirst({ where: { userId: user.id, provider: 'qq_bot' } })
  const qqPermissions = qqAccount?.permissions || {}
  record(
    'SSS-QQ-SECRET-AT-REST',
    'QQ token is encrypted at rest under the current user',
    Boolean(qqPermissions.tokenRef?.startsWith?.('enc:v1:') && !JSON.stringify(qqPermissions).includes(rawQqToken)),
    `tokenRef=${qqPermissions.tokenRef?.slice?.(0, 6) || 'missing'}`,
  )
}

function toMarkdown() {
  const failed = results.filter((item) => !item.ok)
  return [
    '# Goal Mate Settings Self-service Verification',
    '',
    `- Time: ${new Date().toISOString()}`,
    `- Base URL: ${baseUrl}`,
    `- Test user: ${maskEmail(email)}`,
    `- Test data kept: ${keepData ? 'yes' : 'no'}`,
    `- Result: ${failed.length === 0 ? 'PASS' : 'FAIL'}`,
    '',
    '## Scope',
    '',
    'This report proves a clean user can configure model, QQ Bot, reminder rhythm and behavior controls through the same Web/API surfaces used by Settings. It uses local fake model and QQ endpoints, so it does not prove external DeepSeek balance or real QQ Gateway delivery.',
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
  record('SSS-RUNTIME', 'Settings self-service verifier completes without crashing', false, error instanceof Error ? error.message : String(error))
} finally {
  if (!keepData) {
    try {
      await cleanupUser()
      record('SSS-CLEANUP', 'temporary Settings self-service user and data are removed', true, 'cleanup completed')
    } catch (error) {
      record('SSS-CLEANUP', 'temporary Settings self-service user and data are removed', false, error instanceof Error ? error.message : String(error))
    }
  }
  if (fakeModel) await fakeModel.close()
  if (fakeQq) await fakeQq.close()
  await prisma.$disconnect()
}

const markdown = toMarkdown()
console.log(markdown)
if (shouldWrite) {
  writeFileSync(resolve(projectRoot, 'docs/plans/settings-self-service-last-run.md'), markdown)
}

if (results.some((result) => !result.ok)) {
  process.exitCode = 1
}
