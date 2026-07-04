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
    extraRequired: ['Environment=HOSTNAME=0.0.0.0', 'Environment=PORT=3000'],
  },
  {
    id: 'QQ',
    file: 'goal-mate-qq-worker.service',
    command: 'pnpm worker:qq',
    description: 'QQ Gateway worker service',
    extraRequired: [],
  },
  {
    id: 'SCHEDULER',
    file: 'goal-mate-scheduler-worker.service',
    command: 'pnpm worker:scheduler',
    description: 'Scheduler worker service',
    extraRequired: [],
  },
]

const runtimeScripts = [
  { id: 'DEV-SUPERVISOR', file: 'scripts/dev-supervisor.mjs', description: 'local dev supervisor script' },
  { id: 'QQ-WORKER', file: 'scripts/qq-bot-worker.mjs', description: 'QQ worker script' },
  { id: 'SCHEDULER-WORKER', file: 'scripts/scheduler-worker.mjs', description: 'Scheduler worker script' },
  { id: 'RUNTIME-HEARTBEAT', file: 'lib/runtime-heartbeat.mjs', description: 'runtime heartbeat helper' },
  { id: 'DEPLOY-BUNDLE', file: 'scripts/create-deploy-bundle.mjs', description: 'Local deployment bundle script' },
  { id: 'ZERO-TO-ONE-VERIFY', file: 'scripts/verify-zero-to-one-product-flow.mjs', description: 'zero-to-one product flow verifier' },
  { id: 'QQ-SCHEDULER-REPLY-VERIFY', file: 'scripts/verify-qq-scheduler-reply-loop.mjs', description: 'QQ scheduler reply loop verifier' },
  { id: 'LIVE-MODEL-AGENT-VERIFY', file: 'scripts/verify-live-model-agent-flow.mjs', description: 'live model Agent flow verifier' },
]

const deployScripts = [
  { id: 'SYSTEMD-INSTALL', file: 'deploy/install-systemd.sh', description: 'systemd install script' },
]

const requiredEnvVars = [
  'DATABASE_URL',
  'NEXT_PUBLIC_APP_URL',
  'GOAL_MATE_SECRET',
]

const defaultedEnvVars = [
  'PORT',
  'HOSTNAME',
  'DEEPSEEK_API_BASE',
  'DEEPSEEK_MODEL',
  'QQ_BOT_API_BASE',
  'QQ_BOT_INTENTS',
  'SCHEDULER_TICK_SECONDS',
  'SCHEDULER_TIMEZONE',
  'SCHEDULER_MORNING_TIME',
  'SCHEDULER_MIDDAY_TIME',
  'SCHEDULER_EVENING_TIME',
  'SCHEDULER_WEEKLY_TIME',
]

const recommendedEnvVars = [
  'BETTER_AUTH_URL',
  'NEXT_PUBLIC_BETTER_AUTH_URL',
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
  'package scripts expose supervised dev, web, QQ worker, scheduler, one-shot scheduler, local bundle and zero-to-one verification commands',
  Boolean(packageScripts.dev && packageScripts.dev.includes('dev-supervisor') && packageScripts.start && packageScripts['worker:qq'] && packageScripts['worker:scheduler'] && packageScripts['worker:scheduler:once'] && packageScripts['deploy:bundle'] && packageScripts['deploy:systemd:install'] && packageScripts['verify:zero-to-one'] && packageScripts['verify:qq-scheduler-reply'] && packageScripts['verify:dashboard-browser:empty-auth'] && packageScripts['verify:live-model-agent']),
  `dev=${packageScripts.dev || 'missing'}; start=${packageScripts.start || 'missing'}; worker:qq=${packageScripts['worker:qq'] || 'missing'}; worker:scheduler=${packageScripts['worker:scheduler'] || 'missing'}; worker:scheduler:once=${packageScripts['worker:scheduler:once'] || 'missing'}; deploy:bundle=${packageScripts['deploy:bundle'] || 'missing'}; deploy:systemd:install=${packageScripts['deploy:systemd:install'] || 'missing'}; verify:zero-to-one=${packageScripts['verify:zero-to-one'] || 'missing'}; verify:qq-scheduler-reply=${packageScripts['verify:qq-scheduler-reply'] || 'missing'}; verify:dashboard-browser:empty-auth=${packageScripts['verify:dashboard-browser:empty-auth'] || 'missing'}; verify:live-model-agent=${packageScripts['verify:live-model-agent'] || 'missing'}`,
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
    ...(service.extraRequired || []),
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

for (const script of deployScripts) {
  const scriptPath = resolve(projectRoot, script.file)
  const text = readText(scriptPath)
  record(
    `DEPLOY-${script.id}-EXISTS`,
    `${script.description} exists`,
    Boolean(text),
    script.file,
  )
  record(
    `DEPLOY-${script.id}-CONTENT`,
    `${script.description} installs and enables all systemd services`,
    Boolean(text && ['systemctl daemon-reload', 'systemctl enable', 'goal-mate-web.service', 'goal-mate-qq-worker.service', 'goal-mate-scheduler-worker.service'].every((item) => text.includes(item))),
    text ? 'install script contains service install commands' : 'missing install script',
  )
}

const readme = readText(resolve(deployDir, 'README.md'))
record(
  'DEPLOY-README',
  'systemd README documents local bundle, automated install, manual install, status and logs',
  Boolean(readme && ['pnpm deploy:bundle', 'pnpm deploy:systemd:install', 'systemctl enable --now', 'systemctl status', 'journalctl', 'pnpm db:generate'].every((item) => readme.includes(item))),
  readme ? 'README contains deployment commands' : 'missing README',
)
record(
  'DEPLOY-README-NO-DEFAULT-USER',
  'systemd README documents QQ binding-code ownership instead of default-user auto binding',
  Boolean(readme && readme.includes('QqChatBinding') && readme.includes('生成绑定码') && !readme.includes('QQ_DEFAULT_USER_EMAIL') && !readme.includes('自动绑定') && !readme.includes('默认绑定用户')),
  readme ? 'README QQ ownership boundary scanned' : 'missing README',
)

const rootGitignore = readText(resolve(projectRoot, '.gitignore'))
record(
  'DEPLOY-LOCAL-ARTIFACTS-IGNORED',
  'local deployment bundles are ignored by git',
  Boolean(rootGitignore && rootGitignore.includes('.artifacts/')),
  rootGitignore ? '.artifacts/ ignore rule present' : 'missing root .gitignore',
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
const defaultedEnvCheck = includesAll(envExample, defaultedEnvVars)
record(
  'DEPLOY-ENV-DEFAULTS',
  '.env.example documents defaulted variables users normally do not need to change',
  defaultedEnvCheck.ok,
  defaultedEnvCheck.ok ? 'defaulted variables present' : `missing=${defaultedEnvCheck.missing.join(', ')}`,
)
const settingsRoute = readText(resolve(appRoot, 'server/api/routes/settings/index.ts'))
const settingsView = readText(resolve(appRoot, 'components/goal-mate/settings-view.tsx'))
const prismaSchema = readText(resolve(appRoot, 'prisma/schema.prisma'))
const qqWorker = readText(resolve(appRoot, 'scripts/qq-bot-worker.mjs'))
const schedulerWorker = readText(resolve(appRoot, 'scripts/scheduler-worker.mjs'))
const devSupervisor = readText(resolve(appRoot, 'scripts/dev-supervisor.mjs'))
const qqBotConfig = readText(resolve(appRoot, 'lib/qq-bot-config.mjs'))
record(
  'DEPLOY-SETTINGS-UI',
  'Settings exposes deployment readiness and separates env-only secrets from UI-managed parameters',
  Boolean(settingsRoute.includes('deploymentEnvConfig') && settingsRoute.includes('minimumRequired') && settingsRoute.includes('/qq-bot') && settingsView.includes('部署状态') && settingsView.includes('保存 QQ') && settingsView.includes('生成绑定码') && settingsView.includes('modelTestResult') && settingsView.includes('模型连接不可用')),
  'Settings deployment readiness contract scanned',
)
record(
  'DEPLOY-DEV-SUPERVISOR',
  'local pnpm dev starts Web, QQ Worker and Scheduler Worker together',
  Boolean(devSupervisor && devSupervisor.includes("start('web'") && devSupervisor.includes("start('qq'") && devSupervisor.includes("start('scheduler'")),
  'dev supervisor contract scanned',
)
record(
  'DEPLOY-RUNTIME-HEARTBEAT',
  'Web, QQ Worker and Scheduler Worker write runtime heartbeats visible in Settings',
  Boolean(
    prismaSchema.includes('model RuntimeHeartbeat')
    && settingsRoute.includes('runtimeHeartbeat.findMany')
    && settingsView.includes('QQ Worker')
    && settingsView.includes('RuntimeStatusPill')
    && qqWorker.includes('touchRuntimeHeartbeat')
    && schedulerWorker.includes('touchRuntimeHeartbeat')
  ),
  'runtime heartbeat contract scanned',
)
record(
  'DEPLOY-QQ-BINDING-SAFETY',
  'QQ worker requires explicit binding code before assigning an unbound QQ context to a user and has no default-user fallback',
  Boolean(
    qqWorker.includes('normalizeQqBindingCode')
    && qqWorker.includes('findQqAccountByBindingCode')
    && qqWorker.includes('missing_binding_code')
    && qqBotConfig.includes('issueQqBindingCode')
    && !qqBotConfig.includes('QQ_DEFAULT_USER_EMAIL')
    && !qqBotConfig.includes('process.env.QQ_BOT_APP_ID')
    && !qqBotConfig.includes('process.env.QQ_BOT_TOKEN')
    && !qqBotConfig.includes('env.QQ_BOT_APP_ID')
    && !qqBotConfig.includes('env.QQ_BOT_TOKEN')
    && !qqBotConfig.includes('process.env.QQ_DEFAULT_USER_EMAIL')
    && !qqBotConfig.includes('env.QQ_DEFAULT_USER_EMAIL')
    && !qqWorker.includes('defaultUserEmail')
    && !settingsRoute.includes('defaultUserEmail')
    && !settingsView.includes('defaultUserEmail')
    && !qqWorker.includes("await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } })")
  ),
  'QQ binding-code contract scanned',
)
record(
  'DEPLOY-ENV-PLACEHOLDERS',
  '.env.example does not use token-shaped placeholders',
  Boolean(envExample && !/sk-[A-Za-z0-9_-]{12,}/.test(envExample) && !/[0-9]{6,12}:[A-Za-z0-9_-]{20,}/.test(envExample)),
  'token-shaped placeholder scan completed',
)
record(
  'DEPLOY-ENV-NO-USER-QQ-SECRETS',
  '.env.example does not expose user-level QQ App ID or Token fields',
  Boolean(envExample && !envExample.includes('QQ_BOT_APP_ID') && !envExample.includes('QQ_BOT_TOKEN')),
  'QQ App ID and Token must be configured per account in Settings',
)

const doc = readText(resolve(projectRoot, 'docs/designs/self-hosted-worker-deployment.md'))
record(
  'DEPLOY-DESIGN-DOC',
  'self-hosted worker deployment design references systemd templates and remaining gaps',
  Boolean(doc && doc.includes('deploy/systemd') && doc.includes('尚未在服务器上完成长期运行验证')),
  doc ? 'deployment design updated' : 'missing deployment design',
)

const qqDoc = readText(resolve(projectRoot, 'docs/designs/qq-bot-integration.md'))
record(
  'DEPLOY-QQ-NO-DEFAULT-USER-DOC',
  'QQ integration docs require binding-code ownership instead of default-user auto binding',
  Boolean(
    qqDoc
    && qqDoc.includes('生成绑定码')
    && qqDoc.includes('QqChatBinding')
    && qqDoc.includes('默认用户') === false
    && qqDoc.includes('demo@goalmate.local') === false
    && qqDoc.includes('QQ_DEFAULT_USER_EMAIL') === false
    && qqDoc.includes('QQ_BOT_APP_ID') === false
    && qqDoc.includes('QQ_BOT_TOKEN') === false
  ),
  qqDoc ? 'QQ docs no longer document default-user binding' : 'missing QQ integration doc',
)

const runtimePlan = readText(resolve(projectRoot, 'docs/plans/self-hosted-runtime-verification-plan.md'))
record(
  'DEPLOY-RUNTIME-PLAN',
  'self-hosted runtime verification plan documents real long-running checks',
  Boolean(runtimePlan && runtimePlan.includes('Web') && runtimePlan.includes('QQ Worker') && runtimePlan.includes('Scheduler Worker') && runtimePlan.includes('AgentToolAction.source = scheduler') && runtimePlan.includes('self-hosted-runtime-verification-report-template.md') && runtimePlan.includes('QqChatBinding') && !runtimePlan.includes('QQ_DEFAULT_USER_EMAIL')),
  runtimePlan ? 'runtime verification plan present' : 'missing runtime verification plan',
)

const runtimeReportTemplate = readText(resolve(projectRoot, 'docs/plans/self-hosted-runtime-verification-report-template.md'))
record(
  'DEPLOY-RUNTIME-REPORT',
  'self-hosted runtime verification report template documents sanitized evidence format',
  Boolean(runtimeReportTemplate && runtimeReportTemplate.includes('不得记录任何 API Key') && runtimeReportTemplate.includes('RUNTIME-SCHEDULER-REPLY') && runtimeReportTemplate.includes('source=scheduler') && runtimeReportTemplate.includes('Settings QQ Bot App ID') && !runtimeReportTemplate.includes('QQ_BOT_TOKEN')),
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
