import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildProactiveContactMetadata,
  inferProactiveContactToolIntent,
  isProactiveContactDisableInput,
  normalizeProactiveContactCadence,
  RECOMMENDED_PROACTIVE_CONTACT_RULES,
} from './proactive-contact-control.mjs'

test('natural language can delegate reminder timing to the assistant without choosing schedules', () => {
  const intent = inferProactiveContactToolIntent('你看着合适的时候提醒我开始，少打扰一点')
  assert.equal(intent?.toolName, 'reminder.schedule')
  assert.deepEqual(intent?.input, {
    mode: 'autonomous',
    enabled: true,
    cadence: 'light',
    source: 'agent_conversation',
  })
  assert.equal(RECOMMENDED_PROACTIVE_CONTACT_RULES.length, 4)
})

test('plain pause language revokes proactive contact while negated pause does not', () => {
  const pause = inferProactiveContactToolIntent('先别主动提醒我了')
  assert.equal(pause?.input?.mode, 'pause')
  assert.equal(pause?.input?.enabled, false)
  assert.equal(isProactiveContactDisableInput(pause?.input), true)
  assert.equal(inferProactiveContactToolIntent('暂停')?.input?.mode, 'pause')
  assert.equal(inferProactiveContactToolIntent('放弃')?.input?.mode, 'pause')
  assert.equal(inferProactiveContactToolIntent('不要停止提醒我'), null)
})

test('cadence and consent metadata are normalized for confirmed candidate windows', () => {
  assert.equal(normalizeProactiveContactCadence('多提醒一点'), 'supportive')
  const metadata = buildProactiveContactMetadata(
    { cadence: 'supportive', source: 'agent_conversation' },
    new Date('2026-07-24T08:00:00.000Z'),
  )
  assert.equal(metadata.source, 'agent_confirmed')
  assert.equal(metadata.activeContactConsent, true)
  assert.deepEqual(metadata.contactConsent, {
    granted: true,
    source: 'agent_confirmed',
    updatedAt: '2026-07-24T08:00:00.000Z',
  })
})
