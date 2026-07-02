import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { spawn, spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'

const shouldWrite = process.argv.includes('--write')
const shouldPrepareAuth = process.argv.includes('--prepare-auth')
const requireAuth = process.argv.includes('--require-auth')
const baseUrl = process.env.GOAL_MATE_BASE_URL || (shouldPrepareAuth || requireAuth ? 'http://localhost:3000' : 'http://127.0.0.1:3000')
const authOrigin = process.env.BETTER_AUTH_URL || 'http://localhost:3000'
let cookieHeader = process.env.GOAL_MATE_COOKIE || ''
const browserOverride = process.env.GOAL_MATE_BROWSER_PATH || ''
const scriptDir = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(scriptDir, '..')
const projectRoot = resolve(appRoot, '..')
const artifactDir = resolve(projectRoot, '.artifacts/browser-smoke')
const runId = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-')
const runDir = resolve(artifactDir, runId)
const debugPort = Number(process.env.GOAL_MATE_BROWSER_DEBUG_PORT || 9222 + Math.floor(Math.random() * 1000))
const authEmail = process.env.GOAL_MATE_DASHBOARD_BROWSER_EMAIL || 'dashboard-browser@goalmate.local'
const authPassword = process.env.GOAL_MATE_DASHBOARD_BROWSER_PASSWORD || 'dashboard-browser-pass-123'
const authName = process.env.GOAL_MATE_DASHBOARD_BROWSER_NAME || 'Dashboard Browser User'

const pages = [
  {
    id: 'today',
    path: '/dashboard/today',
    requiredText: ['年度推进热力图'],
    authenticatedText: ['走路 2 小时，并同步背单词', '完成 120 分钟步行'],
    evaluate: pageCheckExpression(`
      const cells = [...document.querySelectorAll('[title^="week "]')]
      const sample = cells[0]?.getBoundingClientRect()
      const scopeButtons = ['Year', 'Quarter', 'Month', 'Week'].every((label) => bodyText.includes(label))
      const squareCell = sample ? Math.abs(sample.width - sample.height) <= 1 : false
      return {
        ok: cells.length >= 300 && squareCell && scopeButtons,
        evidence: 'cells=' + cells.length + '; square=' + squareCell + '; scopes=' + scopeButtons,
      }
    `),
  },
  {
    id: 'goals',
    path: '/dashboard/goals',
    requiredText: ['Key Results', 'Conditions', 'Cycle Plan'],
    authenticatedText: ['2026 暑假主目标推进', '体重从 165 斤降到接近 130 斤'],
    evaluate: pageCheckExpression(`
      const appMain = document.querySelector('main')
      const text = appMain?.innerText || bodyText
      const inputs = appMain ? appMain.querySelectorAll('input, textarea, select').length : 0
      const forbiddenOps = /删除目标|编辑目标|拖拽|Delete Goal|Edit Goal/.test(text)
      return {
        ok: inputs === 0 && !forbiddenOps,
        evidence: 'inputs=' + inputs + '; forbiddenOps=' + forbiddenOps,
      }
    `),
  },
  {
    id: 'logs',
    path: '/dashboard/logs',
    requiredText: ['Logs', 'Markdown'],
    authenticatedText: ['2026-07-01.md'],
    evaluate: pageCheckExpression(`
      const textarea = document.querySelector('textarea')
      const saveButton = [...document.querySelectorAll('button')].find((button) => button.innerText.includes('保存'))
      const textareaRect = textarea?.getBoundingClientRect()
      const saveRect = saveButton?.getBoundingClientRect()
      const textareaVisible = Boolean(textareaRect && textareaRect.width > 300 && textareaRect.height > 240)
      const saveVisible = Boolean(saveRect && saveRect.top >= 0 && saveRect.bottom <= window.innerHeight)
      return {
        ok: Boolean(textarea) && Boolean(saveButton) && textareaVisible && saveVisible,
        evidence: 'textarea=' + Boolean(textarea) + '; textareaVisible=' + textareaVisible + '; saveVisible=' + saveVisible,
      }
    `),
  },
  {
    id: 'agent',
    path: '/dashboard/agent',
    requiredText: ['Agent', '对话', '发送'],
    authenticatedText: ['暑假主目标拆解', '我已经读取当前主目标'],
    evaluate: pageCheckExpression(`
      const textarea = document.querySelector('textarea')
      const sendButton = [...document.querySelectorAll('button')].find((button) => button.innerText.includes('发送'))
      const textareaRect = textarea?.getBoundingClientRect()
      const sendRect = sendButton?.getBoundingClientRect()
      const inputVisible = Boolean(textareaRect && textareaRect.bottom <= window.innerHeight && textareaRect.top >= 0 && textareaRect.height >= 60)
      const sendVisible = Boolean(sendRect && sendRect.bottom <= window.innerHeight && sendRect.top >= 0)
      const pageScroll = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) - window.innerHeight
      return {
        ok: Boolean(textarea) && Boolean(sendButton) && inputVisible && sendVisible && pageScroll <= 120,
        evidence: 'textarea=' + Boolean(textarea) + '; inputVisible=' + inputVisible + '; sendVisible=' + sendVisible + '; pageScroll=' + pageScroll,
      }
    `),
  },
  {
    id: 'settings',
    path: '/dashboard/settings',
    requiredText: ['Settings', '模型配置', '消息通道', '主动推进节奏', '工具权限与审计', '数据与隐私'],
    authenticatedText: ['deepseek-v4-flash', 'DeepSeek'],
    evaluate: pageCheckExpression(`
      const inputs = [...document.querySelectorAll('input')]
      const buttons = [...document.querySelectorAll('button')]
      const inputValues = inputs.map((input) => input.value)
      const hasModelFields = inputValues.includes('DeepSeek') && inputValues.includes('deepseek-v4-flash') && inputValues.includes('https://api.deepseek.com')
      const hasActionButtons = ['保存模型', '测试连接', '保存提醒', '导出数据'].every((label) => buttons.some((button) => button.innerText.includes(label)))
      const overflowingInputs = inputs.filter((input) => {
        const rect = input.getBoundingClientRect()
        return rect.right > window.innerWidth + 2 || rect.left < -2
      }).length
      return {
        ok: hasModelFields && hasActionButtons && overflowingInputs === 0,
        evidence: 'modelFields=' + hasModelFields + '; actionButtons=' + hasActionButtons + '; overflowingInputs=' + overflowingInputs,
      }
    `),
  },
]

const results = []

function record(id, purpose, ok, evidence = '') {
  results.push({ id, purpose, ok, evidence })
}

async function authRequest(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: authOrigin,
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
  if (!match) throw new Error('Missing goal-mate.session_token in Set-Cookie.')
  return match[0]
}

function maskEmail(email) {
  const [name, domain] = email.split('@')
  if (!domain) return '[redacted-email]'
  return `${name.slice(0, 3)}...@${domain}`
}

async function signUpOrSignIn() {
  const signUp = await authRequest('/api/auth/sign-up/email', { email: authEmail, password: authPassword, name: authName })
  if (signUp.response.ok) return { cookie: extractCookie(signUp.response), mode: 'sign-up' }

  const signIn = await authRequest('/api/auth/sign-in/email', { email: authEmail, password: authPassword })
  if (signIn.response.ok) return { cookie: extractCookie(signIn.response), mode: 'sign-in' }

  throw new Error(`Could not sign up or sign in dashboard browser user. sign-up=${signUp.response.status}; sign-in=${signIn.response.status}`)
}

function seedAuthenticatedData() {
  const result = spawnSync(process.execPath, ['scripts/seed-goal-mate.mjs'], {
    cwd: appRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      GOAL_MATE_SEED_EMAIL: authEmail,
      GOAL_MATE_SEED_NAME: authName,
    },
  })
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'seed-goal-mate failed').slice(0, 600))
  }
  return (result.stdout || '').trim().split('\n').pop() || 'seed completed'
}

async function prepareAuthenticatedSession() {
  if (!shouldPrepareAuth) return
  const auth = await signUpOrSignIn()
  const seedEvidence = seedAuthenticatedData()
  cookieHeader = auth.cookie
  record('BROWSER-AUTH-PREPARE', 'authenticated browser smoke prepares a real seeded user without writing the cookie to reports', true, `mode=${auth.mode}; user=${maskEmail(authEmail)}; ${seedEvidence}`)
}

function pageCheckExpression(extraChecks) {
  return `(() => {
    const bodyText = document.body?.innerText || ''
    const width = window.innerWidth
    const scrollWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)
    const horizontalOverflow = scrollWidth - width
    const hasRuntimeError = /Application error|Unhandled Runtime Error|NEXT_NOT_FOUND|Internal Server Error/.test(bodyText)
    const extra = (() => { ${extraChecks} })()
    return {
      ok: horizontalOverflow <= 2 && !hasRuntimeError && Boolean(extra.ok),
      evidence: 'overflow=' + horizontalOverflow + '; runtimeError=' + hasRuntimeError + '; ' + extra.evidence,
      bodyText,
    }
  })()`
}

function findBrowser() {
  const candidates = [
    browserOverride,
    '/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/mnt/c/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/microsoft-edge',
    '/usr/bin/microsoft-edge-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean)

  return candidates.find((candidate) => existsSync(candidate))
}

function tempRootForBrowser(browserPath) {
  const projectTemp = resolve(projectRoot, '.artifacts/browser-profile')
  mkdirSync(projectTemp, { recursive: true })
  if (browserPath.startsWith('/mnt/c/')) return projectTemp
  return tmpdir()
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}

async function waitForDevTools(userDataDir) {
  const portFile = join(userDataDir, 'DevToolsActivePort')
  const started = Date.now()
  while (Date.now() - started < 10000) {
    if (existsSync(portFile)) {
      const [port] = readFileSync(portFile, 'utf8').trim().split('\n')
      if (port) return Number(port)
    }
    await sleep(150)
  }
  throw new Error('Browser did not expose DevToolsActivePort within 10 seconds.')
}

async function waitForDevToolsHttp(port) {
  const started = Date.now()
  let lastError = ''
  while (Date.now() - started < 10000) {
    if (browserExited) {
      throw new Error(`Browser exited before DevTools endpoint was available. code=${browserExitCode}; stderr=${browserStderr.slice(0, 500)}`)
    }
    for (const host of devToolsHosts(browserPath)) {
      try {
        const targets = await fetchJson(`http://${host}:${port}/json/list`)
        if (Array.isArray(targets)) {
          activeDevToolsHost = host
          return targets
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
      }
    }
    await sleep(150)
  }
  throw new Error(`Browser did not expose DevTools HTTP endpoint on port ${port} within 10 seconds. hosts=${devToolsHosts(browserPath).join(',')}; last=${lastError}`)
}

async function fetchJson(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} returned ${response.status}`)
  return response.json()
}

function connectToTarget(wsUrl) {
  const socket = new WebSocket(wsUrl)
  let nextId = 1
  const pending = new Map()

  socket.on('message', (raw) => {
    const message = JSON.parse(String(raw))
    if (!message.id) return
    const handler = pending.get(message.id)
    if (!handler) return
    pending.delete(message.id)
    if (message.error) handler.reject(new Error(message.error.message || JSON.stringify(message.error)))
    else handler.resolve(message.result)
  })

  function send(method, params = {}) {
    const id = nextId++
    socket.send(JSON.stringify({ id, method, params }))
    return new Promise((resolveSend, rejectSend) => {
      pending.set(id, { resolve: resolveSend, reject: rejectSend })
    })
  }

  return new Promise((resolveConnect, rejectConnect) => {
    socket.once('open', () => resolveConnect({ socket, send }))
    socket.once('error', rejectConnect)
  })
}

function parseCookiePairs(header) {
  return header
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const index = part.indexOf('=')
      if (index < 1) return null
      return { name: part.slice(0, index), value: part.slice(index + 1) }
    })
    .filter(Boolean)
}

function baseUrlHost() {
  return new URL(baseUrl).hostname
}

async function authenticatedApiPreflight() {
  if (!cookieHeader) return true
  const response = await fetch(`${baseUrl}/api/today`, {
    headers: { cookie: cookieHeader },
  })
  record(
    'BROWSER-AUTH-PREFLIGHT',
    'session cookie can read authenticated API before browser navigation',
    response.ok,
    `GET /api/today status=${response.status}`,
  )
  return response.ok
}

function toBrowserPath(path, browserPath) {
  if (!browserPath.startsWith('/mnt/c/')) return path
  if (!path.startsWith('/mnt/c/')) return path
  return `C:\\${path.slice('/mnt/c/'.length).split('/').join('\\')}`
}

function readFirstMatch(path, pattern) {
  try {
    const text = readFileSync(path, 'utf8')
    return text.match(pattern)?.[1]
  } catch {
    return undefined
  }
}

function devToolsHosts(browserPath) {
  if (process.env.GOAL_MATE_BROWSER_DEBUG_HOST) return [process.env.GOAL_MATE_BROWSER_DEBUG_HOST]
  if (!browserPath.startsWith('/mnt/c/')) return ['127.0.0.1']
  const nameserver = readFirstMatch('/etc/resolv.conf', /^nameserver\s+([0-9.]+)/m)
  const routeGateway = readFirstMatch('/proc/net/route', /^eth0\s+[0-9A-Fa-f]+\s+([0-9A-Fa-f]{8})/m)
  const gateway = routeGateway
    ? routeGateway.match(/../g)?.reverse().map((hex) => Number.parseInt(hex, 16)).join('.')
    : undefined
  return [...new Set(['127.0.0.1', nameserver, gateway].filter(Boolean))]
}

function normalizeWsUrl(wsUrl, browserPath) {
  const host = activeDevToolsHost || devToolsHosts(browserPath)[0]
  if (!browserPath.startsWith('/mnt/c/')) return wsUrl
  return wsUrl.replace('://127.0.0.1:', `://${host}:`).replace('://localhost:', `://${host}:`)
}

async function setCookies(send) {
  const cookies = parseCookiePairs(cookieHeader)
  for (const cookie of cookies) {
    const result = await send('Network.setCookie', {
      name: cookie.name,
      value: cookie.value,
      url: baseUrl,
      path: '/',
      httpOnly: false,
      secure: baseUrl.startsWith('https://'),
      sameSite: 'Lax',
    })
    if (!result?.success) {
      throw new Error(`Browser rejected cookie ${cookie.name}`)
    }
  }
  const stored = await send('Network.getCookies', { urls: [baseUrl] })
  const storedCount = stored?.cookies?.filter((storedCookie) => cookies.some((cookie) => cookie.name === storedCookie.name)).length || 0
  return storedCount
}

async function primeDocumentCookies(send) {
  const cookies = parseCookiePairs(cookieHeader)
  if (!cookies.length) return 0
  await navigate(send, `${baseUrl}/api/health`)
  for (const cookie of cookies) {
    const cookieAssignment = `${cookie.name}=${cookie.value}; Path=/; SameSite=Lax`
    await evaluate(send, `document.cookie = ${JSON.stringify(cookieAssignment)}`)
  }
  const visibleCookieNames = await evaluate(
    send,
    `document.cookie.split(';').map((item) => item.trim().split('=')[0]).filter(Boolean)`,
  )
  const visibleCount = Array.isArray(visibleCookieNames)
    ? visibleCookieNames.filter((name) => cookies.some((cookie) => cookie.name === name)).length
    : 0
  return visibleCount
}

async function browserSignIn(send) {
  await navigate(send, `${baseUrl}/api/health`)
  const signIn = await evaluate(
    send,
    `(async () => {
      const response = await fetch('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: ${JSON.stringify(authEmail)}, password: ${JSON.stringify(authPassword)} })
      })
      return { status: response.status }
    })()`,
  )
  const today = await evaluate(
    send,
    `(async () => {
      const response = await fetch('/api/today', { credentials: 'include' })
      return { status: response.status }
    })()`,
  )
  return { signInStatus: signIn?.status, todayStatus: today?.status }
}

async function navigate(send, url) {
  await send('Page.navigate', { url })
  const started = Date.now()
  while (Date.now() - started < 12000) {
    const ready = await send('Runtime.evaluate', {
      expression: 'document.readyState',
      returnByValue: true,
    })
    if (ready.result?.value === 'complete') break
    await sleep(150)
  }
  await sleep(1400)
}

async function evaluate(send, expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || 'Runtime.evaluate failed')
  }
  return result.result?.value
}

async function waitForPageCheck(send, page, requiredText) {
  const started = Date.now()
  let lastCheck = null
  let lastMissingText = requiredText

  while (Date.now() - started < 10000) {
    const check = await evaluate(send, page.evaluate)
    const bodyText = String(check?.bodyText || '')
    const missingText = requiredText.filter((text) => !bodyText.includes(text))
    lastCheck = check
    lastMissingText = missingText
    if (check?.ok && missingText.length === 0) {
      return { check, missingText }
    }
    await sleep(350)
  }

  return { check: lastCheck, missingText: lastMissingText }
}

async function screenshot(send, path) {
  const shot = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  })
  writeFileSync(path, Buffer.from(shot.data, 'base64'))
}

function toMarkdown() {
  const lines = [
    '# Goal Mate Dashboard Browser Verification',
    '',
    `- Time: ${new Date().toISOString()}`,
    `- Base URL: ${baseUrl}`,
    `- Authenticated: ${cookieHeader ? 'yes' : 'no'}`,
    `- Require auth: ${requireAuth ? 'yes' : 'no'}`,
    `- Screenshots: ${runDir}`,
    '',
    '| ID | Purpose | Result | Evidence |',
    '| --- | --- | --- | --- |',
    ...results.map((result) => `| ${result.id} | ${result.purpose} | ${result.ok ? 'PASS' : 'FAIL'} | ${String(result.evidence || '').replaceAll('|', '\\|')} |`),
    '',
  ]
  return lines.join('\n')
}

const browserPath = findBrowser()
if (!browserPath) {
  record('BROWSER-FOUND', 'Edge/Chrome executable is available for dashboard verification', false, 'Set GOAL_MATE_BROWSER_PATH to a Chromium-compatible browser.')
  const markdown = toMarkdown()
  console.log(markdown)
  if (shouldWrite) writeFileSync(resolve(projectRoot, 'docs/plans/dashboard-browser-last-run.md'), markdown)
  process.exit(1)
}

mkdirSync(runDir, { recursive: true })
const userDataDir = await mkdtemp(join(tempRootForBrowser(browserPath), 'goal-mate-browser-'))
const browserUserDataDir = toBrowserPath(userDataDir, browserPath)
let browserExited = false
let browserExitCode = ''
let browserStdout = ''
let browserStderr = ''
let activeDevToolsHost = ''
const browser = spawn(browserPath, [
  '--headless',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  '--disable-background-networking',
  '--no-first-run',
  '--no-default-browser-check',
  '--no-proxy-server',
  '--proxy-bypass-list=<-loopback>',
  '--remote-allow-origins=*',
  '--remote-debugging-address=0.0.0.0',
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${browserUserDataDir}`,
  '--window-size=1440,900',
  'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] })

browser.stdout?.on('data', (chunk) => {
  browserStdout += String(chunk)
})

browser.stderr?.on('data', (chunk) => {
  browserStderr += String(chunk)
})

browser.on('exit', (code, signal) => {
  browserExited = true
  browserExitCode = `${code ?? ''}${signal ? `/${signal}` : ''}`
})

let client

try {
  await prepareAuthenticatedSession()
  if (requireAuth && !cookieHeader) {
    throw new Error('Authenticated dashboard browser verification requires GOAL_MATE_COOKIE or --prepare-auth.')
  }
  if (requireAuth) {
    await authenticatedApiPreflight()
  }

  record('BROWSER-FOUND', 'Edge/Chrome executable is available for dashboard verification', true, browserPath)

  const targets = await waitForDevToolsHttp(debugPort)
  const target = targets.find((item) => item.type === 'page' && item.webSocketDebuggerUrl)
  if (!target) throw new Error('No page target found.')

  client = await connectToTarget(normalizeWsUrl(target.webSocketDebuggerUrl, browserPath))
  await client.send('Page.enable')
  await client.send('Runtime.enable')
  await client.send('Network.enable')
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  })

  if (shouldPrepareAuth) {
    const browserAuth = await browserSignIn(client.send)
    record(
      'BROWSER-COOKIE',
      'browser verification signs in through the real browser auth flow',
      browserAuth.signInStatus === 200 && browserAuth.todayStatus === 200,
      `signIn=${browserAuth.signInStatus}; today=${browserAuth.todayStatus}`,
    )
  } else {
    const cookieCount = await setCookies(client.send)
    record('BROWSER-COOKIE', 'browser verification can use authenticated session when supplied', cookieHeader ? cookieCount > 0 : !requireAuth, cookieHeader ? `cookies=${cookieCount}` : 'no cookie supplied; running layout/empty-state smoke')
    const documentCookieCount = cookieHeader ? await primeDocumentCookies(client.send) : 0
    if (cookieHeader) {
      record('BROWSER-DOCUMENT-COOKIE', 'browser page context can see the session cookie name before dashboard navigation', documentCookieCount > 0, `visibleCookieNames=${documentCookieCount}`)
    }
  }

  for (const page of pages) {
    const url = `${baseUrl}${page.path}`
    await navigate(client.send, url)
    const requiredText = [
      ...page.requiredText,
      ...(requireAuth ? page.authenticatedText || [] : []),
    ]
    const { check, missingText } = await waitForPageCheck(client.send, page, requiredText)
    const textOk = missingText.length === 0
    const shotPath = resolve(runDir, `${page.id}.png`)
    await screenshot(client.send, shotPath)
    record(
      `DASH-${page.id.toUpperCase()}`,
      `${page.path} renders required page structure without horizontal overflow`,
      Boolean(check?.ok && textOk),
      `${check?.evidence || 'no evidence'}; missingText=${missingText.join(',') || 'none'}; screenshot=${shotPath}`,
    )
  }
} catch (error) {
  record('BROWSER-RUNTIME', 'dashboard browser verifier completes without crashing', false, error instanceof Error ? error.message : String(error))
} finally {
  try {
    if (client?.send) await client.send('Browser.close')
  } catch {
    browser.kill('SIGTERM')
  }
  browser.kill('SIGTERM')
}

const markdown = toMarkdown()
console.log(markdown)

if (shouldWrite) {
  writeFileSync(resolve(projectRoot, 'docs/plans/dashboard-browser-last-run.md'), markdown)
}

process.exit(results.every((result) => result.ok) ? 0 : 1)
