import { spawn } from 'node:child_process'

const children = []
let stopping = false

function start(name, command, args) {
  const child = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: process.env.NODE_ENV || 'development' },
  })
  children.push(child)

  const prefix = `[${name}] `
  child.stdout.on('data', (chunk) => process.stdout.write(prefix + chunk.toString().replace(/\n/g, `\n${prefix}`)))
  child.stderr.on('data', (chunk) => process.stderr.write(prefix + chunk.toString().replace(/\n/g, `\n${prefix}`)))
  child.on('exit', (code, signal) => {
    if (stopping) return
    console.error(`${prefix}exited code=${code ?? ''} signal=${signal ?? ''}`)
    stopAll(code || 1)
  })
}

function stopAll(exitCode = 0) {
  if (stopping) return
  stopping = true
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM')
  }
  setTimeout(() => process.exit(exitCode), 500)
}

process.on('SIGINT', () => stopAll(0))
process.on('SIGTERM', () => stopAll(0))

start('web', 'pnpm', ['exec', 'next', 'dev'])
start('qq', 'node', ['scripts/qq-bot-worker.mjs'])
start('scheduler', 'node', ['scripts/scheduler-worker.mjs'])
