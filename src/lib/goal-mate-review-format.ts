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

export function buildReviewLogPath(type: string, date = new Date()) {
  const year = date.getFullYear()
  const quarter = `Q${Math.floor(date.getMonth() / 3) + 1}`
  const month = `${year}-${pad(date.getMonth() + 1)}`
  const week = `W${pad(getWeekNumber(date))}`

  if (type === 'yearly') return `logs/${year}/${year}.md`
  if (type === 'quarterly') return `logs/${year}/${quarter}/${year}-${quarter}.md`
  if (type === 'monthly') return `logs/${year}/${quarter}/${month}/${month}.md`
  return `logs/${year}/${quarter}/${month}/${week}/${year}-${week}.md`
}

export function reviewTypeToPeriodType(type: string) {
  if (type === 'yearly') return 'YEAR'
  if (type === 'quarterly') return 'QUARTER'
  if (type === 'monthly') return 'MONTH'
  return 'WEEK'
}

export function reviewTypeToPrismaType(type: string) {
  if (type === 'daily') return 'DAILY'
  if (type === 'monthly') return 'MONTHLY'
  if (type === 'quarterly') return 'QUARTERLY'
  if (type === 'yearly') return 'YEARLY'
  if (type === 'goal_cycle') return 'GOAL_CYCLE'
  return 'WEEKLY'
}

export function buildReviewMarkdown(input: {
  type: string
  goalTitle: string
  keyResults: Array<{ title: string; progress?: number | null; currentValue?: string | null; targetValue?: string | null }>
  conditions: Array<{ title: string; status?: string | null }>
  checkins: Array<{ result: string; userFeedback?: string | null }>
  diagnoses: Array<{ category: string; nextQuestion: string }>
  interventionEffectiveness?: { status?: string | null } | null
  metaEvaluations?: Array<{ hypothesis_id?: string; evaluation_result?: string; reason?: string }>
}) {
  const doneCount = input.checkins.filter((item) => item.result === 'DONE').length
  const partialCount = input.checkins.filter((item) => item.result === 'PARTIAL').length
  const notDoneCount = input.checkins.filter((item) => item.result === 'NOT_DONE').length
  const missingConditions = input.conditions.filter((item) => item.status === 'MISSING' || item.status === 'PARTIAL')
  const nextCondition = missingConditions[0]?.title || input.conditions[0]?.title || '继续确认当前关键条件'
  const metaEvaluations = input.metaEvaluations || []
  const supported = metaEvaluations.filter((item) => item.evaluation_result === 'supported').length
  const contradicted = metaEvaluations.filter((item) => item.evaluation_result === 'contradicted').length
  const inconclusive = metaEvaluations.filter((item) => item.evaluation_result === 'inconclusive').length

  return `# ${input.goalTitle} ${input.type} review\n\n## 本周期实际推进\n\n- 完成：${doneCount}\n- 部分完成：${partialCount}\n- 未完成：${notDoneCount}\n\n## KR 变化\n\n${input.keyResults.map((kr) => `- ${kr.title}：${Math.round((kr.progress || 0) * 100)}%（${kr.currentValue || '当前值待记录'} / ${kr.targetValue || '目标值待记录'}）`).join('\n')}\n\n## 条件变化\n\n${input.conditions.map((condition) => `- ${condition.title}：${condition.status || 'unknown'}`).join('\n')}\n\n## 未完成诊断\n\n${input.diagnoses.length ? input.diagnoses.map((diagnosis) => `- ${diagnosis.category}：${diagnosis.nextQuestion}`).join('\n') : '- 暂无明确诊断。'}\n\n## 控制回合有效性\n\n- 最近干预效果：${input.interventionEffectiveness?.status || '暂无可判断证据'}\n- 元认知评估：supported ${supported} / contradicted ${contradicted} / inconclusive ${inconclusive}\n${metaEvaluations.length ? metaEvaluations.slice(0, 5).map((item) => `- ${item.hypothesis_id || 'unknown'}：${item.evaluation_result || 'unknown'}；${item.reason || ''}`).join('\n') : '- 暂无活跃元认知可评估。'}\n\n## 下周期重点\n\n继续补齐「${nextCondition}」。\n`
}
