const INTERNAL_REASON_LABELS = /\b(?:MOTIVATION|ABILITY|PROMPT|PATH|UNKNOWN|NO_RESPONSE|NOT_DONE|PARTIAL|DONE)\b/giu
const INTERNAL_REASON_LABEL_TEST = /\b(?:MOTIVATION|ABILITY|PROMPT|PATH|UNKNOWN|NO_RESPONSE|NOT_DONE|PARTIAL|DONE)\b/iu

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function questionCount(value) {
  return (String(value || '').match(/[？?]/g) || []).length
}

function keepAtMostOneQuestion(value) {
  let seen = false
  return String(value || '').replace(/[？?]/g, () => {
    if (seen) return '。'
    seen = true
    return '？'
  })
}

function hasNegatedPauseIntent(content) {
  return /(不要|不用|无需|别|不必).{0,4}(停止|暂停|关闭).{0,4}(提醒|催我)|不要.{0,4}(停|关).{0,4}(提醒|催我)|继续提醒|别停|不要停/u.test(content)
}

export function detectQqReminderControlIntent(text) {
  const content = normalizeText(text)
  if (!content) return null

  if (/(恢复|继续|重新开启|重新打开|再开).{0,8}(提醒|催我)|^(恢复提醒|继续提醒|重新提醒)$/u.test(content)) {
    return { action: 'resume', scope: 'qq', reason: 'user_requested_resume' }
  }

  if (hasNegatedPauseIntent(content)) return null

  const explicitReminderPause = /(暂停|停止|关闭|取消|别再|不要再|不用再|先别|别).{0,10}(提醒|催我|通知|消息)|(?:提醒|催我|通知|消息).{0,10}(暂停|停止|关闭|取消|别再|不要再)/u.test(content)
  const conversationStop = /^(不搞了|不弄了|不干了|不继续了|算了|停了|暂停|停止|放弃|别烦了?|先放着|今天不做了)[。！!]?$/u.test(content)
  if (!explicitReminderPause && !conversationStop) return null

  let reminderType = null
  if (/早上|早晨|晨间|早间/u.test(content)) reminderType = 'morning_planning'
  else if (/中午|午间/u.test(content)) reminderType = 'midday_check'
  else if (/晚上|晚间|复盘/u.test(content)) reminderType = 'evening_review'
  else if (/每周|周复盘|周报/u.test(content)) reminderType = 'weekly_review'

  return {
    action: 'pause',
    scope: reminderType ? 'reminder_type' : 'nearest_or_all',
    reminderType,
    reason: explicitReminderPause ? 'user_requested_pause' : 'user_stopped_current_work',
  }
}

export function shouldPauseAllQqProactiveRules(intent) {
  return intent?.action === 'pause' && !intent?.reminderType
}

export function selectQqReminderRulesForControl(rules, intent, recentSchedulerEvent = null) {
  const candidates = Array.isArray(rules) ? rules : []
  let selected = candidates.filter((rule) => {
    if (String(rule?.channel || '') !== 'qq') return false
    if (intent?.reminderType && rule?.reminderType !== intent.reminderType) return false
    if (intent?.action === 'pause') return rule?.enabled === true
    if (intent?.action === 'resume') {
      return rule?.enabled === false
        && rule?.metadata
        && typeof rule.metadata === 'object'
        && rule.metadata.pausedBy === 'qq_user'
    }
    return false
  })

  if (
    intent?.action === 'pause'
    && !intent?.reminderType
    && recentSchedulerEvent?.reminderRuleId
  ) {
    const nearest = selected.find((rule) => rule.id === recentSchedulerEvent.reminderRuleId)
    selected = nearest ? [nearest] : []
  }
  return selected
}

export function buildQqReminderControlToolInput(intent) {
  if (intent?.action !== 'resume') return null
  return {
    mode: 'autonomous',
    enabled: true,
    cadence: 'balanced',
    source: 'qq_conversation',
  }
}

export function hasExplicitSchedulerFeedbackSignal(text) {
  const content = normalizeText(text)
  if (!content) return false
  if (/(假如|如果|要是|比如).{0,12}(没做|没完成|做完|完成)/u.test(content)) return false
  return /(^|[，,。；;\s])(做了|做完了?|完成了?|搞定了?|还没|没做|没完成|没开始|只做了|做了一点|部分完成|进行中|卡住了?|忘了|太难了?|来不及|今天不做|done|finished|partial|not[_ -]?done)([，,。；;！!\s]|$)/iu.test(content)
    || /^(0|1|完成|未完成|没做|做了|还没|部分|进行中)[。！!]?$/u.test(content)
}

function readReferenceMessageId(context) {
  return normalizeText(
    context?.referenceMessageId
      || context?.messageReferenceId
      || context?.replyToMessageId
      || '',
  )
}

function schedulerEventReferenceIds(schedulerEvent) {
  const payload = schedulerEvent?.payload && typeof schedulerEvent.payload === 'object'
    ? schedulerEvent.payload
    : {}
  return new Set([
    schedulerEvent?.externalMessageId,
    schedulerEvent?.agentMessageId,
    payload.externalMessageId,
    payload.messageId,
  ].map(normalizeText).filter(Boolean))
}

export function isLikelyQqSchedulerFeedback(text, schedulerEvent, context = {}) {
  if (!schedulerEvent) return false
  if (detectQqReminderControlIntent(text)) return false

  const referenceMessageId = readReferenceMessageId(context)
  if (referenceMessageId && schedulerEventReferenceIds(schedulerEvent).has(referenceMessageId)) return true

  return hasExplicitSchedulerFeedbackSignal(text)
}

export function renderQqSchedulerFeedback(feedback, options = {}) {
  if (options.writeFailed) {
    return '我收到这次反馈了，但系统记录没有完全写入。这句话已经保留，稍后可以补录。'
  }

  const nextCommitment = options.nextCommitment
  if (nextCommitment?.persisted && nextCommitment?.title) {
    return [
      '这次反馈已经记下。',
      `下一步已经写入：${nextCommitment.title}`,
      nextCommitment.minimumStep ? `先从这里开始：${nextCommitment.minimumStep}` : '',
      options.reminderAdjustment?.applied
        ? `提醒候选时机已从 ${options.reminderAdjustment.previousSchedule} 调到 ${options.reminderAdjustment.newSchedule}，频率没有增加。`
        : '',
    ].filter(Boolean).join('\n')
  }

  if (feedback?.result === 'DONE') {
    return '记下了：今天这一步完成。但这次没有成功写入新的下一步。'
  }
  if (feedback?.result === 'NO_RESPONSE') {
    return '先不追问了。这次状态已经记录，但没有写入新的下一步。'
  }
  if (feedback?.reasonCategory === 'ABILITY') {
    return '原因记下了，但这次没有成功写入更小的下一步。'
  }
  if (feedback?.reasonCategory === 'PROMPT') {
    return '提醒时机的问题记下了，但这次没有成功写入新的时机与预案。'
  }
  if (feedback?.reasonCategory === 'PATH') {
    return '路径问题记下了，但这次没有成功写入新的下一步。'
  }
  if (feedback?.reasonCategory === 'MOTIVATION') {
    return '目标意愿的问题记下了，但这次没有成功写入暂停或调整动作。'
  }
  return '反馈记下了，但这次没有成功写入新的下一步。'
}

export function renderQqReminderControlResult(result) {
  const count = Number(result?.count || 0)
  if (result?.action === 'resume') {
    if (result?.pendingConfirmation) return '重新开启主动提醒需要你确认。回复“确认执行”后才会恢复，现在仍保持暂停。'
    if (!count) return '没有找到由你暂停的 QQ 提醒。'
    return `已恢复 ${count} 条 QQ 提醒，后续会继续按原来的时间执行。`
  }
  if (!count) return '当前没有正在运行的 QQ 提醒。目标和历史记录都没有被删除。'
  return `已暂停 ${count} 条 QQ 提醒，从现在起不会再按这些规则主动催你。目标和历史记录都保留。`
}

export function renderQqToolExecution(toolName, execution) {
  if (execution?.action?.status === 'failed') return '这次没有写入成功。我保留了你的原话，系统状态没有被假装更新。'
  if (execution?.needsConfirmation) {
    return '这会改变你的目标或系统设置。我已经准备好变更，回复“确认执行”后才会生效。'
  }

  const result = execution?.result
  if (toolName === 'goal.create_draft') {
    const goalTitle = result?.goal?.title || '这个目标'
    const successSignal = result?.reasoningCard?.successSignals?.[0]
      || result?.reasoningCard?.purposeSummary
      || result?.goal?.interpretedGoal
      || ''
    const action = result?.dailyAction
    return [
      `我先把它整理成目标草稿：${goalTitle}。`,
      successSignal ? `做到的标志：${successSignal}。` : '',
      action?.title ? `现在先做：${action.title}；${action.minimumStep || action.doneWhen || ''}` : '',
      '如果这个理解对，回复“确认执行”，我再把它设成当前主目标。',
    ].filter(Boolean).join('\n')
  }
  if (toolName === 'checkin.submit') {
    const diagnosis = result?.diagnosis
    const nextCommitment = result?.nextCommitment
    if (nextCommitment?.persisted && nextCommitment?.title) {
      return [
        '情况记下了。',
        `下一步已经写入：${nextCommitment.title}`,
        nextCommitment.minimumStep ? `先从这里开始：${nextCommitment.minimumStep}` : '',
        result?.reminderAdjustment?.applied
          ? `提醒候选时机也已从 ${result.reminderAdjustment.previousSchedule} 调到 ${result.reminderAdjustment.newSchedule}，频率没有增加。`
          : '',
      ].filter(Boolean).join('\n')
    }
    if (diagnosis?.nextQuestion) return `情况记下了。${diagnosis.nextQuestion}`
    return '情况记下了，但这次没有成功写入新的下一步。'
  }
  if (toolName === 'today.get') {
    const action = Array.isArray(result?.actions) ? result.actions[0] : null
    if (!action) return '今天还没有确定下一步。你直接告诉我现在最想推进的目标，我来整理。'
    return [
      `现在只做这一件：${action.title}`,
      action.doneWhen ? `做到这里算完成：${action.doneWhen}` : '',
      action.minimumStep ? `先启动：${action.minimumStep}` : '',
    ].filter(Boolean).join('\n')
  }
  if (toolName === 'goal.list' && Array.isArray(result)) {
    if (!result.length) return '现在还没有目标。你直接说想实现什么，我会先整理成草稿。'
    const current = result.find((goal) => goal.isCurrentFocus) || result[0]
    return `当前主要推进：${current.title}。${current.status ? `状态是 ${current.status}。` : ''}`
  }
  return ''
}

export function renderQqModelFailure(reason) {
  if (reason === 'missing_api_key') return '你的消息已经保存，但模型还没配置，所以我现在不能可靠地分析或调整计划。请先在 Settings 配置模型。'
  if (reason === 'insufficient_balance') return '你的消息已经保存，但模型额度不足，我没有改动计划。补充额度或更换可用模型后再继续。'
  if (reason === 'invalid_api_key') return '你的消息已经保存，但模型密钥无效或没有权限，我没有改动计划。请在 Settings 检查连接。'
  if (reason === 'rate_limited') return '你的消息已经保存，但模型现在请求过多，我没有改动计划。稍后再试。'
  if (reason === 'provider_unavailable' || reason === 'network_error') return '你的消息已经保存，但模型服务暂时连不上，我没有改动计划。稍后再试。'
  return '你的消息已经保存，但模型这次不可用，我没有改动计划。请在 Settings 检查模型连接。'
}

export function renderQqModelReply(value, options = {}) {
  const fallback = options.fallback || '这次没有得到可用回复，但你的消息已经保存。'
  let content = String(value || '').trim()
  if (!content) return fallback

  content = content
    .replace(INTERNAL_REASON_LABELS, '')
    .replace(/[ \t]+([，。；：！？])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  content = keepAtMostOneQuestion(content)

  if (options.maxLength && content.length > options.maxLength) {
    content = `${content.slice(0, options.maxLength).replace(/[，,；;：:\s]+$/u, '')}…`
  }
  return content || fallback
}

export function inspectQqRenderedMessage(value) {
  const content = String(value || '')
  return {
    questionCount: questionCount(content),
    exposesInternalReasonLabel: INTERNAL_REASON_LABEL_TEST.test(content),
  }
}
