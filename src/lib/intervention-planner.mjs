import { loadMetaCognitionHypotheses } from './meta-cognition-layer.mjs'
import {
  INTERVENTION_POLICY_VERSION,
  PLANNER_SOURCE_AI,
  PLANNER_SOURCE_FALLBACK,
  buildInterventionPolicyPrompt,
  evaluateInterventionDecisionQuality,
  extractJsonObject,
  normalizeInterventionDecision,
} from './intervention-policy.mjs'
import { resolveModelApiKey } from './model-secret.mjs'
import { chatCompletionsUrl } from './model-endpoint.mjs'
import { fetchModelProvider } from './model-provider-http.mjs'

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function latest(items = []) {
  return items[0] || null
}

function compact(value, max = 160) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max)}...` : text
}

function feedbackText(context) {
  const checkins = asArray(context.checkins)
  const diagnoses = asArray(context.diagnoses)
  const actions = asArray(context.actions)
  return [
    latest(checkins)?.userFeedback,
    latest(diagnoses)?.evidence,
    latest(diagnoses)?.nextQuestion,
    latest(actions)?.title,
  ].filter(Boolean).join(' ')
}

function countRecentMisses(checkins = []) {
  let count = 0
  for (const checkin of checkins) {
    const result = String(checkin.result || '').toUpperCase()
    if (result === 'NOT_DONE' || result === 'PARTIAL' || result === 'NO_RESPONSE') count += 1
    else break
  }
  return count
}

function hasMetaSignal(hypotheses, pattern) {
  return hypotheses.some((item) => pattern.test([
    item.claim,
    item.hypothesis,
    item.causal_explanation,
    item.decision_impact,
    item.policy_delta?.reason,
    item.policy_delta?.next_thinking_rule,
    item.ai_self_reflection?.next_thinking_rule,
    item.ai_self_optimization?.reasoning_error,
    item.ai_self_optimization?.next_thinking_rule,
    item.ai_self_optimization?.avoid_next_time,
  ].filter(Boolean).join(' ')))
}

function summarizeMetaCognitionUse(context = {}) {
  const active = asArray(context.metaCognitionHypotheses)
    .filter((item) => !['expired'].includes(String(item.lifecycle_status || '').toLowerCase()))
    .slice(0, 5)
  return {
    activeIds: active.map((item) => item.id).filter(Boolean),
    claims: active.map((item) => {
      const claim = item.claim || item.hypothesis
      const selfRule = item.ai_self_reflection?.next_thinking_rule
      const selfOptimizationRule = item.ai_self_optimization?.next_thinking_rule
      return [
        claim,
        selfRule ? `AI 下次思考：${selfRule}` : '',
        selfOptimizationRule ? `AI 自我优化：${selfOptimizationRule}` : '',
      ].filter(Boolean).join(' | ')
    }).filter(Boolean),
    policyDeltas: active.flatMap((item) => {
      const optimization = item.ai_self_optimization || {}
      const delta = item.policy_delta || optimization.policy_delta || {}
      const increase = Array.isArray(delta.increase) ? delta.increase : []
      const decrease = Array.isArray(delta.decrease) ? delta.decrease : []
      const nextThinkingRule = delta.next_thinking_rule || item.ai_self_reflection?.next_thinking_rule || optimization.next_thinking_rule || ''
      if (!increase.length && !decrease.length && !nextThinkingRule) return []
      return [{
        hypothesis_id: item.id,
        increase,
        decrease,
        next_thinking_rule: nextThinkingRule,
        ai_self_evaluation_result: optimization.self_evaluation_result || '',
        lifecycle_status: item.lifecycle_status || 'active',
        confidence: item.confidence,
      }]
    }),
  }
}

function currentAction(context) {
  return context.action || latest(asArray(context.actions)) || {}
}

function currentCondition(context) {
  const action = currentAction(context)
  return action.condition || asArray(context.conditions).find((item) => item.id === action.conditionId) || latest(asArray(context.conditions)) || {}
}

function baseDecision(context, patch) {
  const goal = context.goal || {}
  const action = currentAction(context)
  const condition = currentCondition(context)
  const metaUse = summarizeMetaCognitionUse(context)
  return {
    intervention_type: patch.intervention_type || 'prompt',
    target_goal_id: goal.id || action.goalId || '',
    target_condition_id: condition.id || action.conditionId || '',
    risk_point: patch.risk_point || '当前风险点还不明确。',
    question_or_message: patch.question_or_message || '现在只确认一件事：这一步能开始吗？',
    expected_feedback: patch.expected_feedback || 'done / partial / not_done / answer',
    fallback_action: patch.fallback_action || action.fallbackAction || action.minimumStep || '如果状态差，只做 5 分钟最小动作。',
    reasoning_summary: patch.reasoning_summary || '基于当前目标、最近反馈和提醒规则生成。',
    verification_signal: patch.verification_signal || '看下一次 Check-in 是否完成或说明新的阻塞原因。',
    diagnostic_category: patch.diagnostic_category || 'UNKNOWN',
    planner_source: PLANNER_SOURCE_FALLBACK,
    policy_version: INTERVENTION_POLICY_VERSION,
    fallback_reason: patch.fallback_reason || '',
    meta_cognition_used: metaUse.claims,
    active_meta_cognition_ids: metaUse.activeIds,
    policy_delta_used: metaUse.policyDeltas,
  }
}

export async function buildAiPolicyInterventionDecision(input = {}) {
  const context = input.context || {}
  const apiKey = input.apiKey ?? ''
  const modelConfig = input.modelConfig || {}
  const modelName = String(modelConfig.model || process.env.GOAL_MATE_MODEL || process.env.DEEPSEEK_MODEL || 'gpt-5-nano')
  const apiBase = String(modelConfig.apiBase || process.env.GOAL_MATE_MODEL_API_BASE || process.env.DEEPSEEK_API_BASE || 'https://api.b.ai').replace(/\/+$/, '')
  const prompt = buildInterventionPolicyPrompt(context)

  if (!input.modelClient && !apiKey) {
    return { ok: false, error: 'missing_api_key', prompt }
  }

  try {
    let rawText = ''
    if (input.modelClient) {
      rawText = await input.modelClient({ prompt, context, modelName, apiBase })
    } else {
      const fetchImpl = input.fetchImpl || fetchModelProvider
      const response = await fetchImpl(chatCompletionsUrl(apiBase), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: modelName,
          temperature: modelConfig.temperature ?? 0.2,
          max_tokens: 700,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: prompt },
          ],
        }),
      })
      if (!response.ok) {
        const text = await response.text()
        return { ok: false, error: `model_http_${response.status}`, detail: text.slice(0, 240), prompt }
      }
      const data = await response.json()
      rawText = data?.choices?.[0]?.message?.content || ''
    }

    const parsed = extractJsonObject(rawText)
    const decision = normalizeInterventionDecision({
      ...parsed,
      model: modelName,
    }, context, PLANNER_SOURCE_AI)
    const quality = evaluateInterventionDecisionQuality(decision)
    if (!quality.accepted) {
      return { ok: false, error: 'decision_quality_rejected', quality, rawText, prompt }
    }
    return { ok: true, decision: quality.decision, quality, rawText, prompt }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      prompt,
    }
  }
}

export async function planInterventionFromContext(context = {}, options = {}) {
  const fallbackDecision = buildInterventionDecision(context)
  const aiAttempt = await buildAiPolicyInterventionDecision({
    context,
    apiKey: options.apiKey ?? resolveModelApiKey(options.modelConfig),
    modelConfig: options.modelConfig,
    modelClient: options.modelClient,
    fetchImpl: options.fetchImpl,
  })

  if (aiAttempt.ok) return aiAttempt.decision

  return {
    ...fallbackDecision,
    planner_source: PLANNER_SOURCE_FALLBACK,
    policy_version: INTERVENTION_POLICY_VERSION,
    fallback_reason: aiAttempt.error || 'ai_policy_failed',
    ai_policy_error: aiAttempt.error || 'ai_policy_failed',
    ai_policy_quality: aiAttempt.quality || null,
  }
}

export function buildInterventionDecision(context = {}) {
  const goal = context.goal || {}
  const action = currentAction(context)
  const checkins = asArray(context.checkins)
  const diagnoses = asArray(context.diagnoses)
  const meta = asArray(context.metaCognitionHypotheses)
  const feedback = feedbackText(context)
  const recentMisses = context.consecutiveMissCount ?? countRecentMisses(checkins)
  const noResponseCount = context.noResponseCount || 0
  const title = action.title || '今天这一步'
  const goalTitle = goal.title || action.goal?.title || '当前目标'
  const estimatedMinutes = Number(action.estimatedMinutes || 0)
  const actionIsTooLarge = estimatedMinutes > 60 || /太难|不会|累|没时间|做不动|启动不了/u.test(feedback) || hasMetaSignal(meta, /小切片|启动成本|行动仓位|最小动作|可承受/u)
  const promptRisk = /忘|提醒|时间不对|太晚|太早|没准备|风险点|预案|替代|失控|默认选择|关键时刻/u.test(feedback) || hasMetaSignal(meta, /关键时刻缺|风险点|提前|预案|替代动作|默认行为/u)
  const motivationRisk = /不想|没意义|不重要|没动力|别人|被催/u.test(feedback)
  const pathRisk = recentMisses >= 3 || diagnoses.some((item) => ['PATH', 'CONDITION', 'GOAL'].includes(String(item.category || '').toUpperCase()))
  const needsEvidenceFirst = hasMetaSignal(meta, /先收集|降低不确定性|先问一个|证据不足|避免误判|不要急着给方案|区分方向、难度、提示和路径/u)

  if (noResponseCount >= 2) {
    return baseDecision(context, {
      intervention_type: 'reduce_difficulty',
      diagnostic_category: 'PROMPT',
      risk_point: '连续无响应，继续加提醒频率可能造成打扰。',
      question_or_message: `我先不加频率。${goalTitle} 今天只确认一个最小问题：${title} 现在是太大、时间不对，还是你暂时不想碰？`,
      expected_feedback: 'answer',
      fallback_action: '只回复“太大 / 时间不对 / 不想碰”中的一个。',
      reasoning_summary: '连续无响应更像提醒复杂度或时机问题，先降低反馈成本。',
      verification_signal: '如果用户能回复一个原因，则证明降复杂度有效；如果仍无响应，下次应调时或重审目标。',
    })
  }

  if (motivationRisk) {
    return baseDecision(context, {
      intervention_type: 'pause_review',
      diagnostic_category: 'MOTIVATION',
      risk_point: '目标可能不是用户真正想要的结果，继续催促会制造抵触。',
      question_or_message: `先不催你做「${title}」。我只问一句：${goalTitle} 现在还是你真正想要的结果吗？`,
      expected_feedback: 'answer',
      fallback_action: '如果答案不确定，今天先暂停这个目标，不继续加任务。',
      reasoning_summary: '反馈出现目标意义或动机风险，应该重审方向而不是硬推。',
      verification_signal: '如果用户确认目标仍重要，再回到拆小或提示；如果否认，应暂停或重定目标。',
    })
  }

  if (promptRisk) {
    return baseDecision(context, {
      intervention_type: 'risk_warning',
      diagnostic_category: 'PROMPT',
      risk_point: '用户想做且大致能做，但关键时刻缺少提示或预案，容易进入默认高风险行为。',
      question_or_message: `先控风险：如果等会儿想偏离「${goalTitle}」，不要重新规划，先执行预案里的最小替代动作。现在能把替代方案准备好吗？`,
      expected_feedback: 'answer',
      fallback_action: action.fallbackAction || '先准备一个低成本替代动作，避免直接进入高风险默认行为。',
      reasoning_summary: '当前问题更像提示不足，需要在风险点前介入，而不是事后总结。',
      verification_signal: '如果提前提示后用户少一次失控或完成 fallback_action，则该干预有效；否则重新判断难度或方向。',
    })
  }

  if (actionIsTooLarge) {
    return baseDecision(context, {
      intervention_type: 'reduce_difficulty',
      diagnostic_category: 'ABILITY',
      risk_point: '行动步子过大，单次失败成本过高。',
      question_or_message: `今天不做完整版「${title}」。先做一个当下可承受的最小版本，做完只回复“完成/没完成”。`,
      expected_feedback: 'done / not_done',
      fallback_action: action.minimumStep || '只启动一个最低成本版本。',
      reasoning_summary: '最近反馈或元认知显示启动成本偏高，应先控制行动仓位。',
      verification_signal: '如果缩小后能完成，说明难度是主要问题；如果仍不开始，再判断方向或提示。',
    })
  }

  if (pathRisk) {
    return baseDecision(context, {
      intervention_type: 'review',
      diagnostic_category: 'PATH',
      risk_point: '连续未完成或路径诊断表明原行动可能没有补齐关键条件。',
      question_or_message: `这一步已经不适合继续硬推了。我们先判断：${title} 是太难，还是它根本没对准关键条件？`,
      expected_feedback: 'answer',
      fallback_action: '暂停新增任务，只回答“太难 / 没对准 / 目标不清楚”。',
      reasoning_summary: '连续偏差不能继续原样提醒，必须重建当前缺口或路径。',
      verification_signal: '如果用户指出路径问题，下次应替换行动；如果指出太难，下次应降难度。',
    })
  }

  if (needsEvidenceFirst) {
    return baseDecision(context, {
      intervention_type: 'clarify',
      diagnostic_category: 'UNKNOWN',
      risk_point: '上一轮 AI 判断证据不足，继续直接安排动作容易重复误判。',
      question_or_message: `我先不重新排计划。${title} 现在最像哪一种：太大、时间不对、目标不想碰，还是路径没对准？`,
      expected_feedback: 'answer',
      fallback_action: '只回复一个原因：太大 / 时间不对 / 不想碰 / 没对准。',
      reasoning_summary: '活跃元认知要求 AI 先修正自己的推理顺序，先收集区分四类问题的证据，再继续安排。',
      verification_signal: '如果用户给出明确类别，说明自我修正有效；如果仍模糊，下次使用更小动作做验证。',
    })
  }

  if (context.reminderType === 'evening_review') {
    return baseDecision(context, {
      intervention_type: 'review',
      diagnostic_category: 'UNKNOWN',
      risk_point: '晚上复盘如果问题过大，用户容易不回复。',
      question_or_message: `晚上只复盘一件事：「${title}」今天是完成、部分完成，还是没做？`,
      expected_feedback: 'done / partial / not_done',
      fallback_action: '只回复一个状态，不需要解释。',
      reasoning_summary: '晚间优先收集反馈信号，避免长问题增加负担。',
      verification_signal: '根据用户回复进入完成记录或四类诊断。',
    })
  }

  return baseDecision(context, {
    intervention_type: context.reminderType === 'morning_planning' ? 'prompt' : 'nudge',
    diagnostic_category: 'UNKNOWN',
    risk_point: '当前没有明确失控风险，保持一个具体下一步。',
    question_or_message: `今天只推进「${title}」。你现在能先做最小启动吗？`,
    expected_feedback: 'done / partial / not_done',
    fallback_action: action.minimumStep || action.fallbackAction || '先做 5 分钟。',
    reasoning_summary: '当前没有强风险信号，保持低负担推进。',
    verification_signal: '看下一次 Check-in 是否完成；未完成再进入四类诊断。',
  })
}

export async function planIntervention(prisma, userId, options = {}) {
  const goal = await prisma.goal.findFirst({
    where: options.goalId ? { id: options.goalId, userId } : { userId, isCurrentFocus: true },
    include: {
      keyResults: true,
      conditions: true,
      stagePlans: { orderBy: { sortOrder: 'asc' } },
      reasoningCards: { orderBy: { version: 'desc' }, take: 1 },
      dailyActions: {
        orderBy: { actionDate: 'desc' },
        take: 7,
        include: { condition: true, checkins: { orderBy: { createdAt: 'desc' }, take: 3 } },
      },
      checkins: { orderBy: { createdAt: 'desc' }, take: 10 },
      diagnoses: { orderBy: { createdAt: 'desc' }, take: 10 },
      reviews: { orderBy: { createdAt: 'desc' }, take: 3 },
    },
  })

  if (!goal) {
    return baseDecision({
      goal: {},
      action: {},
      reminderType: options.reminderType,
      metaCognitionHypotheses: [],
    }, {
      intervention_type: 'clarify',
      risk_point: '当前没有主目标，无法生成有效行动。',
      question_or_message: '你现在最想落地的一个现实结果是什么？只说结果，不用说计划。',
      expected_feedback: 'answer',
      fallback_action: '只回复一个想要的结果。',
      reasoning_summary: '没有 current focus goal，必须先澄清目标。',
      verification_signal: '如果用户给出结果，下一步生成目标草稿。',
    })
  }

  const metaCognitionHypotheses = await loadMetaCognitionHypotheses(prisma, userId, { goalId: goal.id })
  const recentNoResponseEvents = await prisma.schedulerEvent.findMany({
    where: {
      userId,
      status: 'sent',
      eventType: options.reminderType || undefined,
    },
    orderBy: { createdAt: 'desc' },
    take: 3,
  })
  const noResponseCount = recentNoResponseEvents.length >= 2 ? recentNoResponseEvents.length : 0

  const modelConfig = await prisma.modelConfig.findFirst({
    where: { userId, isDefault: true },
    orderBy: { createdAt: 'asc' },
  })

  return planInterventionFromContext({
    userId,
    goal,
    action: goal.dailyActions[0],
    actions: goal.dailyActions,
    conditions: goal.conditions,
    keyResults: goal.keyResults,
    checkins: goal.checkins,
    diagnoses: goal.diagnoses,
    reviews: goal.reviews,
    reminderType: options.reminderType,
    reminderRule: options.reminderRule,
    metaCognitionHypotheses,
    noResponseCount,
  }, {
    apiKey: options.apiKey,
    modelConfig,
    modelClient: options.modelClient,
    fetchImpl: options.fetchImpl,
  })
}
