const baseUrl = process.env.GOAL_MATE_BASE_URL || 'http://127.0.0.1:3000'
const cookie = process.env.GOAL_MATE_COOKIE || ''
const shouldWrite = process.argv.includes('--write')
const requireAuth = process.argv.includes('--require-auth')

const unauthenticatedChecks = [
  { id: 'API-HEALTH-1', method: 'GET', path: '/api/health', expected: 200, purpose: '服务健康检查返回 goal-mate' },
  { id: 'SEC-1-SETTINGS', method: 'GET', path: '/api/settings', expected: 401, purpose: '未登录不能读取设置' },
  { id: 'SEC-1-MODELS', method: 'GET', path: '/api/models', expected: 401, purpose: '未登录不能读取模型配置' },
  { id: 'SEC-1-GOALS', method: 'GET', path: '/api/goals', expected: 401, purpose: '未登录不能读取目标' },
  { id: 'SEC-1-TODAY', method: 'GET', path: '/api/today', expected: 401, purpose: '未登录不能读取今日行动' },
  { id: 'SEC-1-LOGS', method: 'GET', path: '/api/logs/tree', expected: 401, purpose: '未登录不能读取日志树' },
  { id: 'SEC-1-AGENT', method: 'GET', path: '/api/agent/threads', expected: 401, purpose: '未登录不能读取 Agent 历史' },
]

const authenticatedChecks = [
  { id: 'API-SET-1', method: 'GET', path: '/api/settings', expected: 200, purpose: '读取用户设置' },
  { id: 'API-MOD-1', method: 'GET', path: '/api/models', expected: 200, purpose: '读取 DeepSeek 模型配置且密钥脱敏', checkSecrets: true },
  { id: 'API-GOAL-1', method: 'GET', path: '/api/goals', expected: 200, purpose: '读取目标、KR、条件、阶段' },
  { id: 'API-TODAY-1', method: 'GET', path: '/api/today', expected: 200, purpose: '读取当前主目标今日行动；无主目标时返回空 Today 数据而不是错误' },
  { id: 'API-LOG-1', method: 'GET', path: '/api/logs/tree', expected: 200, purpose: '读取 Markdown 日志树' },
  { id: 'API-AGENT-1', method: 'GET', path: '/api/agent/threads', expected: 200, purpose: '读取 Agent 对话历史' },
  { id: 'API-SET-3', method: 'GET', path: '/api/settings/export', expected: 200, purpose: '导出数据且模型密钥脱敏', checkSecrets: true },
]

async function runCheck(check, useCookie) {
  const startedAt = Date.now()
  try {
    const response = await fetch(`${baseUrl}${check.path}`, {
      method: check.method,
      headers: useCookie && cookie ? { cookie } : undefined,
    })
    const text = await response.text()
    let body = null
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      body = text
    }
    const expectedStatuses = Array.isArray(check.expected) ? check.expected : [check.expected]
    const ok = expectedStatuses.includes(response.status)
    const serializedBody = JSON.stringify(body || '')
    const secretLeak = check.checkSecrets
      ? serializedBody.includes('env:DEEPSEEK_API_KEY') || /sk-[A-Za-z0-9_-]{12,}/.test(serializedBody)
      : false
    return {
      ...check,
      status: response.status,
      ok: ok && !secretLeak,
      durationMs: Date.now() - startedAt,
      note: secretLeak ? 'possible secret leak' : '',
    }
  } catch (error) {
    return {
      ...check,
      status: 'ERROR',
      ok: false,
      durationMs: Date.now() - startedAt,
      note: error instanceof Error ? error.message : String(error),
    }
  }
}

function toMarkdown(results, skippedAuthenticated) {
  const lines = [
    '# Goal Mate v0.1 验收脚本结果',
    '',
    `- Base URL: ${baseUrl}`,
    `- Time: ${new Date().toISOString()}`,
    `- Authenticated checks: ${skippedAuthenticated ? 'skipped: GOAL_MATE_COOKIE missing' : 'enabled'}`,
    `- Require auth: ${requireAuth ? 'yes' : 'no'}`,
    `- Scope: ${skippedAuthenticated ? 'unauthenticated security smoke only' : 'authenticated API smoke'}`,
    '',
    '| ID | Purpose | Expected | Actual | Result | Note |',
    '| --- | --- | --- | --- | --- | --- |',
  ]
  for (const result of results) {
    const expected = Array.isArray(result.expected) ? result.expected.join(' / ') : result.expected
    lines.push(`| ${result.id} | ${result.purpose} | ${expected} | ${result.status} | ${result.ok ? 'PASS' : 'FAIL'} | ${result.note || ''} |`)
  }
  return `${lines.join('\n')}\n`
}

const results = []
for (const check of unauthenticatedChecks) {
  results.push(await runCheck(check, false))
}

let skippedAuthenticated = false
if (cookie) {
  for (const check of authenticatedChecks) {
    results.push(await runCheck(check, true))
  }
} else {
  skippedAuthenticated = true
}

const markdown = toMarkdown(results, skippedAuthenticated)
console.log(markdown)

if (shouldWrite) {
  const { writeFileSync } = await import('node:fs')
  writeFileSync('../docs/plans/v0.1-acceptance-last-run.md', markdown)
}

const failed = results.some((result) => !result.ok) || (requireAuth && skippedAuthenticated)
process.exit(failed ? 1 : 0)
