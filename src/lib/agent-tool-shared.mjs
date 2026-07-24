export const sharedAgentToolCatalog = [
  { name: 'goal.list', description: '列出当前用户的目标摘要。', permission: 'read', targetType: 'goal', riskLevel: 'low' },
  { name: 'goal.get', description: '读取目标详情、KR、条件、阶段计划和近期行动。', permission: 'read', targetType: 'goal', riskLevel: 'low' },
  { name: 'goal.create_draft', description: '根据对话创建目标草案和目标推理卡。', permission: 'draft', targetType: 'goal', riskLevel: 'medium' },
  { name: 'goal.update', description: '更新目标基础字段、当前焦点、KR、条件或阶段计划。', permission: 'execute', targetType: 'goal', riskLevel: 'medium' },
  { name: 'today.get', description: '读取今天或最近的下一步行动。', permission: 'read', targetType: 'today', riskLevel: 'low' },
  { name: 'today.set_next_action', description: '设置今天下一步行动。', permission: 'execute', targetType: 'today', riskLevel: 'medium' },
  { name: 'checkin.submit', description: '提交今日行动的完成情况和阻塞原因。', permission: 'execute', targetType: 'checkin', riskLevel: 'low' },
  { name: 'log.write_daily', description: '写入或更新当天 Markdown 日志。', permission: 'execute', targetType: 'log', riskLevel: 'low' },
  { name: 'review.generate', description: '生成日复盘或周复盘草稿。', permission: 'draft', targetType: 'review', riskLevel: 'low' },
  { name: 'reminder.schedule', description: '开启由助手选择候选时机的主动联系、设置具体提醒，或立即暂停主动联系。自主模式 input 使用 mode=autonomous、enabled=true、cadence=light|balanced|supportive；暂停使用 mode=pause、enabled=false。', permission: 'execute', targetType: 'reminder', riskLevel: 'medium' },
  { name: 'settings.model.get', description: '读取当前默认模型配置。', permission: 'read', targetType: 'settings', riskLevel: 'low' },
  { name: 'settings.model.update', description: '修改默认模型配置。', permission: 'execute', targetType: 'settings', riskLevel: 'medium' },
]

export function listSharedAgentTools() {
  return sharedAgentToolCatalog.map((tool) => ({ ...tool }))
}

export function detectConfirmToolMessage(content = '') {
  return /^(确认执行|确认|执行|同意|可以|就这么做|开始执行)$/i.test(String(content).trim())
}

export function asAgentToolRecord(input) {
  return input && typeof input === 'object' && !Array.isArray(input) ? input : {}
}

export function readAgentToolString(input, key, fallback = '') {
  const value = input[key]
  return typeof value === 'string' ? value.trim() : fallback
}

export function readAgentToolNumber(input, key, fallback) {
  const value = input[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function readAgentToolBoolean(input, key) {
  const value = input[key]
  return typeof value === 'boolean' ? value : undefined
}

export function compactAgentToolSummary(input) {
  const text = JSON.stringify(input)
  return text.length > 500 ? `${text.slice(0, 500)}...` : text
}

export function toAgentToolDateInput(value) {
  if (!value) return new Date()
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed
}

function padAgentToolDate(value) {
  return String(value).padStart(2, '0')
}

function getAgentToolWeekNumber(date) {
  const copied = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = copied.getUTCDay() || 7
  copied.setUTCDate(copied.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(copied.getUTCFullYear(), 0, 1))
  return Math.ceil((((copied.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
}

export function formatAgentToolDatePath(date) {
  const year = date.getFullYear()
  const monthNumber = padAgentToolDate(date.getMonth() + 1)
  const dayNumber = padAgentToolDate(date.getDate())
  const month = `${year}-${monthNumber}`
  const quarter = `Q${Math.floor(date.getMonth() / 3) + 1}`
  const week = `W${padAgentToolDate(getAgentToolWeekNumber(date))}`
  const day = `${year}-${monthNumber}-${dayNumber}`
  return {
    title: day,
    path: `logs/${year}/${quarter}/${month}/${week}/${day}.md`,
  }
}

export function normalizeAgentToolCheckinResult(value) {
  const normalized = String(value || '').toLowerCase()
  if (normalized === 'done') return 'DONE'
  if (normalized === 'partial') return 'PARTIAL'
  if (normalized === 'not_done') return 'NOT_DONE'
  return 'NO_RESPONSE'
}

export function normalizeAgentToolActionStatus(value) {
  const normalized = normalizeAgentToolCheckinResult(value)
  if (normalized === 'DONE') return 'DONE'
  if (normalized === 'PARTIAL') return 'PARTIAL'
  if (normalized === 'NOT_DONE') return 'NOT_DONE'
  return 'PLANNED'
}

export function parseAgentToolIntentJson(value) {
  const match = String(value || '').match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    const parsed = JSON.parse(match[0])
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function humanAgentToolActionName(toolName) {
  const labels = {
    'goal.update': '确认当前目标',
    'today.set_next_action': '调整当前任务',
    'checkin.submit': '记录执行反馈',
    'log.write_daily': '整理推进记录',
    'review.generate': '生成复盘',
    'reminder.schedule': '调整主动联系',
    'settings.model.update': '更新模型设置',
  }
  return labels[toolName] || '更新系统状态'
}

function humanGoalStatus(status) {
  const labels = {
    DRAFT: '待确认',
    ACTIVE: '推进中',
    PAUSED: '已暂停',
    COMPLETED: '已完成',
    ARCHIVED: '已归档',
  }
  return labels[String(status || '').toUpperCase()] || '状态已记录'
}

function humanActionStatus(status) {
  const labels = {
    PLANNED: '待执行',
    IN_PROGRESS: '进行中',
    DONE: '已完成',
    PARTIAL: '部分完成',
    NOT_DONE: '未完成',
    SKIPPED: '已跳过',
  }
  return labels[String(status || '').toUpperCase()] || '状态已记录'
}

function humanCadence(cadence) {
  return {
    light: '低频',
    balanced: '适中',
    supportive: '更积极',
  }[String(cadence || '').toLowerCase()] || '适中'
}

export function formatAgentToolReply(toolName, execution) {
  const action = execution?.action
  if (action?.status === 'failed') return `这个操作没有执行成功：${action.errorMessage || '未知错误'}`
  if (execution?.needsConfirmation) {
    return [
      `我理解你要${humanAgentToolActionName(toolName)}。`,
      '我已经生成待确认动作。你可以点击“确认执行”，或回复“确认执行”。',
    ].join('\n')
  }

  const result = execution?.result
  if (toolName === 'goal.list' && Array.isArray(result)) {
    if (!result.length) return '当前还没有目标。你可以直接告诉我你想推进什么，我会先帮你生成目标草案。'
    return [
      `当前共有 ${result.length} 个目标：`,
      ...result.map((goal) => `- ${goal.title}${goal.isCurrentFocus ? '（当前主目标）' : ''}：${humanGoalStatus(goal.status)}`),
    ].join('\n')
  }
  if (toolName === 'today.get') {
    const actions = Array.isArray(result?.actions) ? result.actions : []
    if (!actions.length) return '当前还没有今日行动。你可以让我基于当前目标设置下一步。'
    const actionResult = actions[0]
    return [
      `当前下一步：${actionResult.title}`,
      `完成标准：${actionResult.doneWhen}`,
      `最小启动：${actionResult.minimumStep}`,
      `状态：${humanActionStatus(actionResult.status)}`,
    ].join('\n')
  }
  if (toolName === 'goal.create_draft') {
    const counts = [
      `${result?.keyResults?.length || 0} 条完成证据`,
      `${result?.conditions?.length || 0} 个必要条件`,
      `${result?.stagePlans?.length || 0} 个阶段`,
      result?.dailyAction ? '1 个今日启动动作' : '0 个今日启动动作',
    ].join('、')
    return [
      `目标草案已经生成：${result?.goal?.title || '新目标'}`,
      `已拆出 ${counts}。`,
      '下一步请确认这个目标是否作为当前主目标；确认后我会把它接入 Today 的推进节奏。',
    ].join('\n')
  }
  if (toolName === 'goal.update') return `目标已经更新：${result?.goal?.title || result?.title || '当前目标'}`
  if (toolName === 'today.set_next_action') return `今日下一步已经设置：${result?.title || '新的行动'}`
  if (toolName === 'checkin.submit') {
    const diagnosisLine = result?.diagnosis?.nextQuestion
      ? `我接下来会先弄清楚：${result.diagnosis.nextQuestion}`
      : result?.diagnosis?.proposedNextAction
        ? `下一步建议：${result.diagnosis.proposedNextAction}`
        : ''
    const nextCommitment = result?.nextCommitment
    const nextCommitmentWasPersisted = nextCommitment?.persisted === true || Boolean(nextCommitment?.id)
    const nextLine = nextCommitmentWasPersisted && nextCommitment?.title
      ? `下一步已经调整为：${nextCommitment.title}${nextCommitment.minimumStep ? `；最小启动是 ${nextCommitment.minimumStep}` : ''}`
      : ''
    const reminderLine = result?.reminderAdjustment?.applied
      ? `提醒候选时机已从 ${result.reminderAdjustment.previousSchedule} 调整到 ${result.reminderAdjustment.newSchedule}，没有增加频率。`
      : ''
    const logLine = result?.logEntry || result?.markdownDocument
      ? '推进记录已经同步。'
      : '自动日志已关闭；这次反馈仍已记录到任务状态中。'
    return [
      '完成情况已经记录。',
      nextLine,
      reminderLine,
      diagnosisLine,
      logLine,
    ].filter(Boolean).join('\n')
  }
  if (toolName === 'log.write_daily') return '今天的推进记录已经整理好。'
  if (toolName === 'review.generate') {
    const logLine = result?.logEntry || result?.markdownDocument
      ? '复盘已经同步到推进记录。'
      : '自动复盘日志已关闭；这次复盘仍保留在系统记录中。'
    return [
      result?.logEntry?.path || result?.markdownDocument?.path ? '复盘草稿已经生成并写入日志。' : '复盘草稿已经生成。',
      logLine,
      result?.markdown || '',
    ].filter(Boolean).join('\n')
  }
  if (toolName === 'reminder.schedule') {
    if (result?.mode === 'pause') {
      return `主动提醒已暂停。已停止 ${result?.disabledRuleIds?.length || 0} 条 QQ 候选规则；你再次明确开启前不会恢复。`
    }
    if (result?.mode === 'autonomous') {
      return [
        '主动联系已经开启。',
        `联系节奏：${humanCadence(result?.cadence)}；每天会在 ${result?.rules?.length || 0} 个候选窗口里判断是否值得联系。`,
        '到候选时段后，系统仍会根据是否已完成、是否在等你回复、免打扰和连续无响应决定发送、跳过或延后。',
      ].join('\n')
    }
    return `提醒规则已经设置：${result?.reminderType || 'reminder'} ${result?.schedule || ''}`
  }
  if (toolName === 'settings.model.get') return result ? `当前默认模型：${result.provider} / ${result.model}` : '当前还没有默认模型配置。'
  if (toolName === 'settings.model.update') return `默认模型已经更新为：${result?.provider || 'provider'} / ${result?.model || 'model'}`
  return '这个请求已经处理，并同步到系统状态。'
}
