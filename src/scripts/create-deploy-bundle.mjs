import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(scriptDir, '..')
const projectRoot = resolve(appRoot, '..')
const outputDir = resolve(projectRoot, '.artifacts/deploy')
const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-')
const bundleName = `goal-mate-${timestamp}.tar.gz`
const bundlePath = resolve(outputDir, bundleName)
const manifestPath = resolve(outputDir, `goal-mate-${timestamp}.files.txt`)

const bundleRoots = ['src', 'deploy', 'docs']

const ignoredDirs = new Set([
  '.artifacts',
  '.git',
  '.codex',
  '.claude',
  '.ai',
  'node_modules',
  '.next',
  'out',
  'dist',
  'build',
  'coverage',
  '.vite',
  '.cache',
  '.turbo',
  '.vercel',
  'generated',
  'example-obsidian-library-of-dice',
])

const requiredEntries = [
  './src/package.json',
  './src/.env.example',
  './deploy/systemd/goal-mate-web.service',
  './deploy/systemd/goal-mate-qq-worker.service',
  './deploy/systemd/goal-mate-scheduler-worker.service',
  './docs/plans/self-hosted-runtime-verification-plan.md',
]

const forbiddenEntryPatterns = [
  /^\.\/\.git(\/|$)/,
  /^\.\/\.artifacts(\/|$)/,
  /^\.\/example-obsidian-library-of-dice(\/|$)/,
  /(^|\/)node_modules(\/|$)/,
  /^\.\/src\/\.next(\/|$)/,
  /^\.\/src\/generated\/prisma(\/|$)/,
  /(^|\/)\.env$/,
  /(^|\/)\.env\.(?!example$)[^/]+$/,
  /\.db(-journal)?$/,
  /\.log$/,
  /\.tsbuildinfo$/,
]

function toPosix(path) {
  return path.split('\\').join('/')
}

function isEnvExample(name) {
  return name === '.env.example'
}

function shouldSkipDirectory(relPath, name) {
  if (ignoredDirs.has(name)) return true
  if (relPath === 'src/generated') return true
  return false
}

function shouldSkipFile(name) {
  if (name.startsWith('.env') && !isEnvExample(name)) return true
  if (name.endsWith('.db') || name.endsWith('.db-journal')) return true
  if (name.endsWith('.log')) return true
  if (name.endsWith('.tsbuildinfo')) return true
  return false
}

function collectBundleFiles(dir, results = []) {
  for (const dirent of readdirSync(dir, { withFileTypes: true })) {
    const absPath = resolve(dir, dirent.name)
    const relPath = toPosix(relative(projectRoot, absPath))

    if (ignoredDirs.has(dirent.name)) {
      continue
    }

    if (dirent.isSymbolicLink()) {
      continue
    }

    if (dirent.isDirectory()) {
      if (shouldSkipDirectory(relPath, dirent.name)) continue
      collectBundleFiles(absPath, results)
      continue
    }

    if (shouldSkipFile(dirent.name)) {
      continue
    }

    results.push(`./${relPath}`)
  }

  return results
}

function fail(message) {
  console.error(message)
  process.exit(1)
}

const bundleFiles = bundleRoots
  .filter((entry) => existsSync(resolve(projectRoot, entry)))
  .flatMap((entry) => collectBundleFiles(resolve(projectRoot, entry)))
  .sort()

mkdirSync(outputDir, { recursive: true })
writeFileSync(manifestPath, `${bundleFiles.join('\n')}\n`)

console.log(`Packaging ${bundleFiles.length} files into ${bundlePath}`)

const tarResult = spawnSync('tar', ['-czf', bundlePath, '-C', projectRoot, '-T', manifestPath], {
  cwd: projectRoot,
  encoding: 'utf8',
})

if (tarResult.status !== 0) {
  fail((tarResult.stderr || tarResult.stdout || 'tar failed').trim())
}

const listResult = spawnSync('tar', ['-tzf', bundlePath], {
  cwd: projectRoot,
  encoding: 'utf8',
  maxBuffer: 30 * 1024 * 1024,
})

if (listResult.status !== 0) {
  fail((listResult.stderr || listResult.stdout || 'tar list failed').trim())
}

const entries = listResult.stdout
  .split('\n')
  .map((entry) => entry.trim())
  .filter(Boolean)
  .map((entry) => (entry.startsWith('./') ? entry : `./${entry}`))

const missingEntries = requiredEntries.filter((entry) => !entries.includes(entry))
if (missingEntries.length > 0) {
  fail(
    [
      'Deployment bundle is missing required entries.',
      ...missingEntries.map((entry) => `- ${entry}`),
    ].join('\n'),
  )
}

const forbiddenEntries = entries.filter((entry) =>
  forbiddenEntryPatterns.some((pattern) => pattern.test(entry)),
)
if (forbiddenEntries.length > 0) {
  fail(
    [
      'Deployment bundle contains forbidden local/runtime files.',
      ...forbiddenEntries.slice(0, 30).map((entry) => `- ${entry}`),
      forbiddenEntries.length > 30 ? `... ${forbiddenEntries.length - 30} more` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  )
}

const sizeMb = (statSync(bundlePath).size / 1024 / 1024).toFixed(2)

console.log(
  [
    'Goal Mate deployment bundle created.',
    '',
    `Bundle: ${bundlePath}`,
    `Size: ${sizeMb} MB`,
    '',
    'This command only creates a local package. It does not upload to the server.',
    'Before deployment, create the real server .env from src/.env.example on the server only.',
  ].join('\n'),
)
