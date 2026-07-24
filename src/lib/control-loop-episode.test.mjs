import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyPromptReminderTimingAdjustment,
  buildPromptReminderScheduleAdjustment,
  inferControlLoopDiagnosis,
  inferPromptInterventionSignal,
  pickFeedbackNextCondition,
  resolveControlLoopFeedbackAction,
} from './control-loop-episode.mjs'
import {
  buildFeedbackNextCommitmentPlan,
  persistFeedbackNextCommitment,
} from './today-action-planner.mjs'

const now = new Date(2026, 6, 24, 12, 0, 0)

function actionFixture(overrides = {}) {
  return {
    id: 'action-1',
    userId: 'user-1',
    goalId: 'goal-1',
    stagePlanId: 'stage-1',
    conditionId: 'condition-1',
    actionDate: now,
    title: '整理完整项目方案',
    doneWhen: '完整方案可以评审',
    minimumStep: '打开文档并写出第一段',
    estimatedMinutes: 40,
    fallbackAction: '只写一句',
    checkinQuestion: '完成了吗？',
    goal: { id: 'goal-1', title: '完成项目' },
    condition: { id: 'condition-1', title: '形成可评审方案', status: 'MISSING' },
    ...overrides,
  }
}

test('not-done feedback produces a smaller concrete action plan', () => {
  const plan = buildFeedbackNextCommitmentPlan({
    action: actionFixture(),
    result: 'NOT_DONE',
    diagnosis: { category: 'ABILITY' },
    now,
  })

  assert.equal(plan.data.status, 'PLANNED')
  assert.equal(plan.data.estimatedMinutes, 10)
  assert.ok(plan.data.estimatedMinutes < 40)
  assert.match(plan.data.title, /最小版本/)
  assert.match(plan.data.minimumStep, /2 分钟/)
  assert.equal(plan.adjustmentSignal.strategy, 'reduce_difficulty')
})

test('partial feedback keeps only the smallest remaining verifiable part', () => {
  const plan = buildFeedbackNextCommitmentPlan({
    action: actionFixture({ estimatedMinutes: 18 }),
    result: 'PARTIAL',
    diagnosis: { category: 'ABILITY' },
    now,
  })

  assert.equal(plan.data.estimatedMinutes, 9)
  assert.match(plan.data.title, /剩余最小部分/)
  assert.match(plan.data.doneWhen, /一个可验证结果/)
})

test('prompt feedback persists a human-readable timing and fallback signal in the next action', () => {
  const diagnosis = inferControlLoopDiagnosis({
    feedback: '之前提醒太晚了，改成晚上 18:30 前提醒',
    reasonCategory: 'PROMPT',
    estimatedMinutes: 40,
  })
  const plan = buildFeedbackNextCommitmentPlan({
    action: actionFixture(),
    result: 'NOT_DONE',
    diagnosis,
    now,
  })

  assert.equal(diagnosis.category, 'PROMPT')
  assert.equal(diagnosis.adjustmentType, 'RESCHEDULE')
  assert.equal(diagnosis.interventionSignal.timingHint, 'exact_time_18_30')
  assert.match(diagnosis.proposedNextAction, /18:30/)
  assert.match(plan.data.title, /18:30/)
  assert.match(plan.data.doneWhen, /10 分钟/)
  assert.match(plan.data.fallbackAction, /错过提示/)
  assert.doesNotMatch(plan.data.reason, /scheduler_strategy|timing=|lead_minutes=/)
  assert.equal(plan.adjustmentSignal.frequencyPolicy, 'do_not_increase')
})

test('prompt timing inference distinguishes too early and too late feedback', () => {
  assert.deepEqual(
    inferPromptInterventionSignal('提醒太早，当时还不能做'),
    {
      strategy: 'advance_prompt',
      timingHint: 'closer_to_action_window',
      timingLabel: '下一次真正能开始的行动窗口',
      leadMinutes: 5,
      frequencyPolicy: 'do_not_increase',
    },
  )
  assert.equal(inferPromptInterventionSignal('提醒得太晚了').leadMinutes, 20)
})

test('exact prompt time conservatively changes one existing schedule without changing frequency', async () => {
  const diagnosis = {
    id: 'diagnosis-1',
    category: 'PROMPT',
    adjustmentType: 'RESCHEDULE',
    interventionSignal: inferPromptInterventionSignal('请在 18:30 前提醒'),
  }
  const originalRule = {
    id: 'rule-1',
    userId: 'user-1',
    goalId: 'goal-1',
    reminderType: 'evening_review',
    channel: 'qq',
    schedule: '21:30',
    maxPerDay: 1,
    enabled: true,
    createdAt: now,
    metadata: {
      activeContactConsent: true,
      contactConsent: { granted: true },
    },
  }
  let updateData = null
  const tx = {
    reminderRule: {
      findMany: async () => [originalRule],
      update: async ({ data }) => {
        updateData = data
        return { ...originalRule, ...data }
      },
    },
  }

  const adjustment = await applyPromptReminderTimingAdjustment(
    tx,
    'user-1',
    actionFixture(),
    diagnosis,
    now,
  )

  assert.equal(adjustment.applied, true)
  assert.equal(adjustment.previousSchedule, '21:30')
  assert.equal(adjustment.newSchedule, '18:20')
  assert.equal(adjustment.maxPerDay, 1)
  assert.equal(updateData.metadata.sourceDiagnosis, 'diagnosis-1')
  assert.equal(updateData.metadata.previousSchedule, '21:30')
  assert.equal(updateData.metadata.newSchedule, '18:20')
  assert.equal(updateData.metadata.activeContactConsent, true)
  assert.equal('maxPerDay' in updateData, false)
  assert.equal('enabled' in updateData, false)
})

test('prompt timing does not open or modify an unconsented reminder rule', async () => {
  let updated = false
  const tx = {
    reminderRule: {
      findMany: async () => [{
        id: 'rule-unconsented',
        reminderType: 'evening_review',
        schedule: '21:30',
        enabled: true,
        metadata: { activeContactConsent: false },
      }],
      update: async () => {
        updated = true
      },
    },
  }
  const diagnosis = {
    id: 'diagnosis-1',
    category: 'PROMPT',
    adjustmentType: 'RESCHEDULE',
    interventionSignal: inferPromptInterventionSignal('请在 18:30 前提醒'),
  }

  const adjustment = await applyPromptReminderTimingAdjustment(
    tx,
    'user-1',
    actionFixture(),
    diagnosis,
    now,
  )

  assert.equal(adjustment, null)
  assert.equal(updated, false)
})

test('relative prompt feedback only shifts an existing clock by a small amount', () => {
  const earlier = buildPromptReminderScheduleAdjustment(
    { reminderType: 'evening_review', schedule: '21:30' },
    inferPromptInterventionSignal('提醒得太晚了'),
    now,
  )
  const later = buildPromptReminderScheduleAdjustment(
    { reminderType: 'morning_planning', schedule: '08:30' },
    inferPromptInterventionSignal('提醒太早，当时还不能做'),
    now,
  )

  assert.equal(earlier.newSchedule, '21:10')
  assert.equal(later.newSchedule, '08:45')
})

test('persistence returns the actual created DailyAction as nextCommitment', async () => {
  let createdData = null
  const tx = {
    dailyAction: {
      findFirst: async () => null,
      create: async ({ data }) => {
        createdData = data
        return { id: 'action-next', createdAt: now, ...data }
      },
    },
  }

  const persisted = await persistFeedbackNextCommitment(tx, 'user-1', {
    action: actionFixture(),
    result: 'NOT_DONE',
    diagnosis: { category: 'ABILITY' },
    now,
  })

  assert.equal(persisted.id, 'action-next')
  assert.equal(persisted.persisted, true)
  assert.equal(persisted.status, 'PLANNED')
  assert.equal(createdData.title, persisted.title)
})

test('feedback without actionId only resolves an active current-goal action from today', async () => {
  let goalQuery = null
  let actionQuery = null
  const expected = actionFixture()
  const prisma = {
    goal: {
      findFirst: async (query) => {
        goalQuery = query
        return { id: 'goal-1' }
      },
    },
    dailyAction: {
      findFirst: async (query) => {
        actionQuery = query
        return expected
      },
    },
  }

  const resolved = await resolveControlLoopFeedbackAction(prisma, 'user-1', { now })

  assert.equal(resolved, expected)
  assert.deepEqual(goalQuery.where, {
    userId: 'user-1',
    isCurrentFocus: true,
    status: 'ACTIVE',
  })
  assert.equal(actionQuery.where.goalId, 'goal-1')
  assert.deepEqual(actionQuery.where.status.in, ['PLANNED', 'PARTIAL', 'NOT_DONE'])
  assert.equal(actionQuery.where.actionDate.gte.getTime(), new Date(2026, 6, 24).getTime())
  assert.equal(actionQuery.where.actionDate.lt.getTime(), new Date(2026, 6, 25).getTime())
})

test('a completed action advances to the next open condition', () => {
  const current = { id: 'condition-1', title: '旧条件', status: 'SATISFIED', createdAt: new Date(2026, 6, 20) }
  const next = { id: 'condition-2', title: '新缺口', status: 'MISSING', createdAt: new Date(2026, 6, 21) }
  const selected = pickFeedbackNextCondition(actionFixture(), 'DONE', {
    condition: current,
    conditions: [current, next],
  })

  assert.equal(selected.id, 'condition-2')
})
