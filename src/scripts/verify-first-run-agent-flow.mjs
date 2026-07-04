import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const shouldWrite = process.argv.includes('--write')
const keepData = process.argv.includes('--keep-data')
const baseUrl = process.env.GOAL_MATE_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
const scriptDir = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDir, '..', '..')
const runId = Date.now()
const email = process.env.GOAL_MATE_FIRST_RUN_EMAIL || `first-run-${runId}@goalmate.local`
const modelEmail = process.env.GOAL_MATE_FIRST_RUN_MODEL_EMAIL || `first-run-model-${runId}@goalmate.local`
const password = process.env.GOAL_MATE_FIRST_RUN_PASSWORD || 'first-run-pass-123'
const results = []
let fakeModel = null

function record(id, purpose, ok, evidence = '') {
  results.push({ id, purpose, ok, evidence })
}

function maskEmail(value) {
  return value.replace(/^(.{3}).+@/, '$1...@')
}

async function cleanupUser() {
  await prisma.user.deleteMany({ where: { email: { in: [email, modelEmail] } } })
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
      const messages = Array.isArray(body?.messages) ? body.messages : []
      const systemPrompt = String(messages.find((message) => message.role === 'system')?.content || '')
      const userContent = String([...messages].reverse().find((message) => message.role === 'user')?.content || '')
      const isRouter = systemPrompt.includes('工具路由器')
      requests.push({ body, systemPrompt, userContent, isRouter })

      const actionTitle = `模型生成的首个行动 ${runId}`
      const content = isRouter
        ? JSON.stringify({
            toolName: 'goal.create_draft',
            confidence: 0.96,
            reason: '用户已经给出足够具体的首次目标，模型路由生成目标草案。',
            input: {
              title: `模型生成的首个目标 ${runId}`,
              rawInput: userContent,
              interpretedGoal: `用模型而不是本地关键词模板理解首次目标：${userContent}`,
              horizonStart: new Date().toISOString(),
              horizonEnd: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString(),
              purposeSummary: '验证配置模型后首次目标由模型路由生成。',
              successSignals: ['目标草案来自模型路由', 'Today 能接住模型给出的今日行动'],
              keyResults: [
                {
                  title: '完成一个真实可验收结果',
                  metricType: 'TEXT',
                  currentValue: '只有目标描述',
                  targetValue: '形成可演示结果',
                  progress: 0,
                  whyNecessary: '这是判断目标是否落地的直接证据。',
                },
                {
                  title: '形成每日反馈闭环',
                  metricType: 'TEXT',
                  currentValue: '未开始',
                  targetValue: '每天留下完成或未完成原因',
                  progress: 0,
                  whyNecessary: '没有反馈就无法持续调整下一步。',
                },
              ],
              necessaryConditions: [
                {
                  title: '成功标准和当前状态被模型识别',
                  type: 'HARD',
                  status: 'PARTIAL',
                  whyRequired: '首次目标不能只按关键词模板处理。',
                },
                {
                  title: '今天有一个可反馈的小步',
                  type: 'HARD',
                  status: 'PARTIAL',
                  whyRequired: 'Today 必须接住具体行动。',
                },
              ],
              stagePlans: [
                {
                  title: '模型澄清和启动',
                  stageGoal: '先生成目标草案和第一步行动。',
                  successSignals: ['目标草案已生成', '今日行动已生成'],
                  sortOrder: 0,
                },
                {
                  title: '执行和反馈',
                  stageGoal: '根据每日反馈调整下一步。',
                  successSignals: ['有 Check-in', '有日志证据'],
                  sortOrder: 1,
                },
              ],
              dailyAction: {
                title: actionTitle,
                doneWhen: '完成一个能证明目标进入执行的小证据，并反馈实际结果。',
                minimumStep: '先写下今天最小可推进的一步。',
                fallbackAction: '状态差时，只记录一个当前事实。',
                estimatedMinutes: 12,
                checkinQuestion: '这个模型生成的首个行动完成了吗？',
              },
            },
          })
        : `模型已读取首次目标。下一步只保留一个可反馈动作。${runId}`

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
  record('FRA-HEALTH', 'local API is reachable before first-run verification', health.response.ok, `GET /api/health status=${health.response.status}`)
  if (!health.response.ok) return

  await cleanupUser()
  const signup = await authRequest('/api/auth/sign-up/email', { email, password, name: 'First Run User' })
  const cookie = extractCookie(signup.response)
  const user = await prisma.user.findUnique({ where: { email } })
  record('FRA-AUTH', 'a clean first-run user can register and get a session', signup.response.ok && Boolean(user?.id), `user=${maskEmail(email)}`)
  if (!user) return

  const initialGoals = await prisma.goal.count({ where: { userId: user.id } })
  const initialLogs = await prisma.markdownDocument.count({ where: { userId: user.id } })
  record('FRA-CLEAN-WORKSPACE', 'new user starts without goal or markdown business data', initialGoals === 0 && initialLogs === 0, `goals=${initialGoals}; md=${initialLogs}`)

  const thread = await api('/api/agent/threads', cookie, {
    method: 'POST',
    body: JSON.stringify({ title: '首次目标输入' }),
  })
  const threadId = thread.json?.data?.id
  record('FRA-THREAD', 'first-run user can create an Agent thread', thread.response.ok && Boolean(threadId), `thread=${threadId || 'missing'}`)
  if (!threadId) return

  const vague = await api(`/api/agent/threads/${threadId}/messages`, cookie, {
    method: 'POST',
    body: JSON.stringify({ content: '我想变好' }),
  })
  const vagueAssistant = vague.json?.data?.assistantMessage
  const goalsAfterVague = await prisma.goal.count({ where: { userId: user.id } })
  record(
    'FRA-VAGUE-CLARIFY',
    'vague first goal input asks one key clarification and does not create fake goal data',
    vague.response.ok && vagueAssistant?.structuredOutputType === 'first_goal_clarification' && goalsAfterVague === 0,
    `type=${vagueAssistant?.structuredOutputType || 'missing'}; goals=${goalsAfterVague}; reply=${String(vagueAssistant?.content || '').slice(0, 80)}`,
  )

  const naturalGoal = [
    '我想在30天内完成一个可以上线演示的小产品，',
    '现在只有一个想法和一点代码，最大问题是容易拖延，',
    '希望系统每天告诉我下一步具体做什么。',
  ].join('')
  const draft = await api(`/api/agent/threads/${threadId}/messages`, cookie, {
    method: 'POST',
    body: JSON.stringify({ content: naturalGoal }),
  })
  const draftAssistant = draft.json?.data?.assistantMessage
  const structured = draftAssistant?.structuredOutput || {}
  const draftResult = structured?.tool_result?.result
  const activationActionId = structured?.activation_result?.action?.id
  record(
    'FRA-NATURAL-DRAFT',
    'specific natural first goal input creates goal scaffold and pending activation',
    draft.response.ok
      && draftAssistant?.structuredOutputType === 'agent_tool_result'
      && draftResult?.goal?.id
      && draftResult?.keyResults?.length >= 3
      && draftResult?.conditions?.length >= 3
      && draftResult?.stagePlans?.length >= 3
      && draftResult?.dailyAction?.id
      && structured?.activation_result?.needsConfirmation === true
      && activationActionId,
    `goal=${draftResult?.goal?.id || 'missing'}; kr=${draftResult?.keyResults?.length || 0}; conditions=${draftResult?.conditions?.length || 0}; stages=${draftResult?.stagePlans?.length || 0}; action=${draftResult?.dailyAction?.id || 'missing'}; activation=${activationActionId || 'missing'}`,
  )

  if (!activationActionId) return
  const confirm = await api(`/api/agent/tools/actions/${activationActionId}/confirm`, cookie, { method: 'POST' })
  const activationResult = confirm.json?.data?.execution?.result
  record(
    'FRA-ACTIVATE',
    'confirming the pending activation makes the drafted goal current and confirms its reasoning card',
    confirm.response.ok
      && confirm.json?.data?.confirmed === true
      && activationResult?.goal?.status === 'ACTIVE'
      && activationResult?.goal?.isCurrentFocus === true
      && activationResult?.reasoningCard?.status === 'CONFIRMED',
    `status=${activationResult?.goal?.status || 'missing'}; focus=${activationResult?.goal?.isCurrentFocus}; card=${activationResult?.reasoningCard?.status || 'missing'}`,
  )

  const today = await api('/api/today', cookie)
  record(
    'FRA-TODAY',
    'Today picks up the activated first goal and exposes one next action',
    today.response.ok && today.json?.data?.goal?.id === draftResult?.goal?.id && today.json?.data?.action?.id,
    `goal=${today.json?.data?.goal?.id || 'missing'}; action=${today.json?.data?.action?.title || 'missing'}`,
  )

  const markdown = await prisma.markdownDocument.findFirst({ where: { userId: user.id, type: 'GOAL' }, orderBy: { createdAt: 'desc' } })
  record(
    'FRA-GOAL-MARKDOWN',
    'first goal draft writes a Markdown goal document for Logs/Agent context',
    Boolean(markdown?.path && markdown.content.includes(draftResult?.goal?.title || '')),
    markdown?.path || 'missing',
  )

  fakeModel = await startFakeModelServer()
  const modelSignup = await authRequest('/api/auth/sign-up/email', { email: modelEmail, password, name: 'First Run Model User' })
  const modelCookie = extractCookie(modelSignup.response)
  const modelUser = await prisma.user.findUnique({ where: { email: modelEmail } })
  record('FRA-MODEL-AUTH', 'a clean first-run user with a configured model can register and get a session', modelSignup.response.ok && Boolean(modelUser?.id), `user=${maskEmail(modelEmail)}`)
  if (!modelUser) return

  await prisma.modelConfig.create({
    data: {
      userId: modelUser.id,
      provider: 'DeepSeek',
      model: 'fake-first-run-model',
      apiBase: fakeModel.apiBase,
      apiKeyRef: `fixture-first-run-model-key-${runId}`,
      usage: 'CHAT',
      isDefault: true,
      temperature: 0.2,
    },
  })

  const modelThread = await api('/api/agent/threads', modelCookie, {
    method: 'POST',
    body: JSON.stringify({ title: '模型首次目标输入' }),
  })
  const modelThreadId = modelThread.json?.data?.id
  record('FRA-MODEL-THREAD', 'model-configured first-run user can create an Agent thread', modelThread.response.ok && Boolean(modelThreadId), `thread=${modelThreadId || 'missing'}`)
  if (!modelThreadId) return

  const modelGoalInput = [
    '我想在45天内完成一个可以公开演示的个人项目，',
    '现在只有想法和零散代码，最大问题是每次都不知道下一步该做什么。',
  ].join('')
  const modelDraft = await api(`/api/agent/threads/${modelThreadId}/messages`, modelCookie, {
    method: 'POST',
    body: JSON.stringify({ content: modelGoalInput }),
  })
  const modelAssistant = modelDraft.json?.data?.assistantMessage
  const modelStructured = modelAssistant?.structuredOutput || {}
  const modelDraftResult = modelStructured?.tool_result?.result
  const routerCalls = fakeModel.requests.filter((request) => request.isRouter).length
  const modelActionTitle = modelDraftResult?.dailyAction?.title || ''
  record(
    'FRA-MODEL-FIRST-GOAL-ROUTER',
    'configured model gets first chance to route a concrete first goal instead of hard-coded local scaffold taking over',
    modelDraft.response.ok
      && routerCalls > 0
      && modelAssistant?.structuredOutputType === 'agent_tool_result'
      && modelDraftResult?.goal?.title?.includes(`模型生成的首个目标 ${runId}`)
      && modelActionTitle === `模型生成的首个行动 ${runId}`,
    `routerCalls=${routerCalls}; goal=${modelDraftResult?.goal?.title || 'missing'}; action=${modelActionTitle || 'missing'}`,
  )
}

function toMarkdown() {
  return [
    '# Goal Mate First-run Agent Flow Verification',
    '',
    `- Time: ${new Date().toISOString()}`,
    `- Base URL: ${baseUrl}`,
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
  record('FRA-RUNTIME', 'first-run Agent verifier completes without crashing', false, error instanceof Error ? error.message : String(error))
} finally {
  if (fakeModel) {
    try {
      await fakeModel.close()
    } catch {
      // ignore verifier cleanup errors
    }
  }
  if (!keepData) {
    try {
      await cleanupUser()
      record('FRA-CLEANUP', 'temporary first-run user and data are removed', true, 'cleanup completed')
    } catch (error) {
      record('FRA-CLEANUP', 'temporary first-run user and data are removed', false, error instanceof Error ? error.message : String(error))
    }
  }
  await prisma.$disconnect()
}

const markdown = toMarkdown()
console.log(markdown)
if (shouldWrite) {
  writeFileSync(resolve(projectRoot, 'docs/plans/first-run-agent-flow-last-run.md'), markdown)
}

if (results.some((result) => !result.ok)) {
  process.exitCode = 1
}
