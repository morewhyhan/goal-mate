import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'

const shouldWrite = process.argv.includes('--write')
const baseUrl = process.env.GOAL_MATE_BASE_URL || process.env.NEXT_PUBLIC_BETTER_AUTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
const browserOverride = process.env.GOAL_MATE_BROWSER_PATH || ''
const scriptDir = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(scriptDir, '..')
const projectRoot = resolve(appRoot, '..')
const artifactDir = resolve(projectRoot, '.artifacts/auth-ui')
const runId = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-')
const runDir = resolve(artifactDir, runId)
const debugPort = Number(process.env.GOAL_MATE_AUTH_BROWSER_DEBUG_PORT || 9622 + Math.floor(Math.random() * 1000))
const email = process.env.GOAL_MATE_AUTH_UI_EMAIL || `auth-ui-${Date.now()}@goalmate.local`
const password = process.env.GOAL_MATE_AUTH_UI_PASSWORD || 'auth-ui-pass-123'
const name = process.env.GOAL_MATE_AUTH_UI_NAME || 'Auth UI User'

const results = []

function record(id, purpose, ok, evidence = '') {
  results.push({ id, purpose, ok, evidence })
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
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

function normalizeWsUrl(wsUrl, browserPath, activeHost) {
  if (!browserPath.startsWith('/mnt/c/')) return wsUrl
  return wsUrl.replace('://127.0.0.1:', `://${activeHost}:`).replace('://localhost:', `://${activeHost}:`)
}

function tempRootForBrowser(browserPath) {
  const projectTemp = resolve(projectRoot, '.artifacts/browser-profile')
  mkdirSync(projectTemp, { recursive: true })
  if (browserPath.startsWith('/mnt/c/')) return projectTemp
  return tmpdir()
}

function toBrowserPath(path, browserPath) {
  if (!browserPath.startsWith('/mnt/c/')) return path
  if (!path.startsWith('/mnt/c/')) return path
  return `C:\\${path.slice('/mnt/c/'.length).split('/').join('\\')}`
}

async function fetchJson(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} returned ${response.status}`)
  return response.json()
}

async function waitForDevToolsHttp(port, browserPath, getBrowserState) {
  const started = Date.now()
  let lastError = ''
  while (Date.now() - started < 10000) {
    const state = getBrowserState()
    if (state.exited) {
      throw new Error(`Browser exited before DevTools endpoint was available. code=${state.code}; stderr=${state.stderr.slice(0, 500)}`)
    }
    for (const host of devToolsHosts(browserPath)) {
      try {
        const targets = await fetchJson(`http://${host}:${port}/json/list`)
        if (Array.isArray(targets)) return { targets, host }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
      }
    }
    await sleep(150)
  }
  throw new Error(`Browser did not expose DevTools endpoint on ${port}. last=${lastError}`)
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

async function navigate(send, path) {
  await send('Page.navigate', { url: `${baseUrl}${path}` })
  const started = Date.now()
  while (Date.now() - started < 12000) {
    const ready = await send('Runtime.evaluate', {
      expression: 'document.readyState',
      returnByValue: true,
    })
    if (ready.result?.value === 'complete') break
    await sleep(150)
  }
  await sleep(1200)
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

async function waitFor(send, expression, timeoutMs = 10000) {
  const started = Date.now()
  let lastValue = null
  while (Date.now() - started < timeoutMs) {
    lastValue = await evaluate(send, expression)
    if (lastValue?.ok) return lastValue
    await sleep(250)
  }
  return lastValue
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
    '# Goal Mate Auth UI Verification',
    '',
    `- Time: ${new Date().toISOString()}`,
    `- Base URL: ${baseUrl}`,
    `- Test user: ${email.replace(/^(.{3}).+@/, '$1...@')}`,
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
  record('AUTH-BROWSER', 'Edge/Chrome executable is available for auth UI verification', false, 'Set GOAL_MATE_BROWSER_PATH.')
  const markdown = toMarkdown()
  console.log(markdown)
  if (shouldWrite) writeFileSync(resolve(projectRoot, 'docs/plans/auth-ui-last-run.md'), markdown)
  process.exit(1)
}

mkdirSync(runDir, { recursive: true })

try {
  const health = await fetch(`${baseUrl}/api/health`)
  record('AUTH-HEALTH', 'local web server is reachable before auth UI verification', health.ok, `GET /api/health status=${health.status}`)

  const unauthToday = await fetch(`${baseUrl}/api/today`)
  record('AUTH-API-GUARD', 'unauthenticated private API remains blocked', unauthToday.status === 401, `GET /api/today status=${unauthToday.status}`)
} catch (error) {
  record('AUTH-PREFLIGHT', 'auth UI preflight can reach local web server', false, error instanceof Error ? error.message : String(error))
}

const userDataDir = await mkdtemp(join(tempRootForBrowser(browserPath), 'goal-mate-auth-ui-'))
const browserUserDataDir = toBrowserPath(userDataDir, browserPath)
let browserExited = false
let browserExitCode = ''
let browserStderr = ''
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

browser.stderr?.on('data', (chunk) => {
  browserStderr += String(chunk)
})

browser.on('exit', (code, signal) => {
  browserExited = true
  browserExitCode = `${code ?? ''}${signal ? `/${signal}` : ''}`
})

let client

try {
  record('AUTH-BROWSER', 'Edge/Chrome executable is available for auth UI verification', true, browserPath)
  const { targets, host } = await waitForDevToolsHttp(debugPort, browserPath, () => ({
    exited: browserExited,
    code: browserExitCode,
    stderr: browserStderr,
  }))
  const target = targets.find((item) => item.type === 'page' && item.webSocketDebuggerUrl)
  if (!target) throw new Error('No page target found.')

  client = await connectToTarget(normalizeWsUrl(target.webSocketDebuggerUrl, browserPath, host))
  await client.send('Page.enable')
  await client.send('Runtime.enable')
  await client.send('Network.enable')
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  })

  await navigate(client.send, '/login')
  const loginShell = await evaluate(client.send, `(() => {
    const text = document.body.innerText || ''
    const hasCore = ['登录', '注册', '邮箱', '密码'].every((item) => text.includes(item))
    const noFake = !/Google|GitHub|忘记密码/.test(text)
    const emailInputs = document.querySelectorAll('input[type="email"]').length
    const passwordInputs = document.querySelectorAll('input[type="password"]').length
    return { ok: hasCore && noFake && emailInputs >= 1 && passwordInputs >= 1, text, evidence: 'core=' + hasCore + '; noFake=' + noFake + '; emailInputs=' + emailInputs + '; passwordInputs=' + passwordInputs }
  })()`)
  await screenshot(client.send, resolve(runDir, 'login.png'))
  record('AUTH-LOGIN-SHELL', '/login renders real email/password login and register entry without fake actions', Boolean(loginShell?.ok), loginShell?.evidence || 'no evidence')

  await navigate(client.send, '/dashboard/today')
  const guard = await waitFor(client.send, `(() => {
    const path = window.location.pathname
    const text = document.body.innerText || ''
    return { ok: path === '/login' || text.includes('正在前往登录页') || text.includes('继续推进目标'), evidence: 'path=' + path }
  })()`)
  record('AUTH-DASHBOARD-GUARD', 'unauthenticated dashboard navigation is redirected or visibly gated', Boolean(guard?.ok), guard?.evidence || 'no evidence')

  await navigate(client.send, '/login')
  const signUpResult = await evaluate(client.send, `(async () => {
    const clickByText = (text) => {
      const button = [...document.querySelectorAll('button')].find((item) => item.innerText.trim().includes(text))
      if (!button) throw new Error('Missing button: ' + text)
      button.click()
    }
    const setInput = (input, value) => {
      if (!input) throw new Error('Missing input for value: ' + value)
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }
    const waitForSelector = async (selector) => {
      const started = Date.now()
      while (Date.now() - started < 5000) {
        const input = document.querySelector(selector)
        if (input) return input
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      throw new Error('Missing selector: ' + selector)
    }
    clickByText('注册')
    await new Promise((resolve) => setTimeout(resolve, 250))
    setInput(await waitForSelector('input[placeholder="你的名字"]'), ${JSON.stringify(name)})
    setInput(await waitForSelector('input[type="email"]'), ${JSON.stringify(email)})
    setInput(await waitForSelector('input[type="password"]'), ${JSON.stringify(password)})
    clickByText('创建账户并进入 Today')
    return { ok: true }
  })()`)
  const signUpPath = await waitFor(client.send, `(() => {
    const path = window.location.pathname
    const text = document.body.innerText || ''
    return { ok: path === '/dashboard/today', evidence: 'path=' + path + '; hasSidebar=' + text.includes('Goal Mate') }
  })()`, 15000)
  await screenshot(client.send, resolve(runDir, 'after-register.png'))
  record('AUTH-REGISTER-FLOW', 'new user can register through the visible UI and enter Today', Boolean(signUpResult?.ok && signUpPath?.ok), signUpPath?.evidence || 'no evidence')

  const logoutResult = await evaluate(client.send, `(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.innerText.includes('退出登录') || item.getAttribute('aria-label') === '退出登录')
    if (!button) return { ok: false, evidence: 'missing logout button' }
    button.click()
    return { ok: true, evidence: 'clicked logout' }
  })()`)
  const logoutPath = await waitFor(client.send, `(() => {
    const path = window.location.pathname
    return { ok: path === '/login', evidence: 'path=' + path }
  })()`, 12000)
  record('AUTH-LOGOUT-FLOW', 'logged-in user can logout and return to Login', Boolean(logoutResult?.ok && logoutPath?.ok), `${logoutResult?.evidence || ''}; ${logoutPath?.evidence || ''}`)

  const signInResult = await evaluate(client.send, `(async () => {
    const clickByText = (text) => {
      const button = [...document.querySelectorAll('button')].find((item) => item.innerText.trim().includes(text))
      if (!button) throw new Error('Missing button: ' + text)
      button.click()
    }
    const setInput = (input, value) => {
      if (!input) throw new Error('Missing input for value: ' + value)
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }
    const waitForSelector = async (selector) => {
      const started = Date.now()
      while (Date.now() - started < 5000) {
        const input = document.querySelector(selector)
        if (input) return input
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      throw new Error('Missing selector: ' + selector)
    }
    clickByText('登录')
    await new Promise((resolve) => setTimeout(resolve, 500))
    setInput(await waitForSelector('input[type="email"]'), ${JSON.stringify(email)})
    setInput(await waitForSelector('input[type="password"]'), ${JSON.stringify(password)})
    clickByText('登录并进入 Today')
    return { ok: true }
  })()`)
  const signInPath = await waitFor(client.send, `(() => {
    const path = window.location.pathname
    return { ok: path === '/dashboard/today', evidence: 'path=' + path }
  })()`, 15000)
  await screenshot(client.send, resolve(runDir, 'after-login.png'))
  record('AUTH-LOGIN-FLOW', 'existing user can login through the visible UI and enter Today', Boolean(signInResult?.ok && signInPath?.ok), signInPath?.evidence || 'no evidence')
} catch (error) {
  record('AUTH-RUNTIME', 'auth UI verifier completes without crashing', false, error instanceof Error ? error.message : String(error))
} finally {
  try {
    if (client?.send) await client.send('Browser.close')
  } catch {
    browser.kill('SIGTERM')
  }
}

const markdown = toMarkdown()
console.log(markdown)
if (shouldWrite) {
  writeFileSync(resolve(projectRoot, 'docs/plans/auth-ui-last-run.md'), markdown)
}

if (results.some((result) => !result.ok)) {
  process.exitCode = 1
}
