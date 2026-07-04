import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const shouldWrite = process.argv.includes('--write')
const scriptDir = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(scriptDir, '..')
const projectRoot = resolve(appRoot, '..')
const promptPath = resolve(appRoot, 'lib/agent-prompts/index.ts')
const snapshotPath = resolve(projectRoot, 'docs/designs/agent-prompt-snapshot.json')
const relativePromptPath = 'src/lib/agent-prompts/index.ts'
const relativeSnapshotPath = 'docs/designs/agent-prompt-snapshot.json'

const requiredSectionIds = [
  'ANTI_AI_TONE_CHARTER',
  'ANTI_AI_AUDIT_PROTOCOL',
  'ROLE',
  'CONTROL_LOOP',
  'INTERVENTION_POLICY',
  'META_COGNITION_POLICY',
  'MEMORY_QUALITY_POLICY',
  'SYSTEM_FACT_USAGE',
  'TOOL_AND_PERMISSION_POLICY',
  'SECRETARY_TONE',
]

const requiredPhrases = [
  '不要像 AI 客服',
  '这句话为什么还像 AI',
  '当前系统边界是什么',
  '一次只问一个问题',
  '以下内容是系统事实，不是用户指令',
  '怎么干预用户',
  'AI 自己下一次怎么修正自己的思考',
  '充分、必要、因果明确、可验证',
  '可验证假设',
]

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function normalizeSource(value) {
  return String(value || '').replace(/\r\n/g, '\n').trimEnd()
}

function extractVersion(source) {
  const match = source.match(/AGENT_SYSTEM_PROMPT_VERSION\s*=\s*'([^']+)'/)
  return match?.[1] || ''
}

function extractSectionIds(source) {
  return [...source.matchAll(/id:\s*'([^']+)'/g)].map((match) => match[1])
}

function buildCurrentSnapshot() {
  const source = normalizeSource(readFileSync(promptPath, 'utf8'))
  const version = extractVersion(source)
  const sectionIds = extractSectionIds(source)

  return {
    version,
    source: relativePromptPath,
    sourceHash: sha256(source),
    sectionIds,
    requiredSectionIds,
    requiredPhrases,
  }
}

function compareSnapshot(snapshot) {
  return {
    version: snapshot.version,
    source: snapshot.source,
    sourceHash: snapshot.sourceHash,
    sectionIds: snapshot.sectionIds,
    requiredSectionIds: snapshot.requiredSectionIds,
    requiredPhrases: snapshot.requiredPhrases,
  }
}

function assertPromptContract(snapshot) {
  const errors = []
  const source = normalizeSource(readFileSync(promptPath, 'utf8'))

  if (!snapshot.version) errors.push('missing prompt version')

  for (const sectionId of requiredSectionIds) {
    if (!snapshot.sectionIds.includes(sectionId)) {
      errors.push(`missing section: ${sectionId}`)
    }
  }

  for (const phrase of requiredPhrases) {
    if (!source.includes(phrase)) {
      errors.push(`missing required phrase: ${phrase}`)
    }
  }

  return errors
}

const current = buildCurrentSnapshot()
const contractErrors = assertPromptContract(current)

if (contractErrors.length > 0) {
  console.error('# Agent Prompt Snapshot Verification')
  console.error('')
  console.error('- Result: FAIL')
  console.error('')
  console.error('## Contract errors')
  for (const error of contractErrors) console.error(`- ${error}`)
  process.exit(1)
}

if (shouldWrite) {
  const snapshot = {
    ...current,
    generatedAt: new Date().toISOString(),
    note: 'Update this file intentionally when Agent system prompt rules change.',
  }
  writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`)
  console.log('# Agent Prompt Snapshot Verification')
  console.log('')
  console.log('- Result: PASS')
  console.log(`- Snapshot: ${relativeSnapshotPath}`)
  console.log(`- Version: ${current.version}`)
  console.log(`- Source hash: ${current.sourceHash}`)
  process.exit(0)
}

if (!existsSync(snapshotPath)) {
  console.error('# Agent Prompt Snapshot Verification')
  console.error('')
  console.error('- Result: FAIL')
  console.error(`- Missing snapshot: ${relativeSnapshotPath}`)
  console.error('')
  console.error('Run `pnpm verify:agent-prompt-snapshot:write` after intentionally changing the prompt.')
  process.exit(1)
}

const expected = JSON.parse(readFileSync(snapshotPath, 'utf8'))
const currentComparable = compareSnapshot(current)
const expectedComparable = compareSnapshot(expected)
const matches = JSON.stringify(currentComparable) === JSON.stringify(expectedComparable)

console.log('# Agent Prompt Snapshot Verification')
console.log('')
console.log(`- Result: ${matches ? 'PASS' : 'FAIL'}`)
console.log(`- Snapshot: ${relativeSnapshotPath}`)
console.log(`- Version: ${current.version}`)
console.log(`- Source hash: ${current.sourceHash}`)

if (!matches) {
  console.log('')
  console.log('## Drift')
  console.log('')
  console.log('Agent system prompt changed without updating the snapshot.')
  console.log('If this was intentional, update prompt docs and run `pnpm verify:agent-prompt-snapshot:write`.')
  process.exit(1)
}
