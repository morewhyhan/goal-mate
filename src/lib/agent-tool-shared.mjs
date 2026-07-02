export const sharedAgentToolCatalog = [
  { name: 'goal.list', description: '列出当前用户的目标摘要。', permission: 'read', targetType: 'goal', riskLevel: 'low' },
  { name: 'goal.get', description: '读取目标详情、KR、条件、阶段计划和近期行动。', permission: 'read', targetType: 'goal', riskLevel: 'low' },
  { name: 'goal.create_draft', description: '根据对话创建目标草案和目标推理卡。', permission: 'draft', targetType: 'goal', riskLevel: 'medium' },
  { name: 'goal.update', description: '更新目标基础字段或当前焦点。', permission: 'execute', targetType: 'goal', riskLevel: 'medium' },
  { name: 'today.get', description: '读取今天或最近的下一步行动。', permission: 'read', targetType: 'today', riskLevel: 'low' },
  { name: 'today.set_next_action', description: '设置今天下一步行动。', permission: 'execute', targetType: 'today', riskLevel: 'medium' },
  { name: 'checkin.submit', description: '提交今日行动的完成情况和阻塞原因。', permission: 'execute', targetType: 'checkin', riskLevel: 'low' },
  { name: 'log.write_daily', description: '写入或更新当天 Markdown 日志。', permission: 'execute', targetType: 'log', riskLevel: 'low' },
  { name: 'review.generate', description: '生成日复盘或周复盘草稿。', permission: 'draft', targetType: 'review', riskLevel: 'low' },
  { name: 'reminder.schedule', description: '创建或调整提醒规则。', permission: 'execute', targetType: 'reminder', riskLevel: 'medium' },
  { name: 'settings.model.get', description: '读取当前默认模型配置。', permission: 'read', targetType: 'settings', riskLevel: 'low' },
  { name: 'settings.model.update', description: '修改默认模型配置。', permission: 'execute', targetType: 'settings', riskLevel: 'medium' },
]

export function listSharedAgentTools() {
  return sharedAgentToolCatalog.map((tool) => ({ ...tool }))
}

export function detectConfirmToolMessage(content = '') {
  return /^(确认执行|确认|执行|同意|可以|就这么做|开始执行)$/i.test(String(content).trim())
}

export function formatAgentToolReply(toolName, execution) {
  const action = execution?.action
  if (action?.status === 'failed') return `这个操作没有执行成功：${action.errorMessage || '未知错误'}`
  if (execution?.needsConfirmation) {
    return [
      '我理解你要改动系统数据。',
      `动作：${toolName}`,
      '我已经生成待确认动作。你可以点击“确认执行”，或回复“确认执行”。',
    ].join('\n')
  }

  const result = execution?.result
  if (toolName === 'goal.list' && Array.isArray(result)) {
    if (!result.length) return '当前还没有目标。你可以直接告诉我你想推进什么，我会先帮你生成目标草案。'
    return [
      `当前共有 ${result.length} 个目标：`,
      ...result.map((goal) => `- ${goal.title}${goal.isCurrentFocus ? '（当前主目标）' : ''}：${goal.status}`),
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
      `状态：${actionResult.status}`,
    ].join('\n')
  }
  if (toolName === 'goal.create_draft') return '目标草案已经生成。下一步应该确认：这个目标怎么算真正有进展。'
  if (toolName === 'today.set_next_action') return `今日下一步已经设置：${result?.title || '新的行动'}`
  if (toolName === 'checkin.submit') return '完成情况已经记录。'
  if (toolName === 'log.write_daily') return `日志已经写入：${result?.path || '今日日志'}`
  if (toolName === 'review.generate') return result?.markdown || '复盘草稿已经生成。'
  if (toolName === 'reminder.schedule') return `提醒规则已经设置：${result?.reminderType || 'reminder'} ${result?.schedule || ''}`
  if (toolName === 'settings.model.get') return result ? `当前默认模型：${result.provider} / ${result.model}` : '当前还没有默认模型配置。'
  if (toolName === 'settings.model.update') return `默认模型已经更新为：${result?.provider || 'provider'} / ${result?.model || 'model'}`
  return `已处理：${toolName}`
}
