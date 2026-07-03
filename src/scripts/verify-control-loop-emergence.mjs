import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildInterventionDecision, planInterventionFromContext } from '../lib/intervention-planner.mjs'
import { evaluateMetaCognitionHypotheses, buildMetaCognitionHypothesis } from '../lib/meta-cognition-layer.mjs'
import { inferControlLoopDiagnosis, normalizeControlLoopCheckinResult } from '../lib/control-loop-episode.mjs'

const results = []

function record(id, purpose, ok, evidence = '') {
  results.push({ id, purpose, ok, evidence })
}

function baseGoal() {
  return { id: 'goal-demo', title: '8 周内完成一个可验证成果' }
}

function baseAction(patch = {}) {
  return {
    id: 'action-demo',
    goalId: 'goal-demo',
    conditionId: 'condition-demo',
    title: '完成核心推进动作',
    minimumStep: '先执行一个最低成本版本',
    fallbackAction: '状态差时只做预设替代动作',
    estimatedMinutes: 120,
    condition: { id: 'condition-demo', title: '稳定运动窗口' },
    ...patch,
  }
}

const repeatedMissDecision = buildInterventionDecision({
  goal: baseGoal(),
  action: baseAction({ estimatedMinutes: 30 }),
  checkins: [
    { result: 'NOT_DONE', userFeedback: '没做' },
    { result: 'NOT_DONE', userFeedback: '还是没做' },
    { result: 'NOT_DONE', userFeedback: '又没做' },
  ],
  diagnoses: [{ category: 'PATH', evidence: '连续三次未完成', nextQuestion: '路径是否没对准？' }],
})
record(
  'EMG-1',
  '连续 3 次没做后，系统改变诊断问题或路径策略，而不是重复催促',
  repeatedMissDecision.intervention_type === 'review'
    && repeatedMissDecision.diagnostic_category === 'PATH'
    && /关键条件|路径|不适合继续硬推/.test(`${repeatedMissDecision.question_or_message} ${repeatedMissDecision.reasoning_summary}`),
  JSON.stringify(repeatedMissDecision),
)

const abilityHypothesis = {
  id: 'mc-ability',
  ...buildMetaCognitionHypothesis({
    userId: 'user-demo',
    goal: baseGoal(),
    action: baseAction(),
    checkin: { result: 'NOT_DONE', userFeedback: '当前动作太大，启动不了' },
    diagnosis: { category: 'ABILITY', evidence: '当前动作太大' },
  }),
}
const supportedEvaluation = evaluateMetaCognitionHypotheses([abilityHypothesis], {
  checkin: { result: 'DONE', userFeedback: '缩到最小版本后做完了' },
  diagnosis: { category: 'ABILITY', evidence: '降低难度后完成' },
})[0]
record(
  'EMG-2',
  '策略调整后完成率改善，元认知增强该假设',
  supportedEvaluation.evaluation_result === 'supported'
    && supportedEvaluation.lifecycle_status === 'strengthened'
    && supportedEvaluation.confidence_delta > 0,
  JSON.stringify(supportedEvaluation),
)

const contradictedEvaluation = evaluateMetaCognitionHypotheses([abilityHypothesis], {
  checkin: { result: 'NOT_DONE', userFeedback: '不是动作太大，是关键时刻没有提示' },
  diagnosis: { category: 'PROMPT', evidence: '风险点前缺提示' },
})[0]
record(
  'EMG-3',
  '策略调整后仍无效，元认知削弱或修正旧假设',
  contradictedEvaluation.evaluation_result === 'contradicted'
    && ['weakened', 'revised', 'expired'].includes(contradictedEvaluation.lifecycle_status)
    && contradictedEvaluation.confidence_delta < 0,
  JSON.stringify(contradictedEvaluation),
)

record(
  'EMG-7',
  '旧元认知被证伪时，AI 必须生成自我优化规则，而不是只分析用户',
  contradictedEvaluation.ai_self_optimization?.self_evaluation_result === 'contradicted'
    && /推理顺序|不能继续原样|不要直接沿用/.test(`${contradictedEvaluation.ai_self_optimization?.reasoning_error} ${contradictedEvaluation.ai_self_optimization?.avoid_next_time}`)
    && /先问|先定位|先收集|先检查/.test(contradictedEvaluation.ai_self_optimization?.next_thinking_rule || ''),
  JSON.stringify(contradictedEvaluation.ai_self_optimization),
)

const todayRouteSource = readFileSync(resolve(process.cwd(), 'server/api/routes/today/index.ts'), 'utf8')
const writeHandlerSource = readFileSync(resolve(process.cwd(), 'lib/agent-tool-write-handlers.mjs'), 'utf8')
record(
  'EMG-4',
  'Today 打卡和 Agent 对话反馈表达同一事实时，进入同一套 ControlLoopEpisode 语义',
  todayRouteSource.includes('submitControlLoopFeedback')
    && writeHandlerSource.includes('submitControlLoopFeedback')
    && normalizeControlLoopCheckinResult('not_done') === normalizeControlLoopCheckinResult('NOT_DONE')
    && inferControlLoopDiagnosis({ feedback: '太累了，做不动', estimatedMinutes: 120 }).category === 'ABILITY',
  'today route and agent write handler both scan submitControlLoopFeedback',
)

const reviewHandlerSource = readFileSync(resolve(process.cwd(), 'lib/agent-tool-read-handlers.mjs'), 'utf8')
const reviewRouteSource = readFileSync(resolve(process.cwd(), 'server/api/routes/reviews/index.ts'), 'utf8')
const reviewFormatSource = readFileSync(resolve(process.cwd(), 'lib/goal-mate-review-format.ts'), 'utf8')
record(
  'EMG-5',
  'Review 压缩多个 ControlLoopEpisode 的有效性，而不是只总结日志文本',
  reviewHandlerSource.includes('evaluateMetaCognitionHypotheses')
    && reviewRouteSource.includes('evaluateMetaCognitionHypotheses')
    && reviewFormatSource.includes('控制回合有效性')
    && reviewFormatSource.includes('元认知评估'),
  'review handler, review route and review format scanned',
)

const plannerWithMeta = await planInterventionFromContext({
  goal: baseGoal(),
  action: baseAction({ estimatedMinutes: 20 }),
  metaCognitionHypotheses: [{
    id: 'mc-prompt',
    claim: '用户在关键风险点容易进入默认高风险行为。',
    lifecycle_status: 'strengthened',
    confidence: 0.82,
    decision_impact: '下一次应在风险点前提示替代动作。',
    verification_signal: '如果下一次没有进入默认高风险行为，该策略被支持。',
    ai_self_reflection: { next_thinking_rule: '先检查今天是否存在需要提前处理的风险点。' },
    policy_delta: {
      increase: ['risk_warning', 'advance_prompt'],
      decrease: ['after_the_fact_review_only'],
      next_thinking_rule: '先检查今天是否存在需要提前处理的风险点。',
      verification_signal: '如果下一次没有进入默认高风险行为，该策略被支持。',
    },
  }],
}, { apiKey: '' })
record(
  'EMG-6',
  '下一次 Planner 能说明读取了哪些活跃元认知、哪些 policy_delta 改变了本次干预',
  plannerWithMeta.active_meta_cognition_ids?.includes('mc-prompt')
    && plannerWithMeta.policy_delta_used?.some((item) => item.hypothesis_id === 'mc-prompt' && item.increase?.includes('risk_warning')),
  JSON.stringify(plannerWithMeta),
)

const plannerWithSelfOptimization = buildInterventionDecision({
  goal: baseGoal(),
  action: baseAction({ estimatedMinutes: 20 }),
  metaCognitionHypotheses: [{
    id: 'mc-self-optimization',
    hypothesis: '上一次 AI 证据不足就直接安排动作，导致用户没有给出可诊断反馈。',
    lifecycle_status: 'revised',
    confidence: 0.52,
    decision_impact: '下一次不要直接给计划，先问一个能区分四类问题的问题。',
    verification_signal: '如果用户能给出明确类别，则该自我修正规则有效。',
    ai_self_reflection: {
      next_thinking_rule: '先问一个能最大幅度降低不确定性的问题，再决定干预策略。',
    },
    ai_self_optimization: {
      self_evaluation_result: 'contradicted',
      reasoning_error: '上一次 AI 证据不足就直接安排动作。',
      next_thinking_rule: '先收集能区分方向、难度、提示和路径的最小证据。',
      avoid_next_time: '不要直接沿用上一轮问题、时间、难度或解释。',
      verification_signal: '如果用户给出明确类别，说明自我修正有效。',
    },
    policy_delta: {
      increase: ['evidence_collection', 'clarifying_question'],
      decrease: ['direct_planning', 'direct_nudge'],
      next_thinking_rule: '先收集能区分方向、难度、提示和路径的最小证据。',
      verification_signal: '如果用户给出明确类别，说明自我修正有效。',
    },
  }],
})
record(
  'EMG-8',
  'Planner 必须消费 AI 自我优化规则，先修正自己的提问方式，再继续推动用户',
  plannerWithSelfOptimization.intervention_type === 'clarify'
    && plannerWithSelfOptimization.diagnostic_category === 'UNKNOWN'
    && /先不重新排计划/.test(plannerWithSelfOptimization.question_or_message)
    && plannerWithSelfOptimization.policy_delta_used?.some((item) => item.hypothesis_id === 'mc-self-optimization' && item.increase?.includes('evidence_collection')),
  JSON.stringify(plannerWithSelfOptimization),
)

const lines = [
  '# Control Loop Emergence Verification',
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
