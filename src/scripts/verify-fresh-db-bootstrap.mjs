import { spawnSync } from 'node:child_process'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PrismaClient } from '@prisma/client'

const shouldWrite = process.argv.includes('--write')
const keepDb = process.argv.includes('--keep-db')
const scriptDir = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(scriptDir, '..')
const projectRoot = resolve(appRoot, '..')
const pnpmBin = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const results = []
let tempDir = ''
let tempDatabaseUrl = ''
let prisma = null

function compact(value, max = 1600) {
  const text = String(value || '').replace(/\r/g, '').trim()
  if (text.length <= max) return text
  return `...${text.slice(text.length - max)}`
}

function record(id, purpose, ok, evidence = '') {
  results.push({ id, purpose, ok, evidence })
}

function sanitizeMarkdown(value) {
  return String(value || '').replaceAll('|', '\\|').replace(/\n/g, '<br>')
}

function quoteSqliteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`
}

function numericCount(row) {
  const value = row?.count ?? row?.['COUNT(*)'] ?? 0
  return Number(value)
}

async function listBusinessTables(client) {
  const rows = await client.$queryRaw`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name NOT LIKE '_prisma_%'
      AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `
  return rows.map((row) => row.name)
}

async function countRows(client, tableName) {
  const rows = await client.$queryRawUnsafe(`SELECT COUNT(*) as count FROM ${quoteSqliteIdentifier(tableName)}`)
  return numericCount(rows[0])
}

async function countAllBusinessRows(client, tables) {
  const counts = {}
  for (const table of tables) {
    counts[table] = await countRows(client, table)
  }
  return counts
}

function writeReport() {
  const failed = results.filter((item) => !item.ok)
  const lines = [
    '# Goal Mate Fresh DB Bootstrap Verification',
    '',
    `- Time: ${new Date().toISOString()}`,
    `- Project root: ${projectRoot}`,
    `- Temp DB: ${keepDb ? tempDatabaseUrl || 'not-created' : 'removed after run'}`,
    `- Result: ${failed.length === 0 ? 'PASS' : 'FAIL'}`,
    '',
    '## Scope',
    '',
    'This report proves a brand-new SQLite database can run Prisma migrations, starts without business/demo rows, and can perform a minimal user write/read/delete cycle. It does not reset or mutate the current development database.',
    '',
    '## Checks',
    '',
    '| ID | Purpose | Result | Evidence |',
    '| --- | --- | --- | --- |',
    ...results.map((item) => `| ${item.id} | ${item.purpose} | ${item.ok ? 'PASS' : 'FAIL'} | ${sanitizeMarkdown(item.evidence)} |`),
    '',
  ]
  const markdown = lines.join('\n')
  console.log(markdown)
  if (shouldWrite) {
    writeFileSync(resolve(projectRoot, 'docs/plans/fresh-db-bootstrap-last-run.md'), markdown)
  }
  return failed.length
}

async function cleanup() {
  if (prisma) {
    await prisma.$disconnect()
  }
  if (!keepDb && tempDir) {
    const allowedPrefix = join(tmpdir(), 'goal-mate-fresh-db-')
    if (!tempDir.startsWith(allowedPrefix)) {
      record('FDB-CLEANUP', 'temporary database directory is safely scoped before deletion', false, `refused to remove unexpected path=${tempDir}`)
      return
    }
    rmSync(tempDir, { recursive: true, force: true })
    record('FDB-CLEANUP', 'temporary database directory is removed after verification', !existsSync(tempDir), `tempDir=${tempDir}`)
  } else if (keepDb && tempDir) {
    record('FDB-CLEANUP', 'temporary database directory is preserved when --keep-db is used', existsSync(tempDir), `tempDir=${tempDir}`)
  }
}

async function main() {
  tempDir = await mkdtemp(join(tmpdir(), 'goal-mate-fresh-db-'))
  const dbPath = join(tempDir, 'fresh.db')
  tempDatabaseUrl = `file:${dbPath}`

  const migration = spawnSync(pnpmBin, ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: appRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      DATABASE_URL: tempDatabaseUrl,
      FORCE_COLOR: '0',
      PRISMA_HIDE_UPDATE_MESSAGE: 'true',
    },
  })
  record(
    'FDB-MIGRATE',
    'brand-new SQLite database accepts all Prisma migrations',
    migration.status === 0,
    [
      `$ DATABASE_URL=file:<temp>/fresh.db ${pnpmBin} exec prisma migrate deploy`,
      `exit=${migration.status ?? 'signal'}`,
      compact(`${migration.stdout || ''}\n${migration.stderr || ''}`),
    ].filter(Boolean).join('\n'),
  )

  if (migration.status !== 0) return

  record(
    'FDB-FILE',
    'migration creates the temporary SQLite database file',
    existsSync(dbPath),
    `dbPath=${dbPath}`,
  )

  prisma = new PrismaClient({
    datasources: {
      db: {
        url: tempDatabaseUrl,
      },
    },
  })

  const tables = await listBusinessTables(prisma)
  const expectedTables = ['user', 'Goal', 'MarkdownDocument', 'AgentThread', 'ModelConfig', 'ReminderRule', 'SchedulerEvent']
  const missingTables = expectedTables.filter((table) => !tables.includes(table))
  record(
    'FDB-SCHEMA',
    'fresh schema exposes core user, goal, markdown, agent, model, reminder and scheduler tables',
    missingTables.length === 0,
    missingTables.length === 0 ? `businessTables=${tables.length}` : `missing=${missingTables.join(', ')}`,
  )

  const initialCounts = await countAllBusinessRows(prisma, tables)
  const dirtyTables = Object.entries(initialCounts).filter(([, count]) => count !== 0)
  record(
    'FDB-CLEAN',
    'fresh database starts with zero business rows and no fake/demo data',
    dirtyTables.length === 0,
    dirtyTables.length === 0 ? `checkedTables=${tables.length}` : JSON.stringify(Object.fromEntries(dirtyTables)),
  )

  const email = `fresh-db-${Date.now()}@goalmate.local`
  const user = await prisma.user.create({
    data: {
      email,
      name: 'Fresh DB User',
      emailVerified: true,
    },
  })
  const found = await prisma.user.findUnique({ where: { id: user.id } })
  await prisma.user.delete({ where: { id: user.id } })
  const finalUserCount = await prisma.user.count()
  record(
    'FDB-WRITE-READ',
    'fresh database can create, read and delete a minimal user without touching current dev data',
    Boolean(found && found.email === email && finalUserCount === 0),
    `createdUser=${Boolean(user.id)}; readBack=${Boolean(found)}; finalUserCount=${finalUserCount}`,
  )
}

try {
  await main()
} catch (error) {
  record('FDB-UNCAUGHT', 'fresh database verification completes without uncaught exception', false, error instanceof Error ? error.stack || error.message : String(error))
} finally {
  await cleanup()
  const failedCount = writeReport()
  process.exit(failedCount === 0 ? 0 : 1)
}
