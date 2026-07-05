import { spawn } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function asHeaderEntries(headers = {}) {
  if (!headers) return []
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    const entries = []
    headers.forEach((value, key) => entries.push([key, value]))
    return entries
  }
  if (Array.isArray(headers)) return headers
  return Object.entries(headers)
}

function curlQuote(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function noProxyMatches(hostname) {
  const value = process.env.NO_PROXY || process.env.no_proxy || ''
  const host = String(hostname || '').toLowerCase()
  if (!value || !host) return false
  return value.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean).some((rule) => {
    if (rule === '*') return true
    if (rule === '<local>') return !host.includes('.')
    if (rule.startsWith('*.')) return host.endsWith(rule.slice(1))
    if (rule.startsWith('.')) return host.endsWith(rule)
    return host === rule
  })
}

export function modelProxyForUrl(url) {
  try {
    const parsed = new URL(url)
    if (noProxyMatches(parsed.hostname)) return ''
    if (parsed.protocol === 'https:') {
      return process.env.GOAL_MATE_MODEL_PROXY
        || process.env.HTTPS_PROXY
        || process.env.https_proxy
        || process.env.HTTP_PROXY
        || process.env.http_proxy
        || ''
    }
    if (parsed.protocol === 'http:') {
      return process.env.GOAL_MATE_MODEL_PROXY
        || process.env.HTTP_PROXY
        || process.env.http_proxy
        || ''
    }
  } catch {
    return ''
  }
  return ''
}

function curlFetchWithProxy(url, init = {}, proxy) {
  return new Promise((resolve, reject) => {
    const dir = mkdtempSync(join(tmpdir(), 'goal-mate-model-'))
    const headerPath = join(dir, 'headers.txt')
    const bodyPath = join(dir, 'body.json')
    const body = typeof init.body === 'string' ? init.body : init.body ? String(init.body) : ''
    const method = String(init.method || (body ? 'POST' : 'GET')).toUpperCase()
    const marker = '\n__GOAL_MATE_HTTP_STATUS__:'
    const args = [
      '-sS',
      '--connect-timeout', '10',
      '--max-time', '120',
      '-x', proxy,
      '-X', method,
      '-w', `${marker}%{http_code}`,
    ]
    const headerLines = []

    for (const [key, value] of asHeaderEntries(init.headers)) {
      if (typeof value !== 'undefined') headerLines.push(`${key}: ${value}`)
    }

    if (headerLines.length) {
      writeFileSync(headerPath, `${headerLines.join('\n')}\n`)
      chmodSync(headerPath, 0o600)
      args.push('-H', `@${headerPath}`)
    }

    if (body) {
      writeFileSync(bodyPath, body)
      chmodSync(bodyPath, 0o600)
      args.push('--data-binary', `@${bodyPath}`)
    }

    args.push(url)

    const child = spawn('curl', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout = []
    const stderr = []
    child.stdout.on('data', (chunk) => stdout.push(chunk))
    child.stderr.on('data', (chunk) => stderr.push(chunk))
    child.on('error', (error) => {
      rmSync(dir, { recursive: true, force: true })
      reject(error)
    })
    child.on('close', (code) => {
      const output = Buffer.concat(stdout).toString('utf8')
      const errorText = Buffer.concat(stderr).toString('utf8').trim()
      rmSync(dir, { recursive: true, force: true })
      if (code !== 0) {
        reject(new Error(errorText || `curl exited with code ${code}`))
        return
      }
      const index = output.lastIndexOf(marker)
      if (index === -1) {
        reject(new Error(`curl response did not include HTTP status: ${output.slice(0, 240)}`))
        return
      }
      const text = output.slice(0, index)
      const status = Number(output.slice(index + marker.length).trim())
      resolve(new Response(text, { status: Number.isFinite(status) && status > 0 ? status : 599 }))
    })
  })
}

export async function fetchModelProvider(url, init = {}) {
  const proxy = modelProxyForUrl(url)
  if (proxy && process.env.GOAL_MATE_MODEL_FORCE_CURL === '1') {
    return curlFetchWithProxy(url, init, proxy)
  }
  try {
    return await fetch(url, init)
  } catch (error) {
    if (!proxy) throw error
    return curlFetchWithProxy(url, init, proxy)
  }
}
