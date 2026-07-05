import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PrismaClient } from '@prisma/client'
import { chatCompletionsUrl } from '../lib/model-endpoint.mjs'

const prisma = new PrismaClient()
const shouldWrite = process.argv.includes('--write')
const keepData = process.argv.includes('--keep-data')
const baseUrl = process.env.GOAL_MATE_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
const providerName = process.env.GOAL_MATE_LIVE_MODEL_PROVIDER || process.env.GOAL_MATE_MODEL_PROVIDER || 'B.AI'
const apiKey = process.env.GOAL_MATE_LIVE_MODEL_API_KEY || process.env.BAI_API_KEY || process.env.OPENAI_API_KEY || ''
const apiBase = String(process.env.GOAL_MATE_LIVE_MODEL_API_BASE || process.env.GOAL_MATE_MODEL_API_BASE || process.env.BAI_API_BASE || process.env.OPENAI_API_BASE || 'https://api.b.ai').replace(/\/+$/, '')
const modelName = process.env.GOAL_MATE_LIVE_MODEL_MODEL || process.env.GOAL_MATE_MODEL || process.env.OPENAI_MODEL || 'gpt-5-nano'
const scriptDir = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDir, '..', '..')
const runId = Date.now()
const email = process.env.GOAL_MATE_LIVE_MODEL_EMAIL || `live-model-${runId}@goalmate.local`
const password = process.env.GOAL_MATE_LIVE_MODEL_PASSWORD || 'live-model-pass-123'
const results = []

function record(id, purpose, ok, evidence = '') {
  results.push({ id, purpose, ok, evidence })
}

function maskEmail(value) {
  return value.replace(/^(.{3}).+@/, '$1...@')
}

function compact(value, max = 360) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max)}...` : text
}

function countQuestions(text) {
  return (String(text || '').match(/[？?]/g) || []).length
}

function looksLikeGoalMateSecretaryReply(text) {
  const reply = String(text || '').trim()
  if (!reply) return { ok: false, reason: 'empty' }
  if (/好的[，,]?我来|作为.*AI|以下是|总之|综上|希望.*帮助/u.test(reply)) return { ok: false, reason: 'ai_tone' }
  if (/加油|坚持|你可以的|不要放弃|严格执行|自律太差/u.test(reply)) return { ok: false, reason: 'generic_or_coercive' }
  if (/模型连接失败|模型调用失败|缺少模型|没有配置模型|missing_api_key|http_\d+/iu.test(reply)) return { ok: false, reason: 'model_error_reply' }
  if (countQuestions(reply) > 1) return { ok: false, reason: 'too_many_questions' }
  return { ok: true, reason: 'ok' }
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

async function run() {
  const health = await api('/api/health', '')
  record('LMA-HEALTH', 'local API is reachable before live model verification', health.response.ok, `GET /api/health status=${health.response.status}`)
  if (!health.response.ok) return

  if (!apiKey.trim()) {
    record('LMA-LIVE-KEY', 'live model verifier requires a real model API key supplied by environment only', false, 'missing GOAL_MATE_LIVE_MODEL_API_KEY, BAI_API_KEY or OPENAI_API_KEY')
    return
  }

  await cleanupUser()
  const signup = await authRequest('/api/auth/sign-up/email', { email, password, name: 'Live Model User' })
  const cookie = extractCookie(signup.response)
  const user = await prisma.user.findUnique({ where: { email } })
  record('LMA-AUTH', 'a clean user can register for live model verification', signup.response.ok && Boolean(user?.id), `user=${maskEmail(email)}`)
  if (!user) return

  const modelCreate = await api('/api/models', cookie, {
    method: 'POST',
    body: JSON.stringify({
      provider: providerName,
      model: modelName,
      apiBase,
      apiKey,
      usage: 'CHAT',
      isDefault: true,
      temperature: 0.2,
    }),
  })
  const modelData = modelCreate.json?.data
  const serializedModel = JSON.stringify(modelCreate.json || {})
  record(
    'LMA-SAVE-MODEL',
    'current user can save an encrypted live model key without response leaking the raw key',
    modelCreate.response.ok
      && modelData?.apiKeyConfigured === true
      && modelData?.apiKeySource === 'user_encrypted'
      && !serializedModel.includes(apiKey),
    `status=${modelCreate.response.status}; model=${modelData?.model || 'missing'}; source=${modelData?.apiKeySource || 'missing'}`,
  )

  const modelTest = await api('/api/settings/models/test', cookie, { method: 'POST' })
  const modelTestData = modelTest.json?.data
  record(
    'LMA-SETTINGS-TEST',
    'Settings model test uses the current user model configuration and reaches the provider successfully',
    modelTest.response.ok && modelTestData?.ok === true,
    `status=${modelTest.response.status}; ok=${modelTestData?.ok}; reason=${modelTestData?.reason || 'missing'}; provider=${modelTestData?.provider || 'missing'}; model=${modelTestData?.model || 'missing'}; message=${compact(modelTestData?.message, 180)}`,
  )
  if (!modelTestData?.ok) return

  const thread = await api('/api/agent/threads', cookie, {
    method: 'POST',
    body: JSON.stringify({ title: '真实模型连通性验证' }),
  })
  const threadId = thread.json?.data?.id
  record('LMA-THREAD', 'live model user can create an Agent thread', thread.response.ok && Boolean(threadId), `thread=${threadId || 'missing'}`)
  if (!threadId) return

  const prompt = '请用一句话回答：你在 Goal Mate 里负责什么？不要调用工具。'
  const message = await api(`/api/agent/threads/${threadId}/messages`, cookie, {
    method: 'POST',
    body: JSON.stringify({ content: prompt }),
  })
  const assistant = message.json?.data?.assistantMessage
  const reply = assistant?.content || ''
  const quality = looksLikeGoalMateSecretaryReply(reply)
  const structuredText = JSON.stringify(assistant?.structuredOutput || {})
  record(
    'LMA-AGENT-LIVE-REPLY',
    'Agent message path uses the saved user model and returns a usable secretary-style live reply',
    message.response.ok
      && Boolean(reply)
      && quality.ok
      && structuredText.includes(modelName)
      && !/missing_api_key|模型连接失败|模型调用失败/u.test(structuredText),
    `status=${message.response.status}; quality=${quality.reason}; questions=${countQuestions(reply)}; reply=${compact(reply)}`,
  )
}

function toMarkdown() {
  return [
    '# Goal Mate Live Model Agent Flow Verification',
    '',
    `- Time: ${new Date().toISOString()}`,
    `- Base URL: ${baseUrl}`,
    `- Test user: ${maskEmail(email)}`,
    `- Provider: ${providerName}`,
    `- Model: ${modelName}`,
    `- API Base: ${apiBase}`,
    `- Test data kept: ${keepData ? 'yes' : 'no'}`,
    '',
    'No API key is written to this report.',
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
  record('LMA-RUNTIME', 'live model Agent verifier completes without crashing', false, error instanceof Error ? error.message : String(error))
} finally {
  if (!keepData) {
    try {
      await cleanupUser()
      record('LMA-CLEANUP', 'temporary live model user and data are removed', true, 'cleanup completed')
    } catch (error) {
      record('LMA-CLEANUP', 'temporary live model user and data are removed', false, error instanceof Error ? error.message : String(error))
    }
  }
  await prisma.$disconnect()
}

const markdown = toMarkdown()
console.log(markdown)
if (shouldWrite) {
  writeFileSync(resolve(projectRoot, 'docs/plans/live-model-agent-flow-last-run.md'), markdown)
}

if (results.some((result) => !result.ok)) {
  process.exitCode = 1
}
