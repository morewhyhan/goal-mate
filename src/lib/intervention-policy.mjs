export const INTERVENTION_POLICY_VERSION = 'goal-mate-intervention-policy-v0.1.0'

export const PLANNER_SOURCE_AI = 'ai_policy'
export const PLANNER_SOURCE_FALLBACK = 'fallback_rule'

const requiredDecisionFields = [
  'intervention_type',
  'target_goal_id',
  'target_condition_id',
  'risk_point',
  'question_or_message',
  'expected_feedback',
  'fallback_action',
  'reasoning_summary',
  'verification_signal',
]

const allowedInterventionTypes = new Set([
  'clarify',
  'prompt',
  'nudge',
  'reduce_difficulty',
  'risk_warning',
  'review',
  'pause_review',
])

const genericEncouragementPatterns = [
  /加油/u,
  /坚持/u,
  /你可以的/u,
  /相信自己/u,
  /继续努力/u,
  /保持积极/u,
  /不要放弃/u,
]

const forbiddenTonePatterns = [
  /你必须/u,
  /你不应该拖延/u,
  /严格执行/u,
  /又失败/u,
  /自律太差/u,
]

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function asString(value, fallback = '') {
  if (typeof value === 'string') return value.trim()
  if (value === null || value === undefined) return fallback
  return String(value).trim()
}

function compact(value, max = 900) {
  const text = asString(value).replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max)}...` : text
}

function safeJson(value) {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function summarizeInterventionContext(context = {}) {
  const goal = asRecord(context.goal)
  const action = asRecord(context.action || context.actions?.[0])
  const condition = asRecord(action.condition || context.conditions?.[0])
  const checkins = Array.isArray(context.checkins) ? context.checkins.slice(0, 5) : []
  const diagnoses = Array.isArray(context.diagnoses) ? context.diagnoses.slice(0, 5) : []
  const reviews = Array.isArray(context.reviews) ? context.reviews.slice(0, 3) : []
  const meta = Array.isArray(context.metaCognitionHypotheses) ? context.metaCognitionHypotheses.slice(0, 5) : []

  return {
    reminder_type: context.reminderType || '',
    goal: {
      id: goal.id || '',
      title: goal.title || '',
      interpreted_goal: goal.interpretedGoal || goal.rawInput || '',
    },
    action: {
      id: action.id || '',
      title: action.title || '',
      done_when: action.doneWhen || '',
      minimum_step: action.minimumStep || '',
      fallback_action: action.fallbackAction || '',
      estimated_minutes: action.estimatedMinutes || 0,
    },
    condition: {
      id: condition.id || action.conditionId || '',
      title: condition.title || '',
      status: condition.status || '',
    },
    recent_checkins: checkins.map((item) => ({
      result: item.result,
      feedback: compact(item.userFeedback, 240),
    })),
    recent_diagnoses: diagnoses.map((item) => ({
      category: item.category,
      evidence: compact(item.evidence, 240),
      next_question: compact(item.nextQuestion, 240),
    })),
    recent_reviews: reviews.map((item) => ({
      summary: compact(item.progressSummary, 200),
      blocker: compact(item.blockerSummary, 200),
      next_focus: compact(item.nextFocus, 200),
    })),
    meta_cognition: meta.map((item) => ({
      id: compact(item.id, 80),
      claim: compact(item.claim || item.hypothesis, 240),
      lifecycle_status: compact(item.lifecycle_status || 'active', 80),
      confidence: typeof item.confidence === 'number' ? item.confidence : undefined,
      decision_impact: compact(item.decision_impact, 240),
      verification_signal: compact(item.verification_signal, 240),
      policy_delta: {
        increase: Array.isArray(asRecord(item.policy_delta).increase) ? asRecord(item.policy_delta).increase : [],
        decrease: Array.isArray(asRecord(item.policy_delta).decrease) ? asRecord(item.policy_delta).decrease : [],
        next_thinking_rule: compact(asRecord(item.policy_delta).next_thinking_rule, 240),
        verification_signal: compact(asRecord(item.policy_delta).verification_signal, 240),
      },
      ai_self_reflection: {
        reasoning_adjustment: compact(asRecord(item.ai_self_reflection).reasoning_adjustment, 240),
        next_thinking_rule: compact(asRecord(item.ai_self_reflection).next_thinking_rule, 240),
        intervention_policy_delta: compact(asRecord(item.ai_self_reflection).intervention_policy_delta, 240),
      },
      ai_self_optimization: {
        self_evaluation_result: compact(asRecord(item.ai_self_optimization).self_evaluation_result, 80),
        reasoning_error: compact(asRecord(item.ai_self_optimization).reasoning_error, 240),
        next_thinking_rule: compact(asRecord(item.ai_self_optimization).next_thinking_rule, 240),
        avoid_next_time: compact(asRecord(item.ai_self_optimization).avoid_next_time, 240),
        verification_signal: compact(asRecord(item.ai_self_optimization).verification_signal, 240),
      },
    })),
    no_response_count: context.noResponseCount || 0,
  }
}

export function buildInterventionPolicyPrompt(context = {}) {
  const summary = summarizeInterventionContext(context)
  return [
    '你是 Goal Mate 的 Intervention Planner。',
    '目标：基于当前目标、反馈、风险点和元认知，动态生成下一次干预决策。',
    '',
    '硬边界：',
    '- 不要输出固定模板，不要只鼓励。',
    '- 不要羞辱、强迫或机械施压用户。',
    '- 用户没行动时，优先判断方向、难度、提示、路径四类问题。',
    '- 如果目标可能不是真想要，建议重审或暂停，不要硬催。',
    '- 如果行动太难，降低难度并给最小动作。',
    '- 如果是关键时刻缺提示，提前给风险点预案和 fallback_action。',
    '- 如果 meta_cognition 里有 ai_self_optimization.next_thinking_rule，先执行这条 AI 自我修正规则，再决定本次怎么问。',
    '- 每个判断都必须能被下一次反馈验证或证伪。',
    '',
    '只输出 JSON，不要 Markdown，不要解释。',
    'JSON 字段必须完整：',
    safeJson(requiredDecisionFields),
    '',
    'intervention_type 只能是：clarify, prompt, nudge, reduce_difficulty, risk_warning, review, pause_review。',
    'diagnostic_category 只能是：MOTIVATION, ABILITY, PROMPT, PATH, UNKNOWN。',
    '',
    '当前上下文：',
    safeJson(summary),
  ].join('\n')
}

export function extractJsonObject(text) {
  const raw = asString(text)
  if (!raw) throw new Error('empty_ai_response')
  try {
    return JSON.parse(raw)
  } catch {
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start === -1 || end === -1 || end <= start) throw new Error('json_object_not_found')
    return JSON.parse(raw.slice(start, end + 1))
  }
}

export function normalizeInterventionDecision(rawDecision = {}, context = {}, source = PLANNER_SOURCE_AI) {
  const raw = asRecord(rawDecision)
  const goalId = context.goal?.id || context.action?.goalId || ''
  const action = asRecord(context.action || context.actions?.[0])
  const condition = asRecord(action.condition || context.conditions?.[0])
  const interventionType = allowedInterventionTypes.has(raw.intervention_type) ? raw.intervention_type : 'prompt'
  const activeMeta = Array.isArray(context.metaCognitionHypotheses)
    ? context.metaCognitionHypotheses.filter((item) => String(item.lifecycle_status || 'active').toLowerCase() !== 'expired').slice(0, 5)
    : []
  const contextMetaClaims = activeMeta.map((item) => compact(item.claim || item.hypothesis, 240)).filter(Boolean)
  const contextMetaIds = activeMeta.map((item) => item.id).filter(Boolean)
  const contextPolicyDeltas = activeMeta.flatMap((item) => {
    const delta = asRecord(item.policy_delta)
    const increase = Array.isArray(delta.increase) ? delta.increase : []
    const decrease = Array.isArray(delta.decrease) ? delta.decrease : []
    if (!increase.length && !decrease.length && !delta.next_thinking_rule) return []
    return [{
      hypothesis_id: item.id,
      increase,
      decrease,
      next_thinking_rule: delta.next_thinking_rule || asRecord(item.ai_self_reflection).next_thinking_rule || '',
      lifecycle_status: item.lifecycle_status || 'active',
      confidence: item.confidence,
    }]
  })

  return {
    intervention_type: interventionType,
    target_goal_id: asString(raw.target_goal_id, goalId),
    target_condition_id: asString(raw.target_condition_id, condition.id || action.conditionId || ''),
    risk_point: asString(raw.risk_point),
    question_or_message: asString(raw.question_or_message),
    expected_feedback: asString(raw.expected_feedback, 'done / partial / not_done / answer'),
    fallback_action: asString(raw.fallback_action),
    reasoning_summary: asString(raw.reasoning_summary),
    verification_signal: asString(raw.verification_signal),
    diagnostic_category: asString(raw.diagnostic_category, 'UNKNOWN').toUpperCase(),
    planner_source: source,
    policy_version: INTERVENTION_POLICY_VERSION,
    model: raw.model || undefined,
    meta_cognition_used: Array.isArray(raw.meta_cognition_used) && raw.meta_cognition_used.length ? raw.meta_cognition_used : contextMetaClaims,
    active_meta_cognition_ids: Array.isArray(raw.active_meta_cognition_ids) && raw.active_meta_cognition_ids.length ? raw.active_meta_cognition_ids : contextMetaIds,
    policy_delta_used: Array.isArray(raw.policy_delta_used) && raw.policy_delta_used.length ? raw.policy_delta_used : contextPolicyDeltas,
  }
}

function hasVerificationSignal(value) {
  return /(如果|下次|下一次|验证|证伪|反馈|观察|若|when|if|next|verify|falsify)/iu.test(asString(value))
}

export function evaluateInterventionDecisionQuality(decision = {}) {
  const normalized = normalizeInterventionDecision(decision, {}, decision.planner_source || PLANNER_SOURCE_AI)
  const issues = []
  const combinedUserFacingText = [
    normalized.question_or_message,
    normalized.fallback_action,
    normalized.risk_point,
  ].join('\n')

  for (const field of requiredDecisionFields) {
    if (!asString(normalized[field])) issues.push(`missing_${field}`)
  }

  if (normalized.risk_point.length < 8) issues.push('risk_point_too_vague')
  if (normalized.reasoning_summary.length < 10) issues.push('reasoning_summary_too_vague')
  if (normalized.fallback_action.length < 6) issues.push('fallback_action_too_vague')
  if (!hasVerificationSignal(normalized.verification_signal)) issues.push('verification_signal_not_testable')
  if (genericEncouragementPatterns.some((pattern) => pattern.test(combinedUserFacingText))) issues.push('generic_encouragement')
  if (forbiddenTonePatterns.some((pattern) => pattern.test(combinedUserFacingText))) issues.push('forbidden_tone')

  return {
    accepted: issues.length === 0,
    issues,
    decision: normalized,
  }
}

export function assertInterventionDecisionQuality(decision = {}) {
  const quality = evaluateInterventionDecisionQuality(decision)
  if (!quality.accepted) throw new Error(`Intervention decision rejected: ${quality.issues.join(', ')}`)
  return quality
}
