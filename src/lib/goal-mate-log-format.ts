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

export function buildCheckinLogBlock(input: {
  goalTitle: string
  actionTitle: string
  linkedCondition?: string
  result: string
  doneWhen?: string
  minimumStep?: string
  userFeedback?: string
  diagnosisQuestion?: string
  createdAt?: Date
}) {
  const createdAt = input.createdAt || new Date()
  const time = `${pad(createdAt.getHours())}:${pad(createdAt.getMinutes())}`

  return [
    `## Check-in ${time}`,
    '',
    `- 目标：${input.goalTitle}`,
    `- 行动：${input.actionTitle}`,
    input.linkedCondition ? `- 关联条件：${input.linkedCondition}` : undefined,
    input.doneWhen ? `- 完成标准：${input.doneWhen}` : undefined,
    input.minimumStep ? `- 最小启动：${input.minimumStep}` : undefined,
    `- 结果：${input.result}`,
    input.userFeedback ? `- 用户反馈：${input.userFeedback}` : '- 用户反馈：',
    input.diagnosisQuestion ? `- 诊断问题：${input.diagnosisQuestion}` : undefined,
    '',
  ].filter(Boolean).join('\n')
}
