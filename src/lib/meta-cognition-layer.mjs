import { evaluateMemoryQuality, formatMemoryQualityMarkdown, normalizeMemoryCandidate } from './memory-quality-gate.mjs'

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function compact(value, max = 180) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max)}...` : text
}

function diagnosisCategory(diagnosis) {
  return String(diagnosis?.category || diagnosis?.reasonCategory || 'UNKNOWN').toUpperCase()
}

function categoryLabel(category) {
  if (category === 'MOTIVATION') return '方向'
  if (category === 'ABILITY') return '难度'
  if (category === 'PROMPT') return '提示'
  if (category === 'PATH' || category === 'CONDITION' || category === 'GOAL') return '路径'
  return '未知'
}

function buildScope(input = {}) {
  return {
    userId: input.userId,
    goalId: input.goal?.id || input.goalId || input.action?.goalId,
    actionId: input.action?.id || input.actionId,
    conditionId: input.action?.conditionId || input.conditionId,
    category: diagnosisCategory(input.diagnosis),
    source: input.source || 'system',
  }
}

function confidenceClamp(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0.5
  return Math.max(0, Math.min(1, number))
}

function policyDeltaForCategory(category, selfReflection = {}) {
  const normalized = String(category || 'UNKNOWN').toUpperCase()
  const nextThinkingRule = selfReflection.next_thinking_rule || '先收集能区分方向、难度、提示和路径的最小证据。'
  const verificationSignal = selfReflection.verification_signal || '看下一次 Check-in 是否支持这次策略变化。'
  if (normalized === 'ABILITY') {
    return {
      target: 'intervention_policy',
      increase: ['reduce_difficulty', 'minimum_step', 'low_energy_fallback'],
      decrease: ['generic_nudge', 'large_action', 'motivation_first_interpretation'],
      next_thinking_rule: nextThinkingRule,
      verification_signal: verificationSignal,
      reason: '反馈指向行动仓位或启动成本，下一次必须先降低难度。',
    }
  }
  if (normalized === 'PROMPT') {
    return {
      target: 'intervention_policy',
      increase: ['risk_warning', 'advance_prompt', 'fallback_action'],
      decrease: ['after_the_fact_review_only', 'frequency_increase'],
      next_thinking_rule: nextThinkingRule,
      verification_signal: verificationSignal,
      reason: '反馈指向关键时刻缺提示，下一次必须提前到风险点前介入。',
    }
  }
  if (normalized === 'MOTIVATION') {
    return {
      target: 'intervention_policy',
      increase: ['clarify_goal_truth', 'pause_review', 'value_check'],
      decrease: ['task_push', 'frequency_increase', 'same_action_retry'],
      next_thinking_rule: nextThinkingRule,
      verification_signal: verificationSignal,
      reason: '反馈指向目标真实性风险，下一次必须先重审方向。',
    }
  }
  if (normalized === 'PATH' || normalized === 'CONDITION' || normalized === 'GOAL') {
    return {
      target: 'intervention_policy',
      increase: ['path_review', 'condition_check', 'replace_action'],
      decrease: ['same_action_retry', 'completion_only_tracking'],
      next_thinking_rule: nextThinkingRule,
      verification_signal: verificationSignal,
      reason: '反馈指向行动路径没有补齐关键条件，下一次必须先校验路径。',
    }
  }
  return {
    target: 'intervention_policy',
    increase: ['clarifying_question', 'evidence_collection'],
    decrease: ['direct_planning', 'direct_nudge'],
    next_thinking_rule: nextThinkingRule,
    verification_signal: verificationSignal,
    reason: '当前证据不足，下一次先降低不确定性。',
  }
}

export function buildAiSelfReflection(input = {}, hypothesis = {}) {
  const category = diagnosisCategory(input.diagnosis || { category: hypothesis.scope?.category })
  const label = categoryLabel(category)
  const result = String(input.checkin?.result || '').toUpperCase() || 'UNKNOWN'
  const interventionType = input.interventionDecision?.intervention_type || 'unknown'
  const base = {
    target: 'ai_reasoning_policy',
    feedback_result: result,
    last_intervention_type: interventionType,
    watched_category: label,
  }

  if (category === 'ABILITY') {
    return {
      ...base,
      reasoning_adjustment: '下次不要先把没做归因为动机不足；先检查行动仓位、启动成本和最小动作是否仍然过大。',
      next_thinking_rule: '先问“这一步能不能缩到用户当下可承受的最小版本”，再判断方向或提示问题。',
      intervention_policy_delta: '提高降低难度和最小启动动作的优先级，降低空泛催办的优先级。',
      verification_signal: '如果缩小动作后完成率上升，说明这个推理修正有效；如果仍不开始，再改查方向或提示。',
    }
  }

  if (category === 'PROMPT') {
    return {
      ...base,
      reasoning_adjustment: '下次不要只在失败后复盘；先定位风险点出现前的触发时刻，并在那个时刻前给具体预案。',
      next_thinking_rule: '先问“用户在哪个时刻最容易脱离控制”，再决定提醒时间、渠道和 fallback_action。',
      intervention_policy_delta: '提高提前风险提示的优先级，降低事后总结和重复提醒的优先级。',
      verification_signal: '如果提前提示后风险行为减少，说明推理修正有效；如果仍失控，再改查难度或方向。',
    }
  }

  if (category === 'MOTIVATION') {
    return {
      ...base,
      reasoning_adjustment: '下次不要继续推进同类行动；先验证目标是不是用户真正想要的结果，避免把外部期待当成真实目标。',
      next_thinking_rule: '先问“如果这个目标真的完成，用户期待的现实变化是什么”，再决定是否继续拆任务。',
      intervention_policy_delta: '提高目标真实性澄清的优先级，降低继续排任务和提高频率的优先级。',
      verification_signal: '如果用户能重新确认具体结果，再恢复行动推进；如果仍抗拒，应暂停或重定目标。',
    }
  }

  if (category === 'PATH' || category === 'CONDITION' || category === 'GOAL') {
    return {
      ...base,
      reasoning_adjustment: '下次不要只看行动是否完成；先检查这个行动是否真的补齐关键条件，避免做了很多但系统状态没有改变。',
      next_thinking_rule: '先问“当前行动补的是哪个必要条件”，再决定保留、替换或重排路径。',
      intervention_policy_delta: '提高路径重建和条件校验的优先级，降低重复安排原行动的优先级。',
      verification_signal: '如果替换行动后关键条件进度改善，说明推理修正有效；否则需要重审目标成功标准。',
    }
  }

  return {
    ...base,
    reasoning_adjustment: '下次不要急着给方案；先收集能区分方向、难度、提示和路径的最小证据。',
    next_thinking_rule: '先问一个能最大幅度降低不确定性的问题，再决定干预策略。',
    intervention_policy_delta: '提高澄清问题的优先级，降低直接规划和直接催办的优先级。',
    verification_signal: '如果用户下一次能给出清楚原因，说明推理修正有效；如果仍模糊，则用更小行动做验证。',
  }
}

export function buildAiSelfOptimizationUpdate(input = {}) {
  const hypothesis = asRecord(input.hypothesis)
  const previousSelf = asRecord(hypothesis.ai_self_reflection)
  const previousCategory = String(hypothesis.scope?.category || 'UNKNOWN').toUpperCase()
  const nextCategory = String(input.diagnosisCategory || previousCategory || 'UNKNOWN').toUpperCase()
  const evaluationResult = String(input.evaluationResult || 'inconclusive').toLowerCase()
  const nextSelf = buildAiSelfReflection({
    diagnosis: { category: nextCategory },
    checkin: { result: input.checkinResult || '' },
    interventionDecision: input.interventionDecision || {},
  }, hypothesis)
  const categoryChanged = previousCategory && nextCategory && previousCategory !== 'UNKNOWN' && nextCategory !== 'UNKNOWN' && previousCategory !== nextCategory
  const previousRule = previousSelf.next_thinking_rule || '上一轮没有明确 AI 自我推理规则。'
  const nextRule = evaluationResult === 'supported'
    ? previousRule
    : nextSelf.next_thinking_rule || '先收集能区分方向、难度、提示和路径的最小证据。'
  const reasoningError = evaluationResult === 'supported'
    ? '上一轮 AI 推理规则得到后续反馈支持，暂不需要改写。'
    : categoryChanged
      ? `上一轮 AI 把偏差优先解释为 ${previousCategory}，但新证据指向 ${nextCategory}，说明推理顺序需要改写。`
      : evaluationResult === 'contradicted'
        ? '上一轮 AI 的干预没有推动行动发生，不能继续原样复用同一推理规则。'
        : '证据不足，AI 不能把旧判断当成稳定事实。'

  return {
    target: 'ai_self_reasoning_policy',
    self_evaluation_result: evaluationResult,
    previous_thinking_rule: previousRule,
    reasoning_error: reasoningError,
    reasoning_adjustment: evaluationResult === 'supported'
      ? previousSelf.reasoning_adjustment || nextSelf.reasoning_adjustment
      : nextSelf.reasoning_adjustment,
    next_thinking_rule: nextRule,
    intervention_policy_delta: evaluationResult === 'supported'
      ? previousSelf.intervention_policy_delta || nextSelf.intervention_policy_delta
      : nextSelf.intervention_policy_delta,
    avoid_next_time: evaluationResult === 'supported'
      ? '不要过度修正已被支持的策略，只继续验证它是否稳定。'
      : '不要直接沿用上一轮问题、时间、难度或解释；先按新规则收集证据。',
    policy_delta: asRecord(input.policyDelta),
    verification_signal: input.recheckRule || nextSelf.verification_signal,
    evidence_used: Array.isArray(input.evidenceUsed) ? input.evidenceUsed : [],
    updatedAt: new Date().toISOString(),
  }
}

function attachMetaCognitionReflection(input, hypothesis) {
  const aiSelfReflection = buildAiSelfReflection(input, hypothesis)
  const category = diagnosisCategory(input.diagnosis || { category: hypothesis.scope?.category })
  const policyDelta = policyDeltaForCategory(category, aiSelfReflection)
  return {
    ...hypothesis,
    ai_self_reflection: aiSelfReflection,
    policy_delta: policyDelta,
    lifecycle_status: hypothesis.lifecycle_status || 'active',
    evaluation_history: Array.isArray(hypothesis.evaluation_history) ? hypothesis.evaluation_history : [],
    daily_reflection: {
      user_intervention: hypothesis.decision_impact,
      ai_self_intervention: aiSelfReflection.next_thinking_rule,
      verification_signal: hypothesis.verification_signal,
    },
  }
}

function formatPolicyDeltaMarkdown(policyDelta = {}) {
  const increase = Array.isArray(policyDelta.increase) ? policyDelta.increase.join(', ') : ''
  const decrease = Array.isArray(policyDelta.decrease) ? policyDelta.decrease.join(', ') : ''
  return [
    increase ? `  - 策略升权：${increase}` : '',
    decrease ? `  - 策略降权：${decrease}` : '',
    policyDelta.next_thinking_rule ? `  - PolicyDelta 思考规则：${policyDelta.next_thinking_rule}` : '',
  ].filter(Boolean)
}

function formatMetaCognitionHypothesisMarkdown(item) {
  const self = asRecord(item.ai_self_reflection)
  const selfOptimization = asRecord(item.ai_self_optimization)
  const policyDelta = asRecord(item.policy_delta)
  const lines = [formatMemoryQualityMarkdown(item)]
  if (self.next_thinking_rule || self.reasoning_adjustment || self.intervention_policy_delta) {
    lines.push(
      '',
      `  - AI 自我修正：${self.reasoning_adjustment || '等待更多证据。'}`,
      `  - 下次思考规则：${self.next_thinking_rule || '先收集更清楚证据。'}`,
      `  - 策略权重调整：${self.intervention_policy_delta || '保持当前策略。'}`,
    )
  }
  if (selfOptimization.next_thinking_rule || selfOptimization.reasoning_error) {
    lines.push(
      '',
      `  - AI 自我评估：${selfOptimization.self_evaluation_result || 'inconclusive'}`,
      `  - AI 推理误差：${selfOptimization.reasoning_error || '等待更多证据。'}`,
      `  - AI 下一次规则：${selfOptimization.next_thinking_rule || '先收集更清楚证据。'}`,
      `  - AI 下次避免：${selfOptimization.avoid_next_time || '不要重复无效策略。'}`,
    )
  }
  const policyLines = formatPolicyDeltaMarkdown(policyDelta)
  if (policyLines.length) lines.push('', ...policyLines)
  if (item.lifecycle_status) lines.push(`  - 生命周期：${item.lifecycle_status}`)
  if (Array.isArray(item.evaluation_history) && item.evaluation_history.length) {
    const latestEvaluation = item.evaluation_history[0]
    lines.push(`  - 最近评估：${latestEvaluation.evaluation_result || 'unknown'}；${latestEvaluation.reason || ''}`)
  }
  return lines.join('\n')
}

export function buildMetaCognitionHypothesis(input = {}) {
  const category = diagnosisCategory(input.diagnosis)
  const feedback = compact(input.checkin?.userFeedback || input.userFeedback || input.diagnosis?.evidence || '')
  const actionTitle = input.action?.title || '当前行动'
  const goalTitle = input.goal?.title || input.action?.goal?.title || '当前目标'
  const attach = (hypothesis) => attachMetaCognitionReflection(input, hypothesis)
  const evidence = [
    input.diagnosis?.evidence,
    feedback ? `用户反馈：${feedback}` : '',
    input.checkin?.result ? `Check-in 结果：${input.checkin.result}` : '',
    input.interventionDecision?.risk_point ? `干预风险点：${input.interventionDecision.risk_point}` : '',
  ].filter(Boolean)

  if (category === 'ABILITY') {
    return attach({
      hypothesis: `当前假设：用户在「${actionTitle}」上更容易被行动难度卡住，而不是完全放弃「${goalTitle}」。`,
      scope: buildScope(input),
      evidence,
      causal_explanation: `因为用户反馈或行动设计显示启动成本偏高，导致行动发生概率下降。`,
      decision_impact: '下一次干预应先降低行动难度，默认给出用户当下可承受的最小版本。',
      verification_signal: '如果下一次改成更小动作后完成率上升，则该假设被支持；如果仍不开始，需要重新判断方向或提示问题。',
      confidence: 0.66,
    })
  }

  if (category === 'PROMPT') {
    return attach({
      hypothesis: `当前假设：用户在「${goalTitle}」上的主要风险是关键时刻缺少有效提示。`,
      scope: buildScope(input),
      evidence,
      causal_explanation: '因为用户想做且知道大致做法，但反馈显示忘记、时间不对或风险点前没有触发提示，导致行动脱离控制。',
      decision_impact: '下一次干预应提前到风险点之前，并给出具体预案和 fallback_action，而不是事后复盘。',
      verification_signal: '如果提前提示后用户减少失控行为或完成最小动作，则该假设被支持；如果仍失控，需要判断难度或方向问题。',
      confidence: 0.68,
    })
  }

  if (category === 'MOTIVATION') {
    return attach({
      hypothesis: `当前假设：用户可能并不真正想推进「${goalTitle}」，或目标与当前价值冲突。`,
      scope: buildScope(input),
      evidence,
      causal_explanation: '因为反馈表达出不想做、没意义或不重要，导致继续催办无法提高行动概率，反而可能增加抵触。',
      decision_impact: '下一次干预应先重审目标真实性或建议暂停，而不是继续安排同类行动。',
      verification_signal: '如果用户确认目标仍重要，再回到拆小或提示；如果用户继续抗拒，应暂停或重定目标。',
      confidence: 0.56,
    })
  }

  if (category === 'PATH' || category === 'CONDITION' || category === 'GOAL') {
    return attach({
      hypothesis: `当前假设：「${goalTitle}」的当前行动路径没有稳定补齐关键条件。`,
      scope: buildScope(input),
      evidence,
      causal_explanation: '因为连续未完成或诊断指向路径/条件/目标问题，说明继续重复原行动不能有效改变系统状态。',
      decision_impact: '下一次干预应重建当前缺口、行动和阶段重点，而不是只继续提醒。',
      verification_signal: '如果换成更贴合关键条件的行动后 Check-in 改善，则该假设被支持；否则需要重审目标成功标准。',
      confidence: 0.64,
    })
  }

  return attach({
    hypothesis: `当前假设：「${goalTitle}」需要先收集更清楚的未完成原因。`,
    scope: buildScope(input),
    evidence: evidence.length ? evidence : ['当前反馈信息不足。'],
    causal_explanation: '因为现有反馈不能清楚区分方向、难度、提示或路径问题，导致直接调整计划容易误判。',
    decision_impact: '下一次干预应只问一个诊断问题，先减少最大不确定性。',
    verification_signal: '如果用户下一次能明确原因，则继续进入对应诊断；如果仍模糊，则降低行动难度做验证。',
    confidence: 0.45,
  })
}

export function evaluateInterventionEffectiveness(input = {}) {
  const checkins = input.checkins || []
  const latest = checkins[0]
  const decision = input.interventionDecision || {}
  const result = String(latest?.result || '').toUpperCase()
  const effective = result === 'DONE' || result === 'PARTIAL'
  const status = effective ? 'supported' : result === 'NOT_DONE' ? 'not_supported' : 'unknown'
  return {
    status,
    intervention_type: decision.intervention_type || 'unknown',
    risk_point: decision.risk_point || '',
    evidence: latest ? [`最近反馈：${latest.result}${latest.userFeedback ? `，${latest.userFeedback}` : ''}`] : ['暂无后续反馈。'],
    verification_plan: decision.verification_signal || '等待下一次 Check-in 验证本次干预是否有效。',
  }
}

function evaluateOneMetaCognitionHypothesis(hypothesis = {}, episode = {}) {
  const checkin = episode.checkin || {}
  const diagnosis = episode.diagnosis || {}
  const result = String(checkin.result || episode.checkin_result || '').toUpperCase()
  const hypothesisCategory = String(hypothesis.scope?.category || '').toUpperCase()
  const diagnosisCategoryValue = String(diagnosis.category || '').toUpperCase()
  const completed = result === 'DONE' || result === 'PARTIAL'
  const failed = result === 'NOT_DONE' || result === 'NO_RESPONSE'
  let evaluationResult = 'inconclusive'
  let reason = '本回合证据不足，暂不改变该假设。'

  if (completed) {
    evaluationResult = 'supported'
    reason = '后续反馈显示行动发生或部分发生，该假设对应的干预方向被支持。'
  } else if (failed && diagnosisCategoryValue && hypothesisCategory && diagnosisCategoryValue !== hypothesisCategory) {
    evaluationResult = 'contradicted'
    reason = `后续诊断转向 ${diagnosisCategoryValue}，旧假设 ${hypothesisCategory} 需要降权或修正。`
  } else if (failed) {
    evaluationResult = 'contradicted'
    reason = '后续反馈仍未发生行动，旧假设暂未被支持。'
  }

  const confidence = confidenceClamp(hypothesis.confidence)
  const confidenceDelta = evaluationResult === 'supported' ? 0.08 : evaluationResult === 'contradicted' ? -0.1 : 0
  const nextConfidence = confidenceClamp(confidence + confidenceDelta)
  const lifecycleStatus = evaluationResult === 'supported'
    ? 'strengthened'
    : evaluationResult === 'contradicted' && nextConfidence < 0.35
      ? 'expired'
      : evaluationResult === 'contradicted'
        ? (diagnosisCategoryValue && hypothesisCategory && diagnosisCategoryValue !== hypothesisCategory ? 'revised' : 'weakened')
        : 'evaluated'
  const evidenceUsed = [
    checkin.result ? `Check-in：${checkin.result}` : '',
    checkin.userFeedback ? `用户反馈：${compact(checkin.userFeedback, 160)}` : '',
    diagnosis.category ? `诊断：${diagnosis.category}` : '',
    episode.interventionDecision?.intervention_type ? `干预：${episode.interventionDecision.intervention_type}` : '',
  ].filter(Boolean)
  const policyDelta = policyDeltaForCategory(diagnosisCategoryValue || hypothesisCategory, asRecord(hypothesis.ai_self_reflection))
  const recheckRule = '下一个 ControlLoopEpisode 继续检查该策略是否提高完成率或降低无响应。'
  return {
    hypothesis_id: hypothesis.id,
    evaluation_result: evaluationResult,
    lifecycle_status: lifecycleStatus,
    confidence_delta: confidenceDelta,
    next_confidence: nextConfidence,
    evidence_used: evidenceUsed,
    policy_delta: policyDelta,
    ai_self_optimization: buildAiSelfOptimizationUpdate({
      hypothesis,
      evaluationResult,
      diagnosisCategory: diagnosisCategoryValue || hypothesisCategory,
      checkinResult: result,
      interventionDecision: episode.interventionDecision,
      policyDelta,
      evidenceUsed,
      recheckRule,
    }),
    recheck_rule: recheckRule,
    reason,
    evaluatedAt: new Date().toISOString(),
  }
}

export function evaluateMetaCognitionHypotheses(hypotheses = [], episode = {}) {
  return (Array.isArray(hypotheses) ? hypotheses : [])
    .filter((item) => item && typeof item === 'object')
    .slice(0, 8)
    .map((item) => evaluateOneMetaCognitionHypothesis(item, episode))
}

function applyMetaCognitionEvaluations(hypotheses = [], evaluations = []) {
  if (!Array.isArray(evaluations) || !evaluations.length) return hypotheses
  const evaluationById = new Map(evaluations.map((item) => [item.hypothesis_id, item]))
  return hypotheses.map((item) => {
    const evaluation = evaluationById.get(item.id)
    if (!evaluation) return item
    const optimization = asRecord(evaluation.ai_self_optimization)
    const previousSelf = asRecord(item.ai_self_reflection)
    const nextSelf = Object.keys(optimization).length ? {
      ...previousSelf,
      reasoning_adjustment: optimization.reasoning_adjustment || previousSelf.reasoning_adjustment,
      next_thinking_rule: optimization.next_thinking_rule || previousSelf.next_thinking_rule,
      intervention_policy_delta: optimization.intervention_policy_delta || previousSelf.intervention_policy_delta,
      verification_signal: optimization.verification_signal || previousSelf.verification_signal,
      last_self_evaluation_result: optimization.self_evaluation_result,
      last_reasoning_error: optimization.reasoning_error,
      last_self_updated_at: optimization.updatedAt,
    } : previousSelf
    return {
      ...item,
      confidence: evaluation.next_confidence,
      lifecycle_status: evaluation.lifecycle_status,
      ai_self_reflection: nextSelf,
      ai_self_optimization: Object.keys(optimization).length ? optimization : item.ai_self_optimization,
      policy_delta: evaluation.policy_delta || item.policy_delta,
      evaluation_history: [evaluation, ...(Array.isArray(item.evaluation_history) ? item.evaluation_history : [])].slice(0, 10),
      updatedAt: evaluation.evaluatedAt || new Date().toISOString(),
    }
  })
}

async function writeMetaCognitionDocument(prisma, userId, goalId, hypotheses) {
  const path = `system/meta-cognition/${goalId}.md`
  const content = [
    '# Meta-Cognition',
    '',
    ...hypotheses.map((item) => formatMetaCognitionHypothesisMarkdown(item)),
  ].join('\n')

  return prisma.markdownDocument.upsert({
    where: { userId_path: { userId, path } },
    update: {
      title: `Meta-Cognition ${goalId}`,
      content,
      type: 'SYSTEM',
      source: 'SYSTEM',
      linkedGoalIds: goalId === 'global' ? [] : [goalId],
      frontmatter: {
        kind: 'meta_cognition',
        hypotheses,
      },
    },
    create: {
      userId,
      type: 'SYSTEM',
      title: `Meta-Cognition ${goalId}`,
      path,
      content,
      source: 'SYSTEM',
      linkedGoalIds: goalId === 'global' ? [] : [goalId],
      linkedActionIds: [],
      frontmatter: {
        kind: 'meta_cognition',
        hypotheses,
      },
    },
  })
}

export function buildMetaCognitionFromReview(input = {}) {
  const diagnoses = input.diagnoses || input.goal?.diagnoses || []
  const checkins = input.checkins || input.goal?.checkins || []
  const diagnosis = diagnoses[0] || {}
  const latestCheckin = checkins[0] || {}
  const base = buildMetaCognitionHypothesis({
    userId: input.userId,
    goal: input.goal,
    diagnosis,
    checkin: latestCheckin,
    interventionDecision: input.interventionDecision,
    source: 'review.generate',
  })
  return {
    ...base,
    evidence: [
      ...base.evidence,
      input.interventionEvaluation?.status ? `本周期干预效果：${input.interventionEvaluation.status}` : '',
    ].filter(Boolean),
    decision_impact: `${base.decision_impact} Review 会把该判断交给下一次 Intervention Planner 使用。`,
  }
}

export async function persistMetaCognitionHypothesis(prisma, userId, hypothesis = {}, options = {}) {
  const quality = evaluateMemoryQuality({
    claim: hypothesis.hypothesis || hypothesis.claim,
    scope: hypothesis.scope,
    evidence: hypothesis.evidence,
    causal_explanation: hypothesis.causal_explanation,
    decision_impact: hypothesis.decision_impact,
    verification_signal: hypothesis.verification_signal,
    confidence: hypothesis.confidence,
  })

  if (!quality.accepted) {
    return { saved: false, quality, hypothesis }
  }

  const candidate = normalizeMemoryCandidate({
    claim: hypothesis.hypothesis || hypothesis.claim,
    scope: hypothesis.scope,
    evidence: hypothesis.evidence,
    causal_explanation: hypothesis.causal_explanation,
    decision_impact: hypothesis.decision_impact,
    verification_signal: hypothesis.verification_signal,
    confidence: hypothesis.confidence,
  })
  const goalId = options.goalId || candidate.scope.goalId || 'global'
  const path = `system/meta-cognition/${goalId}.md`
  const existing = await prisma.markdownDocument.findUnique({ where: { userId_path: { userId, path } } })
  const existingFrontmatter = asRecord(existing?.frontmatter)
  const existingHypotheses = Array.isArray(existingFrontmatter.hypotheses) ? existingFrontmatter.hypotheses : []
  const evaluatedHypotheses = applyMetaCognitionEvaluations(existingHypotheses, options.evaluations)
  const nextHypothesis = {
    id: `mc-${Date.now()}`,
    ...candidate,
    ai_self_reflection: asRecord(hypothesis.ai_self_reflection),
    ai_self_optimization: asRecord(hypothesis.ai_self_optimization),
    policy_delta: asRecord(hypothesis.policy_delta),
    lifecycle_status: hypothesis.lifecycle_status || 'active',
    evaluation_history: Array.isArray(hypothesis.evaluation_history) ? hypothesis.evaluation_history : [],
    daily_reflection: asRecord(hypothesis.daily_reflection),
    source: options.source || candidate.scope.source || 'system',
    updatedAt: new Date().toISOString(),
  }
  const hypotheses = [nextHypothesis, ...evaluatedHypotheses].slice(0, 30)
  const document = await writeMetaCognitionDocument(prisma, userId, goalId, hypotheses)

  return { saved: true, quality, hypothesis: nextHypothesis, document }
}

export async function persistMetaCognitionEvaluations(prisma, userId, evaluations = [], options = {}) {
  if (!Array.isArray(evaluations) || !evaluations.length) {
    return { saved: false, evaluations: [], reason: 'no_evaluations' }
  }
  const goalId = options.goalId || 'global'
  const path = `system/meta-cognition/${goalId}.md`
  const existing = await prisma.markdownDocument.findUnique({ where: { userId_path: { userId, path } } })
  const existingFrontmatter = asRecord(existing?.frontmatter)
  const existingHypotheses = Array.isArray(existingFrontmatter.hypotheses) ? existingFrontmatter.hypotheses : []
  if (!existingHypotheses.length) return { saved: false, evaluations, reason: 'no_existing_hypotheses' }
  const hypotheses = applyMetaCognitionEvaluations(existingHypotheses, evaluations).slice(0, 30)
  const document = await writeMetaCognitionDocument(prisma, userId, goalId, hypotheses)
  return { saved: true, evaluations, hypotheses, document }
}

export async function loadMetaCognitionHypotheses(prisma, userId, options = {}) {
  const documents = await prisma.markdownDocument.findMany({
    where: {
      userId,
      type: 'SYSTEM',
      path: { contains: options.goalId ? `system/meta-cognition/${options.goalId}` : 'system/meta-cognition/' },
    },
    orderBy: { updatedAt: 'desc' },
    take: 5,
  })

  return documents.flatMap((document) => {
    const frontmatter = asRecord(document.frontmatter)
    return Array.isArray(frontmatter.hypotheses) ? frontmatter.hypotheses : []
  })
}
