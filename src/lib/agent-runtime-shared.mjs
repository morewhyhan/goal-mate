import { AGENT_SYSTEM_PROMPT_VERSION, buildAgentSystemPrompt } from './agent-prompts/index.ts'
import { sharedAgentToolCatalog, parseAgentToolIntentJson } from './agent-tool-shared.mjs'
import { loadMetaCognitionHypotheses } from './meta-cognition-layer.mjs'
import { chatCompletionsUrl } from './model-endpoint.mjs'
import { fetchModelProvider } from './model-provider-http.mjs'
import { resolveModelApiKey } from './model-secret.mjs'
import { inferProactiveContactToolIntent } from './proactive-contact-control.mjs'
import {
  classifyModelProviderFailure,
  formatAgentModelFailureMessage,
  formatAgentModelNetworkFailureMessage,
  parseModelProviderError,
} from './model-provider-errors.ts'

const FALLBACK_AGENT_SETTINGS = {
  can_read_goals: true,
  can_read_logs: true,
  memory_enabled: true,
}

const FALLBACK_CHAT_MODEL = {
  provider: 'B.AI',
  model: 'gpt-5-nano',
  apiBase: 'https://api.b.ai',
  temperature: 0.3,
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function trimForPrompt(value, max = 900) {
  const text = String(value || '')
  return text.length > max ? `${text.slice(0, max)}...` : text
}

function compactLines(lines, empty = '暂无。') {
  const normalized = lines.map((line) => String(line || '').trim()).filter(Boolean)
  return normalized.length ? normalized.join('\n') : empty
}

function formatDate(value) {
  if (!value) return '未定'
  const date = value instanceof Date ? value : new Date(String(value))
  if (Number.isNaN(date.getTime())) return '未定'
  return date.toISOString().slice(0, 10)
}

function formatDateRange(start, end) {
  return `${formatDate(start)} -> ${formatDate(end)}`
}

function formatProgress(value) {
  return typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value * 100)}%` : '未记录'
}

function formatJsonItems(value, max = 4) {
  const items = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
  return items.map((item) => {
    if (typeof item === 'string') return item.trim()
    if (item && typeof item === 'object') return trimForPrompt(JSON.stringify(item), 120)
    return String(item || '').trim()
  }).filter(Boolean).slice(0, max)
}

function buildGoalPromptContext(goal) {
  if (!goal) return '当前还没有主目标。用户如果询问当前目标，只能说明系统尚未建立主目标，并追问他想达到的结果。'

  const reasoningCard = goal.reasoningCards?.[0]
  const successSignals = formatJsonItems(reasoningCard?.successSignals)
  const evidence = formatJsonItems(reasoningCard?.evidence, 3)
  const keyResults = compactLines((goal.keyResults || []).map((kr, index) => [
    `- KR${index + 1}: ${kr.title}`,
    `进度 ${formatProgress(kr.progress)}`,
    `${kr.currentValue || '当前值未记录'} -> ${kr.targetValue || '目标值未记录'}`,
    kr.status ? `状态 ${kr.status}` : '',
    kr.whyNecessary ? `必要性：${trimForPrompt(kr.whyNecessary, 180)}` : '',
  ].filter(Boolean).join('；')))
  const conditions = compactLines((goal.conditions || []).map((condition, index) => [
    `- 条件${index + 1}: ${condition.title}`,
    `类型 ${condition.type}`,
    `状态 ${condition.status}`,
    `原因：${trimForPrompt(condition.whyRequired || '', 180)}`,
  ].filter(Boolean).join('；')))
  const stagePlans = compactLines((goal.stagePlans || []).map((stage, index) => {
    const signals = formatJsonItems(stage.successSignals, 3)
    return [
      `- 阶段${index + 1}: ${stage.title}`,
      `时间 ${formatDateRange(stage.startDate, stage.endDate)}`,
      stage.status ? `状态 ${stage.status}` : '',
      `目标：${trimForPrompt(stage.stageGoal || '', 180)}`,
      signals.length ? `验收信号：${signals.join(' / ')}` : '',
    ].filter(Boolean).join('；')
  }))
  const dailyActions = compactLines((goal.dailyActions || []).map((action) => [
    `- ${formatDate(action.actionDate)} ${action.title}`,
    action.status ? `状态 ${action.status}` : '',
    action.doneWhen ? `完成标准：${trimForPrompt(action.doneWhen, 160)}` : '',
    action.minimumStep ? `最小动作：${trimForPrompt(action.minimumStep, 140)}` : '',
    action.fallbackAction ? `兜底：${trimForPrompt(action.fallbackAction, 140)}` : '',
    action.checkinQuestion ? `反馈问题：${trimForPrompt(action.checkinQuestion, 140)}` : '',
  ].filter(Boolean).join('；')))
  const checkins = compactLines((goal.checkins || []).map((checkin) => [
    `- ${formatDate(checkin.createdAt)} ${checkin.result}`,
    checkin.reasonCategory ? `原因 ${checkin.reasonCategory}` : '',
    checkin.userFeedback ? `反馈：${trimForPrompt(checkin.userFeedback, 180)}` : '',
    checkin.adjustment ? `调整：${trimForPrompt(checkin.adjustment, 180)}` : '',
  ].filter(Boolean).join('；')))
  const diagnoses = compactLines((goal.diagnoses || []).map((diagnosis) => [
    `- ${diagnosis.category}`,
    diagnosis.evidence ? `证据：${trimForPrompt(diagnosis.evidence, 160)}` : '',
    diagnosis.adjustmentType ? `调整类型 ${diagnosis.adjustmentType}` : '',
    diagnosis.nextQuestion ? `下个问题：${trimForPrompt(diagnosis.nextQuestion, 160)}` : '',
    diagnosis.proposedNextAction ? `建议动作：${trimForPrompt(diagnosis.proposedNextAction, 160)}` : '',
  ].filter(Boolean).join('；')))
  const reviews = compactLines((goal.reviews || []).map((review) => [
    `- ${review.type} ${formatDateRange(review.periodStart, review.periodEnd)}`,
    review.progressSummary ? `进展：${trimForPrompt(review.progressSummary, 180)}` : '',
    review.blockerSummary ? `阻塞：${trimForPrompt(review.blockerSummary, 160)}` : '',
    review.nextFocus ? `下周期重点：${trimForPrompt(review.nextFocus, 160)}` : '',
  ].filter(Boolean).join('；')))

  return [
    '## 当前工作台快照',
    `当前主目标：${goal.title}`,
    `状态：${goal.status}`,
    `周期：${formatDateRange(goal.horizonStart, goal.horizonEnd)}`,
    `用户原始输入：${trimForPrompt(goal.rawInput || '', 260)}`,
    `系统解释：${trimForPrompt(goal.interpretedGoal || goal.rawInput || '', 260)}`,
    '',
    '## 完成标准和当前判断',
    reasoningCard?.purposeSummary ? `目标意义：${trimForPrompt(reasoningCard.purposeSummary, 260)}` : '目标意义：暂无。',
    reasoningCard?.sufficientConditionSet ? `充分条件集合：${trimForPrompt(reasoningCard.sufficientConditionSet, 260)}` : '充分条件集合：暂无。',
    reasoningCard?.recommendedFocus ? `当前推荐焦点：${trimForPrompt(reasoningCard.recommendedFocus, 220)}` : '当前推荐焦点：暂无。',
    successSignals.length ? `成功信号：${successSignals.join(' / ')}` : '成功信号：暂无。',
    evidence.length ? `证据：${evidence.join(' / ')}` : '证据：暂无。',
    '',
    '## KR',
    keyResults,
    '',
    '## 必要条件',
    conditions,
    '',
    '## 阶段计划',
    stagePlans,
    '',
    '## 今天和近期行动',
    dailyActions,
    '',
    '## 最近反馈',
    checkins,
    '',
    '## 最近诊断',
    diagnoses,
    '',
    '## 最近复盘',
    reviews,
  ].join('\n')
}

function buildMarkdownPromptContext(markdownDocuments) {
  if (!markdownDocuments.length) return '暂无 Markdown 文档。'
  return markdownDocuments.map((document) => [
    `- ${document.path} [${document.type}] ${document.title ? `《${document.title}》` : ''}`,
    `更新时间：${formatDate(document.updatedAt)}`,
    trimForPrompt(document.content || '', 900),
  ].join('\n')).join('\n\n')
}

function buildMemoryPromptContext(goal, history) {
  const threadMessages = history.slice(-8).map((message) => `- ${message.role}: ${trimForPrompt(message.content || '', 220)}`)
  return [
    goal
      ? [
          `最近复盘重点：${(goal.reviews || []).map((review) => review.nextFocus).filter(Boolean).slice(0, 3).join('；') || '暂无'}`,
          `最近诊断问题：${(goal.diagnoses || []).map((diagnosis) => diagnosis.nextQuestion).filter(Boolean).slice(0, 3).join('；') || '暂无'}`,
        ].join('\n')
      : '',
    `已加载最近对话：${threadMessages.length} 条`,
    `最近对话片段：\n${compactLines(threadMessages)}`,
  ].filter(Boolean).join('\n')
}

function buildCapabilityPromptContext(settings, channel = 'web') {
  const channelContract = channel === 'qq'
    ? '当前通道：QQ。普通回复优先 1-4 句，最多一个问题，不用 Markdown 表格，不重复整张任务卡；让用户能直接回一个短句。'
    : '当前通道：Web Agent。仍然保持简洁；需要确认时展示用户能理解的变更，不暴露内部工具名或 JSON。'
  return [
    `读取权限：Goals=${settings.canReadGoals ? 'ON' : 'OFF'}；Logs=${settings.canReadLogs ? 'ON' : 'OFF'}；Memory=${settings.memoryEnabled ? 'ON' : 'OFF'}`,
    channelContract,
    '可用系统动作：',
    ...sharedAgentToolCatalog.map((tool) => `- ${tool.name}: ${tool.description}；权限=${tool.permission}；风险=${tool.riskLevel}`),
    '执行原则：读操作可以直接回答；修改目标、设置、外部提醒等动作必须按工具确认规则执行。',
  ].join('\n')
}

function buildMetaCognitionPromptContext(hypotheses) {
  if (!hypotheses.length) return '暂无活跃元认知。'
  return hypotheses.slice(0, 5).map((item) => {
    const policyDelta = asRecord(item.policy_delta)
    const self = asRecord(item.ai_self_reflection)
    const increase = Array.isArray(policyDelta.increase) ? policyDelta.increase.join(',') : ''
    const decrease = Array.isArray(policyDelta.decrease) ? policyDelta.decrease.join(',') : ''
    return [
      `- ${trimForPrompt(String(item.claim || item.hypothesis || ''), 180)}`,
      item.lifecycle_status ? `状态:${item.lifecycle_status}` : '',
      typeof item.confidence === 'number' ? `置信度:${Math.round(item.confidence * 100)}%` : '',
      self.next_thinking_rule ? `AI 下次思考:${trimForPrompt(String(self.next_thinking_rule), 180)}` : '',
      increase ? `策略升权:${increase}` : '',
      decrease ? `策略降权:${decrease}` : '',
      policyDelta.verification_signal ? `验证:${trimForPrompt(String(policyDelta.verification_signal), 180)}` : '',
    ].filter(Boolean).join('；')
  }).join('\n')
}

function readBooleanSetting(value, fallback) {
  return typeof value === 'boolean' ? value : fallback
}

export async function loadSharedAgentRuntimeSettings(prisma, userId, defaults = FALLBACK_AGENT_SETTINGS) {
  const settings = await prisma.userSetting.findUnique({ where: { userId } })
  const agentSettings = { ...defaults, ...asRecord(settings?.agent) }
  return {
    canReadGoals: readBooleanSetting(agentSettings.can_read_goals, defaults.can_read_goals ?? true),
    canReadLogs: readBooleanSetting(agentSettings.can_read_logs, defaults.can_read_logs ?? true),
    memoryEnabled: readBooleanSetting(agentSettings.memory_enabled, defaults.memory_enabled ?? true),
  }
}

function extractSearchTerms(input) {
  const rawTerms = String(input || '').match(/[A-Za-z0-9_-]{2,}|[\u4e00-\u9fff]{2,}/g) || []
  const terms = new Set()
  for (const term of rawTerms) {
    if (/^[\u4e00-\u9fff]+$/.test(term) && term.length > 4) {
      for (let index = 0; index < term.length - 1; index += 2) terms.add(term.slice(index, index + 2))
    } else {
      terms.add(term)
    }
  }
  return [...terms].slice(0, 8)
}

async function findRelevantMarkdownDocuments(prisma, userId, input) {
  const terms = extractSearchTerms(input)
  if (terms.length) {
    const matched = await prisma.markdownDocument.findMany({
      where: {
        userId,
        OR: terms.flatMap((term) => [
          { title: { contains: term } },
          { path: { contains: term } },
          { content: { contains: term } },
        ]),
      },
      orderBy: { updatedAt: 'desc' },
      take: 8,
    })
    if (matched.length) return matched
  }
  return prisma.markdownDocument.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' }, take: 8 })
}

function toChatRole(role) {
  const normalized = String(role || '').toLowerCase()
  if (normalized === 'assistant' || normalized === 'system' || normalized === 'user') return normalized
  return 'user'
}

function buildAgentReplyStructuredOutput(input) {
  return {
    natural_reply: input.naturalReply,
    tool_intent: null,
    requires_confirmation: false,
    tool_result: null,
    model: {
      name: input.modelName,
      ok: input.ok,
      error: input.error || null,
      usage: input.usage || null,
    },
    context_policy: {
      can_read_goals: input.runtimeSettings.canReadGoals,
      can_read_logs: input.runtimeSettings.canReadLogs,
      memory_enabled: input.runtimeSettings.memoryEnabled,
    },
    prompt_version: AGENT_SYSTEM_PROMPT_VERSION,
  }
}

export async function generateAssistantReplyWithPrisma(prisma, options) {
  const {
    userId,
    threadId,
    latestUserContent,
    defaultAgentSettings = FALLBACK_AGENT_SETTINGS,
    defaultChatModel = FALLBACK_CHAT_MODEL,
    channel = 'web',
  } = options
  const [modelConfig, runtimeSettings] = await Promise.all([
    prisma.modelConfig.findFirst({ where: { userId, isDefault: true }, orderBy: { createdAt: 'asc' } }),
    loadSharedAgentRuntimeSettings(prisma, userId, defaultAgentSettings),
  ])
  const apiKey = resolveModelApiKey(modelConfig)
  const apiBase = String(modelConfig?.apiBase || defaultChatModel.apiBase).replace(/\/+$/, '')
  const modelName = String(modelConfig?.model || defaultChatModel.model)
  const thread = runtimeSettings.canReadGoals
    ? await prisma.agentThread.findFirst({ where: { id: threadId, userId }, select: { goalId: true } })
    : null
  const goalWhere = thread?.goalId ? { userId, id: thread.goalId } : { userId, isCurrentFocus: true }
  const [goal, history, crossChannelMemory] = await Promise.all([
    runtimeSettings.canReadGoals
      ? prisma.goal.findFirst({
          where: goalWhere,
          include: {
            keyResults: true,
            conditions: true,
            stagePlans: { orderBy: { sortOrder: 'asc' } },
            dailyActions: { orderBy: { actionDate: 'desc' }, take: 7 },
            checkins: { orderBy: { createdAt: 'desc' }, take: 5 },
            reasoningCards: { orderBy: { version: 'desc' }, take: 1 },
            diagnoses: { orderBy: { createdAt: 'desc' }, take: 3 },
            reviews: { orderBy: { createdAt: 'desc' }, take: 3 },
          },
        })
      : Promise.resolve(null),
    runtimeSettings.memoryEnabled
      ? prisma.agentMessage.findMany({ where: { userId, threadId }, orderBy: { createdAt: 'desc' }, take: 12 })
      : Promise.resolve([]),
    runtimeSettings.memoryEnabled
      ? prisma.agentMessage.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 24 })
      : Promise.resolve([]),
  ])
  const markdownDocuments = runtimeSettings.canReadLogs
    ? await findRelevantMarkdownDocuments(prisma, userId, latestUserContent)
    : []
  const metaCognitionHypotheses = runtimeSettings.canReadGoals && goal
    ? await loadMetaCognitionHypotheses(prisma, userId, { goalId: goal.id })
    : []
  const goalContext = !runtimeSettings.canReadGoals
    ? 'Settings 已关闭 Agent 读取 Goals。不要引用目标结构；如果用户需要目标信息，请先说明需要开启 Goals 读取。'
    : buildGoalPromptContext(goal)
  const markdownContext = !runtimeSettings.canReadLogs
    ? 'Settings 已关闭 Agent 读取 Logs。不要引用 Markdown 日志内容；如果用户需要日志信息，请先说明需要开启 Logs 读取。'
    : buildMarkdownPromptContext(markdownDocuments)
  const memoryContext = !runtimeSettings.memoryEnabled
    ? 'Settings 已关闭 Agent 对话记忆。不要引用历史对话。'
    : buildMemoryPromptContext(goal, crossChannelMemory.reverse())
  const metaCognitionContext = runtimeSettings.memoryEnabled
    ? buildMetaCognitionPromptContext(metaCognitionHypotheses)
    : 'Settings 已关闭 Agent 对话记忆。不要引用元认知判断。'
  const systemPrompt = buildAgentSystemPrompt({
    goalContext,
    memoryContext,
    metaCognitionContext,
    capabilityContext: buildCapabilityPromptContext(runtimeSettings, channel),
    markdownContext,
  })

  if (!apiKey) {
    const content = '我已经保存了你的消息，但当前用户还没有配置模型 API Key，所以还不能调用真实模型。请先在 Settings 里填入自己的模型密钥。'
    return {
      content,
      modelName,
      ok: false,
      structuredOutput: buildAgentReplyStructuredOutput({
        naturalReply: content,
        modelName,
        ok: false,
        runtimeSettings,
        error: 'missing_api_key',
      }),
    }
  }

  const conversationMessages = runtimeSettings.memoryEnabled
    ? history.reverse().map((message) => ({
        role: toChatRole(message.role),
        content: trimForPrompt(message.content, 1600),
      }))
    : [{ role: 'user', content: trimForPrompt(latestUserContent, 1600) }]

  try {
    const response = await fetchModelProvider(chatCompletionsUrl(apiBase), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: modelName,
        messages: [{ role: 'system', content: systemPrompt }, ...conversationMessages],
        temperature: modelConfig?.temperature ?? defaultChatModel.temperature,
        max_tokens: 1200,
      }),
    })
    if (!response.ok) {
      const rawMessage = parseModelProviderError(await response.text())
      const failure = classifyModelProviderFailure(response.status, rawMessage)
      const content = formatAgentModelFailureMessage(failure)
      return {
        content,
        modelName,
        ok: false,
        structuredOutput: buildAgentReplyStructuredOutput({
          naturalReply: content,
          modelName,
          ok: false,
          runtimeSettings,
          error: failure.reason,
        }),
      }
    }
    const data = await response.json()
    const content = data?.choices?.[0]?.message?.content
    const naturalReply = typeof content === 'string' && content.trim()
      ? content.trim()
      : '模型返回为空。我已经保存你的消息，但这次没有得到可用回复。'
    return {
      content: naturalReply,
      modelName,
      ok: true,
      structuredOutput: buildAgentReplyStructuredOutput({
        naturalReply,
        modelName,
        ok: true,
        runtimeSettings,
        usage: data?.usage,
      }),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const content = formatAgentModelNetworkFailureMessage(message)
    return {
      content,
      modelName,
      ok: false,
      structuredOutput: buildAgentReplyStructuredOutput({
        naturalReply: content,
        modelName,
        ok: false,
        runtimeSettings,
        error: 'network_error',
      }),
    }
  }
}

function firstNonEmptyLine(content) {
  return String(content || '').split(/\r?\n/).map((line) => line.trim()).find(Boolean) || ''
}

function extractLabeledValue(content, labels) {
  const lines = String(content || '').split(/\r?\n/)
  for (const label of labels) {
    const line = lines.find((item) => item.includes(label))
    if (!line) continue
    const value = line.slice(line.indexOf(label) + label.length).replace(/^[:：]\s*/, '').trim()
    if (value) return value
  }
  return ''
}

function parseLooseDate(value) {
  const text = String(value || '').trim()
  if (!text) return undefined
  const normalized = text.replace(/[年月]/g, '-').replace(/日/g, '').replace(/\./g, '-').replace(/\//g, '-')
  const parsed = new Date(normalized)
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
  const monthDay = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日?/)
  if (!monthDay) return undefined
  const parsedMonthDay = new Date(new Date().getFullYear(), Number(monthDay[1]) - 1, Number(monthDay[2]))
  return Number.isNaN(parsedMonthDay.getTime()) ? undefined : parsedMonthDay.toISOString()
}

function parseRelativeDeadline(content) {
  const match = String(content || '').match(/(\d+)\s*(天|日|周|个月|月|年)\s*(内|之内|以后|后)?/)
  if (!match) return undefined
  const amount = Number(match[1])
  if (!Number.isFinite(amount) || amount <= 0) return undefined
  const date = new Date()
  const unit = match[2]
  if (unit === '天' || unit === '日') date.setDate(date.getDate() + amount)
  if (unit === '周') date.setDate(date.getDate() + amount * 7)
  if (unit === '个月' || unit === '月') date.setMonth(date.getMonth() + amount)
  if (unit === '年') date.setFullYear(date.getFullYear() + amount)
  return date.toISOString()
}

function extractDeadline(content) {
  const labeled = extractLabeledValue(content, ['截止时间是', '截止时间', '截止到', '期限是', '到'])
  return parseLooseDate(labeled)
    || parseLooseDate((String(content || '').match(/(\d{4}[年/-]\d{1,2}[月/-]\d{1,2}日?|\d{1,2}月\d{1,2}日?)/)?.[1] || ''))
    || parseRelativeDeadline(content)
}

function extractDesiredResult(content) {
  const labeled = extractLabeledValue(content, ['我想达到的结果是', '想达到的结果是', '目标结果是', '目标是', '结果是'])
  if (labeled) return labeled
  return firstNonEmptyLine(content)
    .replace(/^(我想|我希望|希望|我要|我准备|准备|帮我|请你|麻烦你|目标是|计划是)\s*/u, '')
    .replace(/[。！？!?.].*$/u, '')
    .trim() || String(content || '').trim()
}

function extractCurrentState(content) {
  const labeled = extractLabeledValue(content, ['我现在的情况是', '现在的情况是', '当前情况是', '目前情况是', '现在是'])
  if (labeled) return labeled
  return String(content || '').match(/(现在|目前|当前)[，,：:\s]*(.{4,80})/)?.[2]?.trim() || ''
}

function isGoalLikeContent(content) {
  return /(我想|我希望|希望|我要|我准备|目标|计划|想要|帮我规划|提升|完成|达成|减到|学会|写完|上线|通过|考到|做到)/u.test(content)
}

function hasMeasurableSignal(content) {
  return /(\d+|一|二|三|四|五|六|七|八|九|十|百|千|万).*(斤|公斤|分|篇|字|小时|分钟|天|周|个月|次|个|%|％)|从\s*\d+.*到\s*\d+|完成|上线|发布|通过|考到|减到|写完|跑通/u.test(content)
}

function hasTimeSignal(content, deadline) {
  return Boolean(deadline || /(今天|明天|本周|这周|下周|月底|年底|暑假|寒假|季度|年度|年前|月前|\d+\s*(天|日|周|个月|月|年)\s*(内|之内)?)/u.test(content))
}

function hasCurrentStateSignal(content, currentState) {
  return Boolean(currentState || /(现在|目前|当前|已经|还没有|刚开始|卡在|最大问题|最难|从\s*\d+)/u.test(content))
}

function shouldUseFirstGoalDraft(content, existingGoalCount) {
  if (existingGoalCount > 0 || !isGoalLikeContent(content)) return false
  const deadline = extractDeadline(content)
  const currentState = extractCurrentState(content)
  const desiredResult = extractDesiredResult(content)
  const hasOutcome = desiredResult.length >= 8 || hasMeasurableSignal(content)
  return hasOutcome && (hasTimeSignal(content, deadline) || hasCurrentStateSignal(content, currentState) || hasMeasurableSignal(content))
}

function buildFirstGoalClarification(content) {
  const desiredResult = extractDesiredResult(content)
  const deadline = extractDeadline(content)
  const currentState = extractCurrentState(content)
  if (!desiredResult || desiredResult.length < 8) return '你最终想看到什么可验证结果？用一句话说清楚“到什么程度算成”。'
  if (!hasTimeSignal(content, deadline)) return '这个结果希望到哪一天，或者哪个周期结束时看到？'
  if (!hasCurrentStateSignal(content, currentState)) return '你现在处在什么状态？只说当前水平和最卡的一点就够。'
  return '我还差一个判断：这件事最容易失控的点是什么？'
}

function inferDailyAction(content) {
  if (/(减肥|体重|运动|健身|走路|跑步|饮食|睡眠)/u.test(content)) {
    return {
      title: '完成 10 分钟低门槛身体管理动作',
      doneWhen: '完成 10 分钟走路、拉伸或记录今天第一餐，并回复实际完成情况。',
      minimumStep: '先站起来走 2 分钟，或者写下今天第一餐吃什么。',
      estimatedMinutes: 10,
      fallbackAction: '状态很差时，只记录一条饮食或体重事实。',
      checkinQuestion: '这一步完成了吗？',
    }
  }
  if (/(英语|背单词|学习|考试|阅读|默写|课程)/u.test(content)) {
    return {
      title: '完成 10 分钟最小学习动作',
      doneWhen: '学习 10 分钟，并记录一个已完成内容或一个卡住点。',
      minimumStep: '先打开材料，读或背 2 分钟。',
      estimatedMinutes: 10,
      fallbackAction: '状态很差时，只复习 3 个最小知识点。',
      checkinQuestion: '这 10 分钟完成了吗？',
    }
  }
  if (/(写|文章|日记|公众号|视频|内容|自媒体|发布)/u.test(content)) {
    return {
      title: '写 300 字可继续扩展的草稿',
      doneWhen: '写出 300 字草稿，哪怕很粗糙，也要能继续修改。',
      minimumStep: '先写 3 个要点。',
      estimatedMinutes: 15,
      fallbackAction: '状态很差时，只写一个标题和 3 个要点。',
      checkinQuestion: '草稿写出来了吗？',
    }
  }
  if (/(项目|代码|开发|产品|软件|上线|实现|比赛|仓库)/u.test(content)) {
    return {
      title: '推进一个 15 分钟可验证开发小步',
      doneWhen: '完成一个能被看见的小改动、文档补充或问题定位记录。',
      minimumStep: '先打开项目，写下当前最小可推进点。',
      estimatedMinutes: 15,
      fallbackAction: '状态很差时，只定位一个文件或写一条待办证据。',
      checkinQuestion: '这个小步是否留下了可验证证据？',
    }
  }
  return {
    title: '完成 10 分钟与目标直接相关的最小动作',
    doneWhen: '完成一个可以被描述和反馈的小动作，并回复实际结果。',
    minimumStep: '只开始 2 分钟。',
    estimatedMinutes: 10,
    fallbackAction: '状态很差时，只记录当前事实和下一步障碍。',
    checkinQuestion: '这一步完成了吗？',
  }
}

export function buildFirstGoalDraftInput(content, now = new Date()) {
  const desiredResult = extractDesiredResult(content)
  const deadline = extractDeadline(content)
  const currentState = extractCurrentState(content)
  const titleSource = desiredResult || firstNonEmptyLine(content).replace(/^我想/u, '').trim()
  const title = titleSource.length > 36 ? `${titleSource.slice(0, 36)}...` : titleSource
  if (!title) return null
  return {
    title,
    rawInput: String(content || '').trim(),
    interpretedGoal: [
      desiredResult ? `目标结果：${desiredResult}` : '',
      deadline ? `截止时间：${deadline.slice(0, 10)}` : '',
      currentState ? `当前情况：${currentState}` : '',
    ].filter(Boolean).join('\n') || String(content || '').trim(),
    horizonStart: now.toISOString(),
    ...(deadline ? { horizonEnd: deadline } : {}),
    purposeSummary: desiredResult || title,
    successSignals: [
      desiredResult || title,
      deadline ? `在 ${deadline.slice(0, 10)} 前看到可验证变化` : '形成可验证的现实变化',
      '每天有完成、部分完成或没完成的反馈证据',
    ],
    keyResults: [
      {
        title: `达到可验证结果：${title}`,
        metricType: 'TEXT',
        currentValue: currentState || '当前状态待继续校准',
        targetValue: desiredResult || title,
        progress: 0,
        whyNecessary: '这是判断目标是否真的落地的直接结果。',
      },
      {
        title: '形成稳定的每日行动和反馈证据',
        metricType: 'TEXT',
        currentValue: '未形成稳定反馈',
        targetValue: '每天至少留下完成、部分完成或未完成原因',
        progress: 0,
        whyNecessary: '没有反馈证据，AI 无法持续调整下一步。',
      },
    ],
    necessaryConditions: [
      {
        title: '成功标准和时间边界足够清楚',
        conditionType: 'hard',
        status: deadline && desiredResult ? 'partial' : 'missing',
        whyRequired: '没有验收标准，系统无法判断目标是否真的完成。',
      },
      {
        title: '今日行动足够小，能立刻启动',
        conditionType: 'hard',
        status: 'partial',
        whyRequired: '目标必须落到今天能做的一步，才能进入反馈闭环。',
      },
    ],
    stagePlans: [
      {
        title: '澄清和启动',
        stageGoal: '确认验收标准，完成第一次最小行动，建立反馈入口。',
        successSignals: ['目标标准可复述', 'Today 有唯一下一步', '第一次反馈已产生'],
        sortOrder: 0,
      },
      {
        title: '稳定推进',
        stageGoal: '让每日行动、反馈和风险提示形成稳定节奏。',
        successSignals: ['连续产生反馈证据', '未完成原因能被识别', '行动难度可调整'],
        sortOrder: 1,
      },
    ],
    evidence: ['用户通过自然语言表达目标。', currentState ? `当前状态：${currentState}` : '当前状态仍需继续追问校准。'],
    dailyAction: inferDailyAction(content),
  }
}

export async function evaluateFirstGoalTurnWithPrisma(prisma, userId, content) {
  const existingGoalCount = await prisma.goal.count({ where: { userId } })
  if (existingGoalCount > 0 || !isGoalLikeContent(content)) return null
  if (!shouldUseFirstGoalDraft(content, existingGoalCount)) {
    return { kind: 'clarification', content: buildFirstGoalClarification(content) }
  }
  const input = buildFirstGoalDraftInput(content)
  return input
    ? {
        kind: 'tool_intent',
        toolIntent: {
          toolName: 'goal.create_draft',
          input,
          confidence: 1,
          reason: '首次自然语言目标输入，生成目标草案。',
        },
      }
    : null
}

function pickTextAfterCommand(content) {
  const normalized = String(content || '').trim()
  const separatorMatch = normalized.match(/[：:]\s*(.+)$/)
  if (separatorMatch?.[1]?.trim()) return separatorMatch[1].trim()
  return normalized
    .replace(/^(请|帮我|麻烦)?(查看|列出|创建|生成|新增|新建|写入|写|记录|更新|设置|安排)(一下|一个|一条)?/u, '')
    .replace(/^(目标|日志|记录|复盘|周报|日报|月报|季报|年报)/u, '')
    .trim()
}

function inferReviewType(content) {
  if (/年报|年度|yearly|year/i.test(content)) return 'yearly'
  if (/季报|季度|quarterly|quarter/i.test(content)) return 'quarterly'
  if (/月报|月度|monthly|month/i.test(content)) return 'monthly'
  if (/周报|周复盘|weekly|week/i.test(content)) return 'weekly'
  if (/日报|日复盘|daily|day/i.test(content)) return 'daily'
  if (/目标周期|goal_cycle/i.test(content)) return 'goal_cycle'
  return undefined
}

export function inferCheckinFeedbackIntent(content) {
  if (/(假如|如果|要是).*(没做|未完成|没推进|做不动|不想做|不想开始|不想碰)/u.test(content)) return null
  const userFeedback = trimForPrompt(content, 240)
  if (/(完成了|做完了|已经完成|已完成|done)/iu.test(content)) {
    return { toolName: 'checkin.submit', input: { userFeedback, result: 'done' }, confidence: 0.84, reason: '用户反馈今日行动已完成。' }
  }
  if (/(部分完成|做了一点|做了点|只做了|完成一部分|partial)/iu.test(content)) {
    return { toolName: 'checkin.submit', input: { userFeedback, result: 'partial' }, confidence: 0.84, reason: '用户反馈今日行动部分完成。' }
  }
  if (/(没做|没有做|未完成|没完成|没推进|没开始|做不动|不想做|不想开始|不想碰|提不起劲|失败了|not[_ -]?done)/iu.test(content)) {
    return { toolName: 'checkin.submit', input: { userFeedback, result: 'not_done' }, confidence: 0.84, reason: '用户反馈今日行动未完成。' }
  }
  return null
}

function generateFallbackAgentToolIntent(latestUserContent) {
  const content = String(latestUserContent || '').trim()
  if (!content) return null
  const proactiveContactIntent = inferProactiveContactToolIntent(content)
  if (proactiveContactIntent) return proactiveContactIntent
  const feedbackIntent = inferCheckinFeedbackIntent(content)
  if (feedbackIntent) return feedbackIntent
  if (/(查看|列出|有哪些|当前).*(目标)|目标.*(列表|有哪些)/u.test(content)) {
    return { toolName: 'goal.list', input: {}, confidence: 0.82, reason: '用户要求查看目标。' }
  }
  if (/(查看|当前|今天|下一步).*(行动|任务|要做什么)|今天.*(做什么|下一步)/u.test(content)) {
    return { toolName: 'today.get', input: {}, confidence: 0.82, reason: '用户要求查看今日行动。' }
  }
  if (/(当前|查看|读取).*(模型|model)|模型.*(配置|是什么)/iu.test(content)) {
    return { toolName: 'settings.model.get', input: {}, confidence: 0.82, reason: '用户要求查看模型配置。' }
  }
  if (/(创建|生成|新增|新建).*(目标)|目标.*(创建|生成|新增|新建)/u.test(content)) {
    const title = pickTextAfterCommand(content)
    if (title.length >= 2) {
      return {
        toolName: 'goal.create_draft',
        input: { title: trimForPrompt(title, 60), rawInput: content, interpretedGoal: title },
        confidence: 0.8,
        reason: '用户要求创建目标草稿。',
      }
    }
  }
  if (/(写入|写|记录).*(日志|记录)|记到日志|写个日志/u.test(content)) {
    const contentToWrite = pickTextAfterCommand(content)
    if (contentToWrite.length >= 2) {
      return { toolName: 'log.write_daily', input: { content: contentToWrite }, confidence: 0.8, reason: '用户要求写入日志。' }
    }
  }
  if (/(生成|写|做).*(复盘|周报|日报|月报|季报|年报)|复盘一下/u.test(content)) {
    const type = inferReviewType(content)
    return { toolName: 'review.generate', input: type ? { type } : {}, confidence: 0.8, reason: '用户要求生成复盘。' }
  }
  return null
}

function filterToolIntentByRuntimeSettings(intent, settings) {
  if (!intent?.toolName) return intent
  const goalReadTools = new Set(['goal.list', 'goal.get', 'today.get', 'review.generate'])
  if (!settings.canReadGoals && goalReadTools.has(intent.toolName)) return null
  return intent
}

export async function generateAgentToolIntentWithPrisma(prisma, options) {
  const {
    userId,
    latestUserContent,
    defaultAgentSettings = FALLBACK_AGENT_SETTINGS,
    defaultChatModel = FALLBACK_CHAT_MODEL,
  } = options
  const runtimeSettings = await loadSharedAgentRuntimeSettings(prisma, userId, defaultAgentSettings)
  const firstGoalTurn = await evaluateFirstGoalTurnWithPrisma(prisma, userId, latestUserContent)
  const fallbackIntent = firstGoalTurn?.kind === 'tool_intent'
    ? firstGoalTurn.toolIntent
    : generateFallbackAgentToolIntent(latestUserContent)
  const allowedFallbackIntent = filterToolIntentByRuntimeSettings(fallbackIntent, runtimeSettings)
  const modelConfig = await prisma.modelConfig.findFirst({ where: { userId, isDefault: true }, orderBy: { createdAt: 'asc' } })
  const apiKey = resolveModelApiKey(modelConfig)
  if (!apiKey) return allowedFallbackIntent
  const apiBase = String(modelConfig?.apiBase || defaultChatModel.apiBase).replace(/\/+$/, '')
  const modelName = String(modelConfig?.model || defaultChatModel.model)

  try {
    const response = await fetchModelProvider(chatCompletionsUrl(apiBase), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: modelName,
        temperature: 0,
        max_tokens: 500,
        messages: [
          {
            role: 'system',
            content: [
              '你是 Goal Mate 的工具路由器，只判断用户是否要求读取或改变目标系统。',
              '普通聊天、提问和讨论不选择工具；明确的进度反馈应进入 checkin.submit。',
              '首次没有目标时，用户用自然语言说清想达成的结果和时间或当前状态，应选择 goal.create_draft。',
              'goal.create_draft 要提供 title、rawInput、interpretedGoal，并尽量给出 KR、必要条件、阶段和今日最小行动。',
              '用户说“你看着合适的时候提醒我”或要求助手自主选择时机时，选择 reminder.schedule，input 使用 {"mode":"autonomous","enabled":true,"cadence":"balanced","source":"agent_conversation"}；这一步必须等待用户确认。',
              '用户说“暂停/别提醒/停止主动联系”时，选择 reminder.schedule，input 使用 {"mode":"pause","enabled":false,"reason":"user_requested_pause"}；停止动作应立即生效。',
              '输出必须是 JSON，不要输出 Markdown。',
              '',
              '{"toolName":null,"input":{},"confidence":0,"reason":"不需要工具"}',
              '',
              '可用工具：',
              JSON.stringify(sharedAgentToolCatalog),
            ].join('\n'),
          },
          { role: 'user', content: latestUserContent },
        ],
      }),
    })
    if (!response.ok) return allowedFallbackIntent
    const data = await response.json()
    const content = data?.choices?.[0]?.message?.content
    if (typeof content !== 'string') return allowedFallbackIntent
    const parsed = parseAgentToolIntentJson(content)
    if (!parsed) return allowedFallbackIntent
    const toolName = typeof parsed.toolName === 'string' ? parsed.toolName : null
    const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0
    const input = parsed.input && typeof parsed.input === 'object' ? parsed.input : {}
    const reason = typeof parsed.reason === 'string' ? parsed.reason : ''
    if (!toolName || confidence < 0.75) return allowedFallbackIntent
    if (!sharedAgentToolCatalog.some((tool) => tool.name === toolName)) return allowedFallbackIntent
    return filterToolIntentByRuntimeSettings({ toolName, input, confidence, reason }, runtimeSettings)
  } catch {
    return allowedFallbackIntent
  }
}
