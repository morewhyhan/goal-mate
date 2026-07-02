import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(scriptDir, '..')
const projectRoot = resolve(appRoot, '..')

const ignoredDirectories = new Set([
  '.git',
  '.codex',
  '.claude',
  '.ai',
  'node_modules',
  '.next',
  '.vite',
  'dist',
  'build',
  'coverage',
  'tmp',
  '.tmp',
  'example-obsidian-library-of-dice',
])

const ignoredExtensions = new Set([
  '.db',
  '.sqlite',
  '.sqlite3',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.pdf',
  '.zip',
  '.gz',
  '.tar',
  '.woff',
  '.woff2',
])

const secretPatterns = [
  {
    id: 'MODEL_API_KEY',
    description: 'model API key shape',
    pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    id: 'BOT_TOKEN',
    description: 'bot token shape',
    pattern: /\b[0-9]{6,12}:[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    id: 'BEARER_TOKEN',
    description: 'Authorization bearer token shape',
    pattern: /\bBearer\s+[A-Za-z0-9._~-]{24,}\b/g,
  },
]

function shouldSkipFile(path) {
  const basename = path.split('/').pop() || ''
  if (basename === '.env.example') return false
  if (basename === '.env' || basename.startsWith('.env.')) return true
  return ignoredExtensions.has(extname(path).toLowerCase())
}

function collectFiles(dir, files = []) {
  if (!existsSync(dir)) return files
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) collectFiles(join(dir, entry.name), files)
      continue
    }
    const path = join(dir, entry.name)
    if (!shouldSkipFile(path)) files.push(path)
  }
  return files
}

function redacted(value) {
  if (value.length <= 10) return '[redacted]'
  return `${value.slice(0, 4)}…${value.slice(-4)}`
}

const findings = []
const scannedFiles = collectFiles(projectRoot)

for (const file of scannedFiles) {
  const rel = relative(projectRoot, file).replaceAll('\\', '/')
  let text = ''
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    continue
  }

  for (const secret of secretPatterns) {
    for (const match of text.matchAll(secret.pattern)) {
      findings.push({
        file: rel,
        type: secret.id,
        description: secret.description,
        value: redacted(match[0]),
      })
    }
  }
}

const lines = [
  '# Goal Mate Secret Hygiene Verification',
  '',
  `- Project root: ${projectRoot}`,
  `- Scanned files: ${scannedFiles.length}`,
  `- Findings: ${findings.length}`,
  '',
]

if (findings.length) {
  lines.push('| File | Type | Description | Evidence |')
  lines.push('| --- | --- | --- | --- |')
  for (const finding of findings) {
    lines.push(`| ${finding.file} | ${finding.type} | ${finding.description} | ${finding.value} |`)
  }
  lines.push('')
  lines.push('Result: FAIL')
} else {
  lines.push('Result: PASS')
}

console.log(lines.join('\n'))
process.exit(findings.length ? 1 : 0)
