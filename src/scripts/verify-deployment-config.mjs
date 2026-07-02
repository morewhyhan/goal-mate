import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const shouldWrite = process.argv.includes('--write')
const scriptDir = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(scriptDir, '..')
const projectRoot = resolve(appRoot, '..')
const deployDir = resolve(projectRoot, 'deploy/systemd')
const packagePath = resolve(appRoot, 'package.json')
const envExamplePath = resolve(appRoot, '.env.example')

const serviceFiles = [
  {
    id: 'WEB',
    file: 'goal-mate-web.service',
    command: 'pnpm start',
    description: 'Web Console service',
  },
  {
    id: 'QQ',
    file: 'goal-mate-qq-worker.service',
    command: 'pnpm worker:qq',
    description: 'QQ Gateway worker service',
  },
  {
    id: 'SCHEDULER',
    file: 'goal-mate-scheduler-worker.service',
    command: 'pnpm worker:scheduler',
    description: 'Scheduler worker service',
  },
]

const runtimeScripts = [
  { id: 'QQ-WORKER', file: 'scripts/qq-bot-worker.mjs', description: 'QQ worker script' },
  { id: 'SCHEDULER-WORKER', file: 'scripts/scheduler-worker.mjs', description: 'Scheduler worker script' },
]

const requiredEnvVars = [
  'DATABASE_URL',
  'DEEPSEEK_API_KEY',
  'DEEPSEEK_API_BASE',
  'DEEPSEEK_MODEL',
  'QQ_BOT_APP_ID',
  'QQ_BOT_TOKEN',
  'QQ_BOT_API_BASE',
  'QQ_BOT_INTENTS',
  'QQ_DEFAULT_USER_EMAIL',
  'SCHEDULER_TICK_SECONDS',
  'SCHEDULER_TIMEZONE',
  'SCHEDULER_MORNING_TIME',
  'SCHEDULER_MIDDAY_TIME',
  'SCHEDULER_EVENING_TIME',
  'SCHEDULER_WEEKLY_TIME',
]

const recommendedEnvVars = [
  'QQ_ALLOWED_CONTEXT_IDS',
  'QQ_SCHEDULER_REPLY_WINDOW_HOURS',
]

const results = []

function record(id, purpose, ok, evidence = '') {
  results.push({ id, purpose, ok, evidence })
}

function readText(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : ''
}

function includesAll(text, values) {
  const missing = values.filter((value) => !text.includes(value))
  return { ok: missing.length === 0, missing }
}

const packageJson = JSON.parse(readText(packagePath) || '{}')
const packageScripts = packageJson.scripts || {}

record(
  'DEPLOY-PACKAGE',
  'package scripts expose web, QQ worker and scheduler commands',
  Boolean(packageScripts.start && packageScripts['worker:qq'] && packageScripts['worker:scheduler']),
  `start=${packageScripts.start || 'missing'}; worker:qq=${packageScripts['worker:qq'] || 'missing'}; worker:scheduler=${packageScripts['worker:scheduler'] || 'missing'}`,
)

for (const service of serviceFiles) {
  const path = resolve(deployDir, service.file)
  const text = readText(path)
  record(
    `DEPLOY-${service.id}-EXISTS`,
    `${service.description} template exists`,
    Boolean(text),
    service.file,
  )
  const required = [
    'After=network-online.target',
    'WorkingDirectory=/opt/goal-mate/src',
    'EnvironmentFile=/opt/goal-mate/src/.env',
    `ExecStart=/usr/bin/env ${service.command}`,
    'Restart=always',
    'RestartSec=5',
    'WantedBy=multi-user.target',
  ]
  const check = includesAll(text, required)
  record(
    `DEPLOY-${service.id}-CONTENT`,
    `${service.description} template contains required systemd directives`,
    check.ok,
    check.ok ? 'required directives present' : `missing=${check.missing.join(', ')}`,
  )
}

for (const script of runtimeScripts) {
  const scriptPath = resolve(appRoot, script.file)
  const check = spawnSync(process.execPath, ['--check', scriptPath], {
    cwd: appRoot,
    encoding: 'utf8',
  })
  const output = `${check.stdout || ''}${check.stderr || ''}`.trim()
  record(
    `DEPLOY-${script.id}-SYNTAX`,
    `${script.description} passes Node syntax check`,
    check.status === 0,
    check.status === 0 ? `${script.file} syntax ok` : output.slice(0, 240),
  )
}

const readme = readText(resolve(deployDir, 'README.md'))
record(
  'DEPLOY-README',
  'systemd README documents install, start, status and logs',
  Boolean(readme && ['systemctl enable --now', 'systemctl status', 'journalctl', 'pnpm db:generate'].every((item) => readme.includes(item))),
  readme ? 'README contains deployment commands' : 'missing README',
)

const envExample = readText(envExamplePath)
const envCheck = includesAll(envExample, requiredEnvVars)
record(
  'DEPLOY-ENV-EXAMPLE',
  '.env.example documents required deployment variables',
  envCheck.ok,
  envCheck.ok ? 'all required variables present' : `missing=${envCheck.missing.join(', ')}`,
)
const recommendedEnvCheck = includesAll(envExample, recommendedEnvVars)
record(
  'DEPLOY-ENV-RECOMMENDED',
  '.env.example documents recommended safety variables',
  recommendedEnvCheck.ok,
  recommendedEnvCheck.ok ? 'all recommended variables present' : `missing=${recommendedEnvCheck.missing.join(', ')}`,
)
record(
  'DEPLOY-ENV-PLACEHOLDERS',
  '.env.example does not use token-shaped placeholders',
  Boolean(envExample && !/sk-[A-Za-z0-9_-]{12,}/.test(envExample) && !/[0-9]{6,12}:[A-Za-z0-9_-]{20,}/.test(envExample)),
  'token-shaped placeholder scan completed',
)

const doc = readText(resolve(projectRoot, 'docs/designs/self-hosted-worker-deployment.md'))
record(
  'DEPLOY-DESIGN-DOC',
  'self-hosted worker deployment design references systemd templates and remaining gaps',
  Boolean(doc && doc.includes('deploy/systemd') && doc.includes('尚未在服务器上完成长期运行验证')),
  doc ? 'deployment design updated' : 'missing deployment design',
)

const runtimePlan = readText(resolve(projectRoot, 'docs/plans/self-hosted-runtime-verification-plan.md'))
record(
  'DEPLOY-RUNTIME-PLAN',
  'self-hosted runtime verification plan documents real long-running checks',
  Boolean(runtimePlan && runtimePlan.includes('Web') && runtimePlan.includes('QQ Worker') && runtimePlan.includes('Scheduler Worker') && runtimePlan.includes('AgentToolAction.source = scheduler') && runtimePlan.includes('self-hosted-runtime-verification-report-template.md')),
  runtimePlan ? 'runtime verification plan present' : 'missing runtime verification plan',
)

const runtimeReportTemplate = readText(resolve(projectRoot, 'docs/plans/self-hosted-runtime-verification-report-template.md'))
record(
  'DEPLOY-RUNTIME-REPORT',
  'self-hosted runtime verification report template documents sanitized evidence format',
  Boolean(runtimeReportTemplate && runtimeReportTemplate.includes('不得记录任何 API Key') && runtimeReportTemplate.includes('RUNTIME-SCHEDULER-REPLY') && runtimeReportTemplate.includes('source=scheduler')),
  runtimeReportTemplate ? 'runtime verification report template present' : 'missing runtime verification report template',
)

const lines = [
  '# Goal Mate Deployment Config Verification',
  '',
  `- Time: ${new Date().toISOString()}`,
  `- Project root: ${projectRoot}`,
  '',
  '| ID | Purpose | Result | Evidence |',
  '| --- | --- | --- | --- |',
  ...results.map((result) => `| ${result.id} | ${result.purpose} | ${result.ok ? 'PASS' : 'FAIL'} | ${String(result.evidence || '').replaceAll('|', '\\|')} |`),
  '',
]

const markdown = lines.join('\n')
console.log(markdown)

if (shouldWrite) {
  writeFileSync(resolve(projectRoot, 'docs/plans/deployment-config-last-run.md'), markdown)
}

process.exit(results.every((result) => result.ok) ? 0 : 1)
