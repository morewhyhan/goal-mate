import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const shouldWrite = process.argv.includes('--write')
const scriptDir = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(scriptDir, '..')
const projectRoot = resolve(appRoot, '..')
const pnpmBin = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const baseUrl = process.env.GOAL_MATE_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || process.env.BETTER_AUTH_URL || ''
const results = []

function compact(value, max = 1400) {
  const text = String(value || '').replace(/\r/g, '').trim()
  if (text.length <= max) return text
  return `...${text.slice(text.length - max)}`
}

function record(id, purpose, ok, evidence = '') {
  results.push({ id, purpose, ok, evidence })
}

function runCommand(item) {
  const startedAt = Date.now()
  const child = spawnSync(item.command[0], item.command.slice(1), {
    cwd: appRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      FORCE_COLOR: '0',
      ...(baseUrl ? {
        GOAL_MATE_BASE_URL: process.env.GOAL_MATE_BASE_URL || baseUrl,
        BETTER_AUTH_URL: process.env.BETTER_AUTH_URL || baseUrl,
        NEXT_PUBLIC_BETTER_AUTH_URL: process.env.NEXT_PUBLIC_BETTER_AUTH_URL || baseUrl,
      } : {}),
    },
  })
  const durationMs = Date.now() - startedAt
  const output = compact(`${child.stdout || ''}\n${child.stderr || ''}`)
  record(
    item.id,
    item.purpose,
    child.status === 0,
    [
      `$ ${item.command.join(' ')}`,
      `exit=${child.status ?? 'signal'}; durationMs=${durationMs}`,
      output,
    ].filter(Boolean).join('\n'),
  )
}

const checks = [
  {
    id: 'ZOF-TYPECHECK',
    purpose: '代码层仍满足 TypeScript 类型约束',
    command: [pnpmBin, 'typecheck'],
  },
  {
    id: 'ZOF-AUTH-ISOLATION',
    purpose: '登录、用户数据隔离、模型密钥隔离和 QQ 绑定码归属仍成立',
    command: [pnpmBin, 'verify:auth-isolation'],
  },
  {
    id: 'ZOF-DEPLOYMENT-CONFIG',
    purpose: 'Settings/Env/systemd/worker 的部署配置边界仍可被静态证明',
    command: [pnpmBin, 'verify:deployment-config'],
  },
  {
    id: 'ZOF-FRESH-DB-BOOTSTRAP',
    purpose: '全新 SQLite 数据库可迁移、业务表为空、没有假任务或残留数据，并能完成最小读写',
    command: [pnpmBin, 'verify:fresh-db'],
  },
  {
    id: 'ZOF-AGENT-STATIC',
    purpose: 'Agent 工具、Prompt、上下文读取和核心契约仍存在',
    command: [pnpmBin, 'verify:agent-loop:static'],
  },
  {
    id: 'ZOF-AI-REPLY-QUALITY',
    purpose: 'Agent 回复质量门禁仍能拒绝 AI 味、泛鼓励、越权和空泛回复',
    command: [pnpmBin, 'verify:ai-reply-quality'],
  },
  {
    id: 'ZOF-AGENT-PROMPT-SNAPSHOT',
    purpose: 'Agent system prompt 的秘书语气、控制闭环、元认知和权限规则没有发生未记录漂移',
    command: [pnpmBin, 'verify:agent-prompt-snapshot'],
  },
  {
    id: 'ZOF-AGENT-CONTEXT-RUNTIME',
    purpose: 'Web Agent 真实模型请求会注入当前用户 Goal/Logs/元认知上下文，并遵守权限和用户隔离',
    command: [pnpmBin, 'verify:agent-context'],
  },
  {
    id: 'ZOF-AGENT-CONTROL-ACTIONS',
    purpose: 'Web Agent 能通过确认机制修改模型配置和提醒规则，并在 Settings 中留下审计',
    command: [pnpmBin, 'verify:agent-control'],
  },
  {
    id: 'ZOF-SETTINGS-SELF-SERVICE',
    purpose: '干净用户能在 Settings 自助配置模型、QQ、提醒节奏和行为参数，并由控制中心看到可用状态',
    command: [pnpmBin, 'verify:settings-self-service'],
  },
  {
    id: 'ZOF-INTERVENTION-PLANNER',
    purpose: '自主干预 Planner 仍能降难度、识别风险、拒绝泛鼓励并生成可验证元认知',
    command: [pnpmBin, 'verify:intervention-planner'],
  },
  {
    id: 'ZOF-CONTROL-LOOP-EMERGENCE',
    purpose: '反馈、元认知、policy_delta 和 AI 自我优化仍能影响下一次干预',
    command: [pnpmBin, 'verify:control-loop-emergence'],
  },
  {
    id: 'ZOF-FIRST-RUN-AGENT',
    purpose: '全新用户可从空状态通过 Agent 说明目标、生成草案、确认激活并进入 Today',
    command: [pnpmBin, 'verify:first-run-agent'],
  },
  {
    id: 'ZOF-TODAY-FEEDBACK-LOOP',
    purpose: '干净用户在 Today 提交完成反馈后，会写入行动状态、诊断、日志、热力图和 Goals 只读状态',
    command: [pnpmBin, 'verify:today-feedback'],
  },
  {
    id: 'ZOF-EMPTY-DASHBOARD-BROWSER',
    purpose: '干净新用户打开五个 Dashboard 页面时看到空状态和真实配置边界，而不是假任务或 demo 数据',
    command: [pnpmBin, 'verify:dashboard-browser:empty-auth'],
  },
  {
    id: 'ZOF-SCHEDULER-RULES',
    purpose: 'Settings 保存的提醒规则会被 Scheduler 消费，并尊重关闭、每日上限和免打扰',
    command: [pnpmBin, 'verify:scheduler-rules'],
  },
  {
    id: 'ZOF-QQ-SCHEDULER-REPLY',
    purpose: 'QQ 主动提醒后的用户回复能进入 Check-in、Diagnosis、Logs、Review 和 SchedulerEvent',
    command: [pnpmBin, 'verify:qq-scheduler-reply'],
  },
]

for (const item of checks) {
  runCommand(item)
}

const failed = results.filter((item) => !item.ok)
const lines = [
  '# Goal Mate Zero-to-one Product Flow Verification',
  '',
  `- Time: ${new Date().toISOString()}`,
  `- Project root: ${projectRoot}`,
  `- Result: ${failed.length === 0 ? 'PASS' : 'FAIL'}`,
  '',
  '## Scope',
  '',
  'This report proves the local v0.1 product path from clean database bootstrap and clean user state to user-managed Settings configuration, Agent-created goal, Today feedback persistence, runtime Agent context injection, Agent-confirmed settings control, adaptive intervention, AI self-optimization, user-configured reminder rules, and QQ reply ingestion. It does not prove real QQ Gateway long-running delivery, server systemd uptime, or long-term live model quality.',
  '',
  '## Checks',
  '',
  '| ID | Purpose | Result | Evidence |',
  '| --- | --- | --- | --- |',
  ...results.map((item) => `| ${item.id} | ${item.purpose} | ${item.ok ? 'PASS' : 'FAIL'} | ${String(item.evidence || '').replaceAll('|', '\\|').replace(/\n/g, '<br>')} |`),
  '',
]

const markdown = lines.join('\n')
console.log(markdown)

if (shouldWrite) {
  writeFileSync(resolve(projectRoot, 'docs/plans/zero-to-one-product-flow-last-run.md'), markdown)
}

process.exit(failed.length === 0 ? 0 : 1)
