const vagueClaimPatterns = [
  /用户状态不好/u,
  /用户缺乏动力/u,
  /内驱力.*波动/u,
  /可能潜意识/u,
  /比较焦虑/u,
  /需要坚持/u,
]

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function normalizeList(value) {
  if (Array.isArray(value)) return value.filter((item) => String(item || '').trim()).map((item) => String(item).trim())
  if (typeof value === 'string' && value.trim()) return [value.trim()]
  if (value && typeof value === 'object') return [JSON.stringify(value)]
  return []
}

function readString(input, keys, fallback = '') {
  const record = asRecord(input)
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return fallback
}

function hasCausalSignal(value) {
  return /(因为|导致|所以|原因|如果|当|使得|从而|说明|therefore|because|leads to|causes)/iu.test(String(value || ''))
}

function hasVerificationSignal(value) {
  return /(如果|明天|下次|后续|验证|证伪|观察|反馈|若|when|if|next|verify|falsify)/iu.test(String(value || ''))
}

export function normalizeMemoryCandidate(input = {}) {
  const record = asRecord(input)
  return {
    claim: readString(record, ['claim', 'hypothesis']),
    scope: record.scope || {},
    evidence: normalizeList(record.evidence),
    causal_explanation: readString(record, ['causal_explanation', 'causalExplanation']),
    decision_impact: readString(record, ['decision_impact', 'decisionImpact']),
    verification_signal: readString(record, ['verification_signal', 'verificationSignal']),
    confidence: typeof record.confidence === 'number' ? Math.max(0, Math.min(1, record.confidence)) : 0.5,
  }
}

export function evaluateMemoryQuality(input = {}, options = {}) {
  const candidate = normalizeMemoryCandidate(input)
  const issues = []

  if (candidate.claim.length < 8) issues.push('claim_too_short')
  if (vagueClaimPatterns.some((pattern) => pattern.test(candidate.claim))) issues.push('claim_too_vague')
  if (!candidate.evidence.length || candidate.evidence.join(' ').length < 8) issues.push('missing_evidence')
  if (candidate.causal_explanation.length < 12) issues.push('missing_causal_explanation')
  if (!hasCausalSignal(candidate.causal_explanation)) issues.push('causal_explanation_not_explicit')
  if (candidate.decision_impact.length < 10) issues.push('missing_decision_impact')
  if (candidate.verification_signal.length < 10) issues.push('missing_verification_signal')
  if (!hasVerificationSignal(candidate.verification_signal)) issues.push('verification_signal_not_testable')

  if (options.requireDecisionImpact !== false && /无影响|不影响|仅记录/u.test(candidate.decision_impact)) {
    issues.push('no_decision_impact')
  }

  return {
    accepted: issues.length === 0,
    issues,
    candidate,
  }
}

export function assertCoreMemoryQuality(input = {}, options = {}) {
  const quality = evaluateMemoryQuality(input, options)
  if (!quality.accepted) {
    throw new Error(`Core memory rejected: ${quality.issues.join(', ')}`)
  }
  return quality
}

export function formatMemoryQualityMarkdown(hypothesis) {
  const candidate = normalizeMemoryCandidate(hypothesis)
  return [
    `## ${candidate.claim}`,
    '',
    `- 适用范围：${JSON.stringify(candidate.scope)}`,
    `- 依据：${candidate.evidence.join('；')}`,
    `- 因果解释：${candidate.causal_explanation}`,
    `- 决策影响：${candidate.decision_impact}`,
    `- 验证方式：${candidate.verification_signal}`,
    `- 置信度：${candidate.confidence}`,
    '',
  ].join('\n')
}
