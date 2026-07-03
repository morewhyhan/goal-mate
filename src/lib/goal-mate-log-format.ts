function pad(value: number) {
  return String(value).padStart(2, '0')
}

function getWeekNumber(date: Date) {
  const copied = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = copied.getUTCDay() || 7
  copied.setUTCDate(copied.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(copied.getUTCFullYear(), 0, 1))
  return Math.ceil((((copied.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
}

export function buildDailyLogPath(date = new Date()) {
  const year = date.getFullYear()
  const month = `${year}-${pad(date.getMonth() + 1)}`
  const quarter = `Q${Math.floor(date.getMonth() / 3) + 1}`
  const week = `W${pad(getWeekNumber(date))}`
  const day = `${year}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

  return `logs/${year}/${quarter}/${month}/${week}/${day}.md`
}

function asLogRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function readLogString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function readMetaCognitionHypothesis(value: unknown) {
  const wrapper = asLogRecord(value)
  return asLogRecord(wrapper.hypothesis || value)
}

function buildMetaCognitionLogLines(value: unknown) {
  const hypothesis = readMetaCognitionHypothesis(value)
  const self = asLogRecord(hypothesis.ai_self_reflection)
  const claim = readLogString(hypothesis.claim || hypothesis.hypothesis)
  const userIntervention = readLogString(hypothesis.decision_impact)
  const aiReasoning = readLogString(self.next_thinking_rule || self.reasoning_adjustment)
  const policyDelta = readLogString(self.intervention_policy_delta)
  const verification = readLogString(hypothesis.verification_signal || self.verification_signal)

  if (!claim && !userIntervention && !aiReasoning && !verification) return []

  return [
    '### System Reflection',
    '',
    claim ? `- 对用户的判断：${claim}` : undefined,
    userIntervention ? `- 下次怎么干预用户：${userIntervention}` : undefined,
    aiReasoning ? `- AI 下次怎么思考：${aiReasoning}` : undefined,
    policyDelta ? `- AI 策略权重：${policyDelta}` : undefined,
    verification ? `- 下次验证信号：${verification}` : undefined,
  ].filter(Boolean)
}

export function buildCheckinLogBlock(input: {
  goalTitle: string
  actionTitle: string
  linkedCondition?: string
  result: string
  doneWhen?: string
  minimumStep?: string
  userFeedback?: string
  diagnosisQuestion?: string
  proposedNextAction?: string
  metaCognition?: unknown
  createdAt?: Date
}) {
  const createdAt = input.createdAt || new Date()
  const time = `${pad(createdAt.getHours())}:${pad(createdAt.getMinutes())}`
  const metaLines = buildMetaCognitionLogLines(input.metaCognition)
  const isDone = input.result === 'done' || input.result === 'DONE' || input.result === '完成'

  return [
    `## Check-in ${time}`,
    '',
    `- 目标：${input.goalTitle}`,
    `- 行动：${input.actionTitle}`,
    input.linkedCondition ? `- 关联条件：${input.linkedCondition}` : undefined,
    input.doneWhen ? `- 完成标准：${input.doneWhen}` : undefined,
    input.minimumStep ? `- 最小启动：${input.minimumStep}` : undefined,
    `- 系统观察：围绕「${input.goalTitle}」收集今日行动反馈。`,
    `- 结果：${input.result}`,
    input.userFeedback ? `- 用户反馈：${input.userFeedback}` : '- 用户反馈：',
    isDone
      ? '- 偏差判断：今日行动已完成，当前控制策略暂时有效。'
      : '- 偏差判断：今日反馈不是完成，需要判断是动机、能力、提示还是路径问题。',
    input.diagnosisQuestion ? `- 下一步调整：${input.diagnosisQuestion}` : '- 下一步调整：等待 Agent 根据反馈继续诊断或调整行动。',
    input.proposedNextAction ? `- 建议动作：${input.proposedNextAction}` : undefined,
    metaLines.length ? '' : undefined,
    ...metaLines,
    '',
  ].filter(Boolean).join('\n')
}
