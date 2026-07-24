import assert from 'node:assert/strict'
import test from 'node:test'

import { summarizeRuntimeHeartbeat } from './runtime-heartbeat.mjs'

test('fresh healthy heartbeats are online', () => {
  const summary = summarizeRuntimeHeartbeat({
    status: 'connected',
    detail: 'QQ Gateway 已连接。',
    lastSeenAt: new Date(),
    pid: 42,
  })

  assert.equal(summary.online, true)
  assert.equal(summary.status, 'connected')
})

test('fresh error, reconnecting and waiting-config heartbeats are not shown as online', () => {
  for (const status of ['error', 'reconnecting', 'waiting_config', 'stopping']) {
    const summary = summarizeRuntimeHeartbeat({
      status,
      detail: `service=${status}`,
      lastSeenAt: new Date(),
      pid: 42,
    })
    assert.equal(summary.online, false, status)
  }
})

test('stale heartbeats are offline regardless of their last status', () => {
  const summary = summarizeRuntimeHeartbeat({
    status: 'connected',
    lastSeenAt: new Date(Date.now() - 10 * 60 * 1000),
    pid: 42,
  }, { staleMs: 60_000 })

  assert.equal(summary.online, false)
  assert.equal(summary.status, 'stale')
})
