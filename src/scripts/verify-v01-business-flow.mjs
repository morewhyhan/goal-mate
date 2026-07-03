const baseUrl = process.env.GOAL_MATE_BASE_URL || 'http://127.0.0.1:3000'
const cookie = process.env.GOAL_MATE_COOKIE || ''
const shouldWrite = process.argv.includes('--write')

const results = []

function record(id, purpose, ok, evidence = '') {
  results.push({ id, purpose, ok, evidence })
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      cookie,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  })
  const text = await response.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  if (!response.ok) {
    throw new Error(`${options.method || 'GET'} ${path} returned ${response.status}: ${text.slice(0, 300)}`)
  }
  return body
}

function noSecretLeak(value) {
  const text = JSON.stringify(value)
  return !text.includes('env:DEEPSEEK_API_KEY') && !/sk-[A-Za-z0-9_-]{12,}/.test(text)
}

async function run() {
  assert(cookie, 'GOAL_MATE_COOKIE is required for business-flow verification')

  const health = await request('/api/health')
  record('BF-HEALTH', 'health endpoint identifies Goal Mate', health.product === 'goal-mate', `product=${health.product}`)

  const settings = await request('/api/settings')
  const settingsData = settings.data
  record(
    'BF-SETTINGS',
    'settings expose required configuration sections',
    Boolean(settingsData?.general && settingsData?.goals && settingsData?.logs && settingsData?.today && settingsData?.agent && settingsData?.notifications && settingsData?.dataPrivacy),
    Object.keys(settingsData || {}).join(', '),
  )

  const models = await request('/api/models')
  const defaultModel = models.data?.find((model) => model.isDefault)
  record(
    'BF-MODEL',
    'default DeepSeek model exists and does not leak secrets',
    Boolean(defaultModel?.provider === 'DeepSeek' && defaultModel?.model === 'deepseek-v4-flash' && noSecretLeak(models)),
    defaultModel ? `${defaultModel.provider}/${defaultModel.model}/${defaultModel.apiKeyRef}` : 'missing',
  )

  const testedModel = await request('/api/settings/models/test', { method: 'POST' })
  record(
    'BF-MODEL-TEST',
    'settings can trigger model connection test endpoint without leaking keys',
    Boolean(typeof testedModel.data?.ok === 'boolean' && testedModel.data?.provider === 'DeepSeek' && noSecretLeak(testedModel)),
    testedModel.data ? `${testedModel.data.provider}/${testedModel.data.model}; ok=${testedModel.data.ok}` : 'missing',
  )

  const updatedSettings = await request('/api/settings', {
    method: 'PUT',
    body: JSON.stringify({
      agent: { memory_enabled: true, require_confirm_external_actions: true },
      notifications: { max_daily_prompts: 2, channel: 'web' },
    }),
  })
  record(
    'BF-SETTINGS-WRITE',
    'settings can persist agent and notification configuration',
    Boolean(updatedSettings.data?.agent?.memory_enabled === true && updatedSettings.data?.notifications?.max_daily_prompts === 2),
    `channel=${updatedSettings.data?.notifications?.channel}; max=${updatedSettings.data?.notifications?.max_daily_prompts}`,
  )

  const updatedModel = await request(`/api/models/${defaultModel.id}`, {
    method: 'PUT',
    body: JSON.stringify({ temperature: 0.3, isDefault: true }),
  })
  record(
    'BF-MODEL-WRITE',
    'model configuration can be updated without leaking secrets',
    Boolean(updatedModel.data?.id === defaultModel.id && updatedModel.data?.temperature === 0.3 && noSecretLeak(updatedModel)),
    `temperature=${updatedModel.data?.temperature}; key=${updatedModel.data?.apiKeyRef}`,
  )

  const goals = await request('/api/goals')
  const goal = goals.data?.find((item) => item.isCurrentFocus) || goals.data?.[0]
  record(
    'BF-GOAL',
    'current goal includes KR, conditions, stages, action and reasoning card',
    Boolean(goal && goal.keyResults?.length >= 4 && goal.conditions?.length >= 5 && goal.stagePlans?.length >= 1 && goal.dailyActions?.length >= 1 && goal.reasoningCards?.length >= 1),
    goal ? `${goal.title}; kr=${goal.keyResults?.length}; conditions=${goal.conditions?.length}; stages=${goal.stagePlans?.length}` : 'missing',
  )

  const today = await request('/api/today')
  const action = today.data?.action || goal?.dailyActions?.[0]
  record(
    'BF-TODAY',
    'today exposes the current focus goal and one actionable next step',
    Boolean(today.data?.goal?.isCurrentFocus && action?.id && action?.doneWhen && action?.minimumStep),
    action ? action.title : 'missing',
  )

  const logsBefore = await request('/api/logs/tree')
  record(
    'BF-LOGS',
    'logs tree exposes markdown hierarchy',
    Boolean(logsBefore.data?.some((log) => String(log.path).startsWith('logs/2026/'))),
    `logs=${logsBefore.data?.length || 0}`,
  )

  const threads = await request('/api/agent/threads')
  record(
    'BF-AGENT',
    'agent exposes conversation history',
    Boolean(threads.data?.length >= 1),
    `threads=${threads.data?.length || 0}`,
  )

  const checkin = await request('/api/today/checkin', {
    method: 'POST',
    body: JSON.stringify({
      actionId: action.id,
      result: 'partial',
      userFeedback: '验收：完成了一部分，主要验证诊断和日志写入。',
    }),
  })
  record(
    'BF-CHECKIN',
    'partial checkin creates checkin, diagnosis and markdown log entry',
    Boolean(checkin.data?.checkin?.id && checkin.data?.diagnosis?.id && checkin.data?.logEntry?.content?.includes('验收')),
    `checkin=${checkin.data?.checkin?.id}; diagnosis=${checkin.data?.diagnosis?.category}`,
  )

  const review = await request('/api/reviews/generate', {
    method: 'POST',
    body: JSON.stringify({ goalId: goal.id, type: 'weekly' }),
  })
  record(
    'BF-REVIEW',
    'review generation creates review and writes markdown log entry',
    Boolean(review.data?.review?.id && review.data?.logEntry?.id && review.data?.markdown?.includes(goal.title)),
    `review=${review.data?.review?.id}; log=${review.data?.logEntry?.path}`,
  )

  const exported = await request('/api/settings/export')
  record(
    'BF-EXPORT',
    'data export includes Markdown documents and user data without leaking model secrets',
    Boolean(exported.data && Array.isArray(exported.data.markdownDocuments) && Array.isArray(exported.data.markdownLinks) && noSecretLeak(exported)),
    `keys=${Object.keys(exported.data || {}).join(', ')}`,
  )
}

try {
  await run()
} catch (error) {
  record('BF-RUNTIME', 'business-flow verifier did not crash', false, error instanceof Error ? error.message : String(error))
}

const lines = [
  '# Goal Mate v0.1 Business Flow Verification',
  '',
  `- Base URL: ${baseUrl}`,
  `- Time: ${new Date().toISOString()}`,
  `- Authenticated: ${cookie ? 'yes' : 'no'}`,
  '',
  '| ID | Purpose | Result | Evidence |',
  '| --- | --- | --- | --- |',
  ...results.map((result) => `| ${result.id} | ${result.purpose} | ${result.ok ? 'PASS' : 'FAIL'} | ${String(result.evidence || '').replaceAll('|', '\\|')} |`),
  '',
]

const markdown = lines.join('\n')
console.log(markdown)

if (shouldWrite) {
  const { writeFileSync } = await import('node:fs')
  writeFileSync('../docs/plans/v0.1-business-flow-last-run.md', markdown)
}

process.exit(results.every((result) => result.ok) ? 0 : 1)
