import { buildInterventionDecision } from '../lib/intervention-planner.mjs'
import { planInterventionFromContext } from '../lib/intervention-planner.mjs'
import { evaluateInterventionDecisionQuality } from '../lib/intervention-policy.mjs'
import { buildMetaCognitionHypothesis, evaluateInterventionEffectiveness } from '../lib/meta-cognition-layer.mjs'
import { evaluateMemoryQuality } from '../lib/memory-quality-gate.mjs'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const results = []

function record(id, purpose, ok, evidence = '') {
  results.push({ id, purpose, ok, evidence })
}

function baseGoal() {
  return {
    id: 'goal-outcome',
    title: '8 周内完成一个可验证成果',
  }
}

function baseAction(patch = {}) {
  return {
    id: 'action-core',
    goalId: 'goal-outcome',
    conditionId: 'condition-move',
    title: '完成核心推进动作',
    minimumStep: '先执行一个最低成本版本',
    fallbackAction: '状态差时只做预设替代动作',
    estimatedMinutes: 120,
    condition: { id: 'condition-move', title: '稳定运动窗口' },
    ...patch,
  }
}

const abilityDecision = buildInterventionDecision({
  goal: baseGoal(),
  action: baseAction(),
  checkins: [
    { result: 'NOT_DONE', userFeedback: '当前动作太大，启动不了' },
    { result: 'PARTIAL', userFeedback: '只走了一点' },
  ],
  diagnoses: [{ category: 'ABILITY', evidence: '用户反馈太累', nextQuestion: '是不是太大？' }],
})
record(
  'IP-ABILITY-REDUCE-DIFFICULTY',
  'Planner sees repeated action misses as difficulty/prompt diagnosis, not encouragement',
  abilityDecision.diagnostic_category === 'ABILITY'
    && abilityDecision.intervention_type === 'reduce_difficulty'
    && /可承受|最小/.test(abilityDecision.question_or_message)
    && abilityDecision.fallback_action,
  JSON.stringify(abilityDecision),
)

const fallbackNoKeyDecision = await planInterventionFromContext({
  goal: baseGoal(),
  action: baseAction({ estimatedMinutes: 20 }),
  checkins: [],
  diagnoses: [],
}, { apiKey: '' })
record(
  'IP-AI-MISSING-KEY-FALLBACK',
  'AI-first planner falls back to fallback_rule when API key is missing',
  fallbackNoKeyDecision.planner_source === 'fallback_rule'
    && fallbackNoKeyDecision.fallback_reason === 'missing_api_key',
  JSON.stringify(fallbackNoKeyDecision),
)

const legalAiDecision = await planInterventionFromContext({
  goal: baseGoal(),
  action: baseAction({ estimatedMinutes: 20 }),
  checkins: [{ result: 'NOT_DONE', userFeedback: '关键时刻没有预案，进入了默认高风险行为' }],
  diagnoses: [{ category: 'PROMPT', evidence: '风险点前没有触发提示' }],
}, {
  modelClient: async () => JSON.stringify({
    intervention_type: 'risk_warning',
    target_goal_id: 'goal-outcome',
    target_condition_id: 'condition-move',
    risk_point: '关键时刻缺少预案会让默认高风险行为发生。',
    question_or_message: '现在先准备替代动作，可以吗？',
    expected_feedback: 'answer',
    fallback_action: '如果风险触发，先执行替代动作，不直接进入默认高风险行为。',
    reasoning_summary: '用户反馈说明关键风险不是目标本身，而是风险点前缺少提示和预案。',
    verification_signal: '如果下一次风险点前完成替代动作，则该干预被支持；否则下次重新判断难度或方向。',
    diagnostic_category: 'PROMPT',
  }),
})
record(
  'IP-AI-LEGAL-JSON-USED',
  'AI-first planner uses valid ai_policy JSON decision',
  legalAiDecision.planner_source === 'ai_policy'
    && legalAiDecision.intervention_type === 'risk_warning'
    && legalAiDecision.verification_signal,
  JSON.stringify(legalAiDecision),
)

const genericAiDecision = await planInterventionFromContext({
  goal: baseGoal(),
  action: baseAction({ estimatedMinutes: 20 }),
}, {
  modelClient: async () => JSON.stringify({
    intervention_type: 'nudge',
    target_goal_id: 'goal-outcome',
    target_condition_id: 'condition-move',
    risk_point: '用户需要继续努力。',
    question_or_message: '加油，坚持一下，你可以的。',
    expected_feedback: 'done',
    fallback_action: '继续努力。',
    reasoning_summary: '用户需要保持积极。',
    verification_signal: '如果下次反馈更好则验证。',
    diagnostic_category: 'UNKNOWN',
  }),
})
record(
  'IP-AI-GENERIC-REJECTED',
  'Decision Quality Gate rejects generic encouragement from AI output',
  genericAiDecision.planner_source === 'fallback_rule'
    && genericAiDecision.ai_policy_error === 'decision_quality_rejected'
    && genericAiDecision.ai_policy_quality?.issues?.includes('generic_encouragement'),
  JSON.stringify(genericAiDecision),
)

const missingVerificationDecision = await planInterventionFromContext({
  goal: baseGoal(),
  action: baseAction({ estimatedMinutes: 20 }),
}, {
  modelClient: async () => JSON.stringify({
    intervention_type: 'prompt',
    target_goal_id: 'goal-outcome',
    target_condition_id: 'condition-move',
    risk_point: '今天还没有启动。',
    question_or_message: '现在先做最小版本，可以吗？',
    expected_feedback: 'done / not_done',
    fallback_action: '只走 5 分钟。',
    reasoning_summary: '行动较小，适合先启动。',
    verification_signal: '',
    diagnostic_category: 'ABILITY',
  }),
})
record(
  'IP-AI-MISSING-VERIFICATION-REJECTED',
  'Decision Quality Gate rejects AI output missing verification_signal',
  missingVerificationDecision.planner_source === 'fallback_rule'
    && missingVerificationDecision.ai_policy_quality?.issues?.includes('missing_verification_signal'),
  JSON.stringify(missingVerificationDecision),
)

const promptDecision = buildInterventionDecision({
  goal: baseGoal(),
  action: baseAction({ estimatedMinutes: 20 }),
  checkins: [{ result: 'NOT_DONE', userFeedback: '关键时刻没有预案，最后进入默认高风险行为' }],
  diagnoses: [{ category: 'PROMPT', evidence: '风险点前没有替代方案', nextQuestion: '预案应该提前到什么时候触发？' }],
})
record(
  'IP-RISK-FALLBACK',
  'Planner creates advance risk warning and fallback_action for a generic high-risk default behavior',
  promptDecision.diagnostic_category === 'PROMPT'
    && promptDecision.intervention_type === 'risk_warning'
    && /默认高风险|预案|风险/.test(promptDecision.risk_point)
    && /替代|最小|默认高风险/.test(promptDecision.fallback_action),
  JSON.stringify(promptDecision),
)

const noResponseDecision = buildInterventionDecision({
  goal: baseGoal(),
  action: baseAction({ estimatedMinutes: 20 }),
  noResponseCount: 3,
  checkins: [],
  diagnoses: [],
})
record(
  'IP-NO-RESPONSE-NO-FREQUENCY-INCREASE',
  'Planner does not blindly increase frequency after repeated no-response',
  noResponseDecision.intervention_type === 'reduce_difficulty'
    && /不加频率|降复杂度|连续无响应/.test(`${noResponseDecision.question_or_message} ${noResponseDecision.reasoning_summary} ${noResponseDecision.risk_point}`),
  JSON.stringify(noResponseDecision),
)

const interventionEvaluation = evaluateInterventionEffectiveness({
  interventionDecision: promptDecision,
  checkins: [{ result: 'NOT_DONE', userFeedback: '仍然进入默认高风险行为' }],
})
const hypothesis = buildMetaCognitionHypothesis({
  userId: 'user-demo',
  goal: baseGoal(),
  action: baseAction({ estimatedMinutes: 20 }),
  diagnosis: { category: 'PROMPT', evidence: '提前提示仍然无效' },
  checkin: { result: 'NOT_DONE', userFeedback: '仍然进入默认高风险行为' },
  interventionDecision: promptDecision,
})
const hypothesisQuality = evaluateMemoryQuality({
  claim: hypothesis.hypothesis,
  scope: hypothesis.scope,
  evidence: hypothesis.evidence,
  causal_explanation: hypothesis.causal_explanation,
  decision_impact: hypothesis.decision_impact,
  verification_signal: hypothesis.verification_signal,
  confidence: hypothesis.confidence,
})
record(
  'IP-META-COGNITION-HYPOTHESIS',
  'Review feedback can generate a falsifiable meta-cognition hypothesis',
  interventionEvaluation.status === 'not_supported'
    && hypothesisQuality.accepted
    && /提示|风险/.test(hypothesis.hypothesis)
    && hypothesis.verification_signal
    && hypothesis.ai_self_reflection?.next_thinking_rule
    && hypothesis.ai_self_reflection?.intervention_policy_delta,
  JSON.stringify({ interventionEvaluation, hypothesis, quality: hypothesisQuality }),
)

const vagueQuality = evaluateMemoryQuality({
  claim: '用户状态不好',
  evidence: ['用户说不好'],
  causal_explanation: '用户状态不好。',
  decision_impact: '仅记录。',
  verification_signal: '以后看。',
})
record(
  'IP-MEMORY-QUALITY-REJECTS-VAGUE',
  'Memory Quality Gate rejects vague core memory',
  !vagueQuality.accepted && vagueQuality.issues.includes('claim_too_vague'),
  JSON.stringify(vagueQuality),
)

const schedulerWorkerSource = readFileSync(resolve(process.cwd(), 'scripts/scheduler-worker.mjs'), 'utf8')
record(
  'IP-SCHEDULER-STRUCTURED-PLANNER-SOURCE',
  'Scheduler structured output records planner_source',
  schedulerWorkerSource.includes('planner_source: interventionDecision.planner_source')
    && schedulerWorkerSource.includes('intervention_decision: interventionDecision'),
  'scheduler-worker.mjs scanned',
)

const decisionQuality = evaluateInterventionDecisionQuality(legalAiDecision)
record(
  'IP-QUALITY-GATE-ACCEPTS-LEGAL-AI',
  'Decision Quality Gate accepts legal AI policy decision',
  decisionQuality.accepted,
  JSON.stringify(decisionQuality),
)

const lines = [
  '# Intervention Planner Verification',
  '',
  `- Time: ${new Date().toISOString()}`,
  '',
  '| ID | Purpose | Result | Evidence |',
  '| --- | --- | --- | --- |',
  ...results.map((result) => `| ${result.id} | ${result.purpose} | ${result.ok ? 'PASS' : 'FAIL'} | ${String(result.evidence).replaceAll('|', '\\|').slice(0, 500)} |`),
  '',
]

console.log(lines.join('\n'))
process.exit(results.every((result) => result.ok) ? 0 : 1)
