import assert from 'node:assert/strict'
import test from 'node:test'
import {
  executeAgentToolWithPrisma,
  shouldRequireConfirmation,
} from './agent-tool-executor.mjs'

function fakePrisma() {
  const state = {
    settings: {
      userId: 'user-1',
      agent: {
        require_confirm_goal_changes: true,
        require_confirm_setting_changes: true,
        require_confirm_external_actions: true,
      },
      notifications: {
        proactive_contact_enabled: false,
        proactive_contact_cadence: 'balanced',
      },
    },
    rules: [],
    actions: [],
    bindings: [
      {
        id: 'binding-1',
        userId: 'user-1',
        contextType: 'c2c',
        contextId: 'qq-user-1',
        status: 'ENABLED',
        updatedAt: new Date('2026-07-24T08:00:00.000Z'),
      },
    ],
  }

  const prisma = {
    userSetting: {
      findUnique: async () => state.settings,
      upsert: async ({ update, create }) => {
        state.settings = state.settings ? { ...state.settings, ...update } : create
        return state.settings
      },
      update: async ({ data }) => {
        state.settings = { ...state.settings, ...data }
        return state.settings
      },
    },
    reminderRule: {
      findMany: async ({ where }) => state.rules.filter((rule) => (
        rule.userId === where.userId && (!where.channel || rule.channel === where.channel)
      )),
      findFirst: async ({ where }) => state.rules.find((rule) => (
        rule.userId === where.userId
        && rule.reminderType === where.reminderType
        && rule.channel === where.channel
      )) || null,
      create: async ({ data }) => {
        const rule = { id: `rule-${state.rules.length + 1}`, ...data }
        state.rules.push(rule)
        return rule
      },
      update: async ({ where, data }) => {
        const index = state.rules.findIndex((rule) => rule.id === where.id)
        state.rules[index] = { ...state.rules[index], ...data }
        return state.rules[index]
      },
    },
    qqChatBinding: {
      findFirst: async ({ where }) => state.bindings.find((binding) => (
        binding.userId === where.userId
        && binding.status === where.status
        && (!where.contextType || binding.contextType === where.contextType)
        && (!where.contextId || binding.contextId === where.contextId)
      )) || null,
    },
    agentToolAction: {
      updateMany: async ({ where, data }) => {
        let count = 0
        for (const action of state.actions) {
          if (
            action.userId === where.userId
            && action.toolName === where.toolName
            && action.status === where.status
          ) {
            Object.assign(action, data)
            count += 1
          }
        }
        return { count }
      },
      create: async ({ data }) => {
        const action = { id: `action-${state.actions.length + 1}`, ...data }
        state.actions.push(action)
        return action
      },
    },
  }
  return { prisma, state }
}

test('autonomous proactive contact stays pending until explicit confirmation', async () => {
  const { prisma, state } = fakePrisma()
  const input = {
    mode: 'autonomous',
    enabled: true,
    cadence: 'balanced',
    source: 'agent_conversation',
  }

  const pending = await executeAgentToolWithPrisma(
    prisma,
    { userId: 'user-1', source: 'web', confirmed: false },
    'reminder.schedule',
    input,
  )
  assert.equal(pending.needsConfirmation, true)
  assert.equal(state.settings.notifications.proactive_contact_enabled, false)
  assert.equal(state.rules.length, 0)

  const confirmed = await executeAgentToolWithPrisma(
    prisma,
    { userId: 'user-1', source: 'web', confirmed: true },
    'reminder.schedule',
    input,
  )
  assert.equal(confirmed.needsConfirmation, false)
  assert.equal(state.settings.notifications.proactive_contact_enabled, true)
  assert.equal(state.rules.length, 4)
  assert.ok(state.rules.every((rule) => (
    rule.enabled === true
    && rule.metadata.activeContactConsent === true
    && rule.metadata.contactConsent.granted === true
    && rule.metadata.qqContextId === 'qq-user-1'
    && rule.metadata.contactConsent.qqContextId === 'qq-user-1'
  )))
})

test('an explicit check-in is recorded without a second confirmation', () => {
  const requiresConfirmation = shouldRequireConfirmation(
    {
      name: 'checkin.submit',
      permission: 'execute',
      riskLevel: 'low',
    },
    {
      requireConfirmGoalChanges: true,
      requireConfirmSettingChanges: true,
      requireConfirmExternalActions: true,
    },
    { result: 'not_done', userFeedback: '今天没做，太累了。' },
  )

  assert.equal(requiresConfirmation, false)
})

test('Web consent never guesses a group as the destination for private reminders', async () => {
  const { prisma, state } = fakePrisma()
  state.bindings = [
    {
      id: 'group-binding',
      userId: 'user-1',
      contextType: 'group',
      contextId: 'qq-group-1',
      status: 'ENABLED',
      updatedAt: new Date('2026-07-24T09:00:00.000Z'),
    },
  ]

  const execution = await executeAgentToolWithPrisma(
    prisma,
    { userId: 'user-1', source: 'web', confirmed: true },
    'reminder.schedule',
    { mode: 'autonomous', enabled: true, cadence: 'balanced' },
  )

  assert.equal(execution.action.status, 'failed')
  assert.equal(state.settings.notifications.proactive_contact_enabled, false)
  assert.equal(state.rules.length, 0)
})

test('pausing proactive contact is immediate and revokes both rules and global consent', async () => {
  const { prisma, state } = fakePrisma()
  state.settings.notifications.proactive_contact_enabled = true
  state.rules.push(
    { id: 'rule-1', userId: 'user-1', channel: 'qq', enabled: true, metadata: {} },
    { id: 'rule-2', userId: 'user-1', channel: 'qq', enabled: true, metadata: {} },
  )

  const paused = await executeAgentToolWithPrisma(
    prisma,
    { userId: 'user-1', source: 'web', confirmed: false },
    'reminder.schedule',
    { mode: 'pause', enabled: false, reason: 'user_requested_pause' },
  )

  assert.equal(paused.needsConfirmation, false)
  assert.equal(state.settings.notifications.proactive_contact_enabled, false)
  assert.ok(state.rules.every((rule) => rule.enabled === false))
  assert.equal(paused.result.disabledRuleIds.length, 2)
})

test('a pause invalidates an earlier pending reminder-enable confirmation', async () => {
  const { prisma, state } = fakePrisma()
  await executeAgentToolWithPrisma(
    prisma,
    { userId: 'user-1', source: 'qq', confirmed: false, agentThreadId: 'thread-1' },
    'reminder.schedule',
    { mode: 'autonomous', enabled: true, cadence: 'balanced' },
  )
  assert.equal(state.actions[0].status, 'pending_confirmation')

  await executeAgentToolWithPrisma(
    prisma,
    { userId: 'user-1', source: 'qq', confirmed: false, agentThreadId: 'thread-1' },
    'reminder.schedule',
    { mode: 'pause', enabled: false },
  )
  assert.equal(state.actions[0].status, 'rejected')
})
