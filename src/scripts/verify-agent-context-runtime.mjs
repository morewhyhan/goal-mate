import { createServer } from 'node:http'
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
const email = process.env.GOAL_MATE_AGENT_CONTEXT_EMAIL || `agent-context-${runId}@goalmate.local`
const otherEmail = process.env.GOAL_MATE_AGENT_CONTEXT_OTHER_EMAIL || `agent-context-other-${runId}@goalmate.local`
const password = process.env.GOAL_MATE_AGENT_CONTEXT_PASSWORD || 'agent-context-pass-123'
const results = []

const defaultSettings = {
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
    require_confirm_external_actions: true,
  },
  notifications: {
    morning_checkin_time: '08:30',
    evening_review_time: '21:30',
    quiet_hours: '23:00-07:30',
    channel: 'web',
    max_daily_prompts: 2,
  },
  dataPrivacy: { redact_secrets: true, export_markdown: true, local_first_mode: false },
}

let fakeModel = null

function record(id, purpose, ok, evidence = '') {
  results.push({ id, purpose, ok, evidence })
}

function maskEmail(value) {
  return value.replace(/^(.{3}).+@/, '$1...@')
}

function compact(value, max = 260) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return text.length <= max ? text : `${text.slice(0, max)}...`
}

async function cleanupUsers() {
  await prisma.user.deleteMany({ where: { email: { in: [email, otherEmail] } } })
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

async function startFakeModelServer() {
  const requests = []
  const server = createServer((req, res) => {
    if (req.method !== 'POST' || !String(req.url || '').includes('/chat/completions')) {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'not_found' }))
      return
    }

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
      const systemPrompt = Array.isArray(body?.messages)
        ? String(body.messages.find((message) => message.role === 'system')?.content || '')
        : ''
      requests.push({ url: req.url, body, systemPrompt })
      const content = systemPrompt.includes('工具路由器')
        ? '{"toolName":null,"input":{},"confidence":0,"reason":"不需要工具"}'
        : `收到。${runId} 的下一步只保留一个最小动作。`
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        choices: [{ message: { role: 'assistant', content } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }))
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

function latestRuntimePrompt() {
  const request = [...(fakeModel?.requests || [])].reverse().find((item) => item.systemPrompt.includes('Prompt-Version: goal-mate-agent-system'))
  return request?.systemPrompt || ''
}

async function upsertSettings(userId, agentSettings = {}) {
  await prisma.userSetting.upsert({
    where: { userId },
    update: {
      ...defaultSettings,
      agent: { ...defaultSettings.agent, ...agentSettings },
    },
    create: {
      userId,
      ...defaultSettings,
      agent: { ...defaultSettings.agent, ...agentSettings },
    },
  })
}

async function seedRuntimeContext(user, otherUser) {
  const now = new Date()
  const horizonEnd = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 21)
  const goalMarker = `ACR_GOAL_${runId}`
  const currentLogMarker = `ACR_CURRENT_LOG_${runId}`
  const otherLogMarker = `ACR_OTHER_USER_LOG_${runId}`
  const sharedSearchMarker = `ACR_SHARED_SEARCH_${runId}`
  const metaClaimMarker = `ACR_META_CLAIM_${runId}`
  const nextThinkingMarker = `ACR_NEXT_THINKING_${runId}`
  const memoryMarker = `ACR_MEMORY_${runId}`

  await upsertSettings(user.id)

  await prisma.modelConfig.create({
    data: {
      userId: user.id,
      provider: 'DeepSeek',
      model: 'fake-context-model',
      apiBase: fakeModel.apiBase,
      apiKeyRef: `sk-test-agent-context-${runId}`,
      usage: 'CHAT',
      isDefault: true,
      temperature: 0.2,
    },
  })

  const goal = await prisma.goal.create({
    data: {
      userId: user.id,
      title: `运行时上下文目标 ${goalMarker}`,
      rawInput: `我要验证 Agent 是否真的读取当前用户上下文 ${goalMarker}`,
      interpretedGoal: `把当前用户的目标、日志和元认知安全注入 Agent，而不串到其他用户 ${goalMarker}`,
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
      title: `当前缺口必须能被 Agent 看见 ${goalMarker}`,
      type: 'HARD',
      status: 'PARTIAL',
      whyRequired: `如果 Agent 看不到 ${goalMarker}，用户就会感觉它什么都不知道。`,
      evidence: [`seed:${goalMarker}`],
    },
  })

  const stage = await prisma.stagePlan.create({
    data: {
      userId: user.id,
      goalId: goal.id,
      title: `验证运行时上下文阶段 ${goalMarker}`,
      stageGoal: `让模型请求中出现当前用户上下文 ${goalMarker}`,
      startDate: now,
      endDate: horizonEnd,
      linkedConditionIds: [condition.id],
      successSignals: [`模型请求包含目标标记 ${goalMarker}`, `模型请求包含当前行动和阶段计划`],
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
      title: `检查 Agent 上下文 ${goalMarker}`,
      reason: `证明 Agent 不是空聊，而是在读系统状态 ${goalMarker}`,
      doneWhen: `捕获到的 system prompt 包含当前用户 Goal、Markdown 和 Meta-Cognition。`,
      minimumStep: `发送一条普通对话并检查 fake model 收到的请求。`,
      fallbackAction: `如果上下文缺失，先修 Runtime 注入链路。`,
      checkinQuestion: `Agent 这次是否真的读到了当前用户上下文？`,
      status: 'PLANNED',
    },
  })

  await prisma.goalReasoningCard.create({
    data: {
      userId: user.id,
      goalId: goal.id,
      version: 1,
      purposeSummary: `运行时必须让 Agent 看到真实系统事实 ${goalMarker}`,
      successSignals: [`system_prompt_has_goal:${goalMarker}`, `system_prompt_has_action:${goalMarker}`],
      sufficientConditionSet: `当前用户 Goal、KR、条件、行动、Markdown、元认知都能进入 prompt。`,
      recommendedFocus: `优先证明当前用户上下文注入和跨用户隔离 ${goalMarker}`,
      confidenceScore: 0.8,
      evidence: [`seeded-by:verify-agent-context-runtime`, goalMarker],
      status: 'CONFIRMED',
    },
  })

  await prisma.keyResult.create({
    data: {
      userId: user.id,
      goalId: goal.id,
      title: `模型请求包含当前用户上下文 ${goalMarker}`,
      metricType: 'TEXT',
      currentValue: '待验证',
      targetValue: '已捕获并通过断言',
      progress: 0.3,
      status: 'ACTIVE',
      whyNecessary: `没有这条 KR，Agent 对话只是看起来专业，不能证明它理解系统状态。`,
    },
  })

  const checkin = await prisma.checkin.create({
    data: {
      userId: user.id,
      goalId: goal.id,
      actionId: action.id,
      result: 'PARTIAL',
      reasonCategory: 'ABILITY',
      userFeedback: `目前只差运行时证据 ${goalMarker}`,
      adjustment: `先补 fake model 捕获验证。`,
    },
  })

  await prisma.diagnosis.create({
    data: {
      userId: user.id,
      goalId: goal.id,
      actionId: action.id,
      checkinId: checkin.id,
      category: 'PATH',
      evidence: `静态契约不能证明模型请求中真的有上下文 ${goalMarker}`,
      adjustmentType: 'REBUILD_PATH',
      nextQuestion: `运行时请求里具体缺哪一类上下文？`,
      proposedNextAction: `捕获模型请求并断言当前用户数据。`,
    },
  })

  await prisma.review.create({
    data: {
      userId: user.id,
      goalId: goal.id,
      type: 'DAILY',
      periodStart: now,
      periodEnd: now,
      progressSummary: `已准备运行时验证数据 ${goalMarker}`,
      conditionChanges: [{ conditionId: condition.id, status: 'partial' }],
      blockerSummary: `缺少 prompt 级别证据。`,
      nextFocus: `检查 fake model 收到的 system prompt。`,
    },
  })

  await prisma.markdownDocument.create({
    data: {
      userId: user.id,
      type: 'DAY',
      title: `Agent Runtime Context Log ${runId}`,
      path: `logs/runtime-context/${runId}/today.md`,
      content: [
        '# Runtime Context Log',
        '',
        `当前用户日志标记：${currentLogMarker}`,
        `共享检索标记：${sharedSearchMarker}`,
        `这段内容必须只出现在当前用户的 Agent prompt 中。`,
      ].join('\n'),
      source: 'USER',
      linkedGoalIds: [goal.id],
      linkedActionIds: [action.id],
      frontmatter: { runId, marker: currentLogMarker },
    },
  })

  await prisma.markdownDocument.create({
    data: {
      userId: user.id,
      type: 'SYSTEM',
      title: `Meta-Cognition ${goal.id}`,
      path: `system/meta-cognition/${goal.id}.md`,
      content: [
        '# Meta-Cognition',
        '',
        `- ${metaClaimMarker}`,
        `- ${nextThinkingMarker}`,
      ].join('\n'),
      source: 'SYSTEM',
      linkedGoalIds: [goal.id],
      linkedActionIds: [],
      frontmatter: {
        kind: 'meta_cognition',
        hypotheses: [{
          id: `acr-hypothesis-${runId}`,
          claim: `运行时必须优先验证上下文注入 ${metaClaimMarker}`,
          hypothesis: `Agent 如果没有读取当前用户上下文，就会给出空泛回复。`,
          scope: { userId: user.id, goalId: goal.id, category: 'PATH', source: 'verify-agent-context-runtime' },
          evidence: [`seed:${metaClaimMarker}`],
          causal_explanation: '上下文缺失会导致模型只能按通用提示词回答。',
          decision_impact: '下一次 Agent 回复必须先引用当前系统事实。',
          verification_signal: `prompt 中出现 ${metaClaimMarker}`,
          confidence: 0.8,
          lifecycle_status: 'active',
          policy_delta: {
            target: 'agent_context_policy',
            increase: ['cite_current_goal', 'cite_relevant_log'],
            decrease: ['generic_reply'],
            verification_signal: `prompt 中出现 ${metaClaimMarker}`,
          },
          ai_self_reflection: {
            next_thinking_rule: `先检查当前用户上下文是否完整 ${nextThinkingMarker}`,
          },
        }],
      },
    },
  })

  await prisma.markdownDocument.create({
    data: {
      userId: otherUser.id,
      type: 'DAY',
      title: `Other User Runtime Context Log ${runId}`,
      path: `logs/runtime-context/${runId}/other-user.md`,
      content: [
        '# Other User Log',
        '',
        `其他用户日志标记：${otherLogMarker}`,
        `共享检索标记：${sharedSearchMarker}`,
        '如果这个标记进入当前用户 prompt，说明用户隔离失败。',
      ].join('\n'),
      source: 'USER',
      linkedGoalIds: [],
      linkedActionIds: [],
      frontmatter: { runId, marker: otherLogMarker },
    },
  })

  const thread = await prisma.agentThread.create({
    data: {
      userId: user.id,
      goalId: goal.id,
      title: `运行时上下文验证 ${runId}`,
      status: 'ACTIVE',
    },
  })

  await prisma.agentMessage.create({
    data: {
      userId: user.id,
      threadId: thread.id,
      role: 'ASSISTANT',
      content: `上一轮已记录：${memoryMarker}`,
    },
  })

  return {
    goal,
    thread,
    goalMarker,
    currentLogMarker,
    otherLogMarker,
    sharedSearchMarker,
    metaClaimMarker,
    nextThinkingMarker,
    memoryMarker,
  }
}

async function run() {
  const health = await api('/api/health', '')
  record('ACR-HEALTH', 'local API is reachable before Agent context runtime verification', health.response.ok, `GET /api/health status=${health.response.status}`)
  if (!health.response.ok) return

  await cleanupUsers()
  const signup = await authRequest('/api/auth/sign-up/email', { email, password, name: 'Agent Context User' })
  const cookie = extractCookie(signup.response)
  const otherSignup = await authRequest('/api/auth/sign-up/email', { email: otherEmail, password, name: 'Other Context User' })
  const user = await prisma.user.findUnique({ where: { email } })
  const otherUser = await prisma.user.findUnique({ where: { email: otherEmail } })
  record(
    'ACR-AUTH',
    'clean test users can register and current user receives a session',
    signup.response.ok && otherSignup.response.ok && Boolean(cookie) && Boolean(user?.id) && Boolean(otherUser?.id),
    `user=${maskEmail(email)}; other=${maskEmail(otherEmail)}`,
  )
  if (!user || !otherUser) return

  fakeModel = await startFakeModelServer()
  const seeded = await seedRuntimeContext(user, otherUser)
  record(
    'ACR-SEED',
    'current user has goal, action, markdown log, meta-cognition and model config; other user has a conflicting log marker',
    Boolean(seeded.goal?.id && seeded.thread?.id && fakeModel.apiBase),
    `goal=${seeded.goal.id}; thread=${seeded.thread.id}; fakeModel=${fakeModel.apiBase}`,
  )

  const message = await api(`/api/agent/threads/${seeded.thread.id}/messages`, cookie, {
    method: 'POST',
    body: JSON.stringify({ content: `请结合 ${seeded.sharedSearchMarker} 判断我现在下一步。` }),
  })
  const runtimePrompt = latestRuntimePrompt()
  const assistantMessage = message.json?.data?.assistantMessage
  record(
    'ACR-CONTEXT-INJECTED',
    'model runtime prompt receives current user Goal, KR/action context, Markdown log and conversation memory',
    message.response.ok
      && runtimePrompt.includes(seeded.goalMarker)
      && runtimePrompt.includes(seeded.currentLogMarker)
      && runtimePrompt.includes(seeded.memoryMarker)
      && assistantMessage?.structuredOutput?.context_policy?.can_read_goals === true
      && assistantMessage?.structuredOutput?.context_policy?.can_read_logs === true,
    `status=${message.response.status}; prompt=${compact(runtimePrompt)}; calls=${fakeModel.requests.length}`,
  )
  record(
    'ACR-META-COGNITION',
    'model runtime prompt receives active meta-cognition and AI next thinking rule for the current goal',
    runtimePrompt.includes(seeded.metaClaimMarker) && runtimePrompt.includes(seeded.nextThinkingMarker),
    `meta=${seeded.metaClaimMarker}; next=${seeded.nextThinkingMarker}`,
  )
  record(
    'ACR-USER-ISOLATION',
    'current user prompt does not leak another user Markdown document even when both documents share the same search marker',
    runtimePrompt.includes(seeded.currentLogMarker) && !runtimePrompt.includes(seeded.otherLogMarker),
    `current=${runtimePrompt.includes(seeded.currentLogMarker)}; other=${runtimePrompt.includes(seeded.otherLogMarker)}`,
  )

  await upsertSettings(user.id, { can_read_logs: false })
  const permissionThread = await prisma.agentThread.create({
    data: {
      userId: user.id,
      goalId: seeded.goal.id,
      title: `读取权限关闭验证 ${runId}`,
      status: 'ACTIVE',
    },
  })
  const permissionMessage = await api(`/api/agent/threads/${permissionThread.id}/messages`, cookie, {
    method: 'POST',
    body: JSON.stringify({ content: '权限边界测试，请正常回答。' }),
  })
  const permissionPrompt = latestRuntimePrompt()
  const permissionAssistant = permissionMessage.json?.data?.assistantMessage
  record(
    'ACR-LOG-PERMISSION',
    'turning off Agent Logs permission removes Markdown log content from runtime prompt and exposes the disabled policy',
    permissionMessage.response.ok
      && permissionPrompt.includes('Settings 已关闭 Agent 读取 Logs')
      && !permissionPrompt.includes(seeded.currentLogMarker)
      && !permissionPrompt.includes(seeded.otherLogMarker)
      && permissionAssistant?.structuredOutput?.context_policy?.can_read_logs === false,
    `status=${permissionMessage.response.status}; logsPolicy=${permissionAssistant?.structuredOutput?.context_policy?.can_read_logs}; prompt=${compact(permissionPrompt)}`,
  )
}

function toMarkdown() {
  return [
    '# Goal Mate Agent Context Runtime Verification',
    '',
    `- Time: ${new Date().toISOString()}`,
    `- Base URL: ${baseUrl}`,
    `- Test user: ${maskEmail(email)}`,
    `- Other user: ${maskEmail(otherEmail)}`,
    `- Test data kept: ${keepData ? 'yes' : 'no'}`,
    `- Fake model calls: ${fakeModel?.requests?.length || 0}`,
    '',
    '## Scope',
    '',
    'This report captures the actual chat-completions request sent by the Web Agent runtime. It proves current-user Goal, Markdown Log, Meta-Cognition and memory context can reach the model prompt, and that Logs permission plus user isolation are respected. It uses a local fake model server, so it does not prove external model provider quality.',
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
  record('ACR-RUNTIME', 'Agent context runtime verifier completes without crashing', false, error instanceof Error ? error.message : String(error))
} finally {
  if (!keepData) {
    try {
      await cleanupUsers()
      record('ACR-CLEANUP', 'temporary users and runtime context data are removed', true, 'cleanup completed')
    } catch (error) {
      record('ACR-CLEANUP', 'temporary users and runtime context data are removed', false, error instanceof Error ? error.message : String(error))
    }
  }
  if (fakeModel) {
    try {
      await fakeModel.close()
    } catch {
      // ignore close errors in verifier cleanup
    }
  }
  await prisma.$disconnect()
}

const markdown = toMarkdown()
console.log(markdown)
if (shouldWrite) {
  writeFileSync(resolve(projectRoot, 'docs/plans/agent-context-runtime-last-run.md'), markdown)
}

if (results.some((result) => !result.ok)) {
  process.exitCode = 1
}
