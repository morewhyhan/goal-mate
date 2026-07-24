import { prisma } from '@/lib/db'
import { defaultChatModel, defaultUserSettings } from '@/server/api/context'
import { chatCompletionsUrl } from '@/lib/model-endpoint.mjs'
import { fetchModelProvider } from '@/lib/model-provider-http.mjs'
import { listAgentTools } from '@/lib/agent-tools'
import { parseAgentToolIntentJson } from '@/lib/agent-tool-shared.mjs'
import { AGENT_SYSTEM_PROMPT_VERSION, buildAgentSystemPrompt } from '@/lib/agent-prompts'
import { loadMetaCognitionHypotheses } from '@/lib/meta-cognition-layer.mjs'
import { resolveModelApiKey } from '@/lib/model-secret.mjs'
import { classifyModelProviderFailure, formatAgentModelFailureMessage, formatAgentModelNetworkFailureMessage, parseModelProviderError } from '@/lib/model-provider-errors'
import {
  generateAgentToolIntentWithPrisma,
  generateAssistantReplyWithPrisma,
} from '@/lib/agent-runtime-shared.mjs'

function toChatRole(role: string) {
  const normalized = role.toLowerCase()
  if (normalized === 'assistant' || normalized === 'system' || normalized === 'user') return normalized
  return 'user'
}

export function trimForPrompt(value: string, max = 900) {
  return value.length > max ? `${value.slice(0, max)}...` : value
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function compactLines(lines: Array<string | null | undefined>, empty = '暂无。') {
  const normalized = lines.map((line) => line?.trim()).filter(Boolean) as string[]
  return normalized.length ? normalized.join('\n') : empty
}

function formatDate(value: unknown) {
  if (!value) return '未定'
  const date = value instanceof Date ? value : new Date(String(value))
  if (Number.isNaN(date.getTime())) return '未定'
  return date.toISOString().slice(0, 10)
}

function formatDateRange(start: unknown, end: unknown) {
  return `${formatDate(start)} -> ${formatDate(end)}`
}

function formatProgress(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value * 100)}%` : '未记录'
}

function formatJsonItems(value: unknown, max = 4) {
  const items = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? [value]
      : []

  return items.map((item) => {
    if (typeof item === 'string') return item.trim()
    if (item && typeof item === 'object') return trimForPrompt(JSON.stringify(item), 120)
    return String(item || '').trim()
  }).filter(Boolean).slice(0, max)
}

function buildGoalPromptContext(goal: any) {
  if (!goal) return '当前还没有主目标。用户如果询问当前目标，只能说明系统尚未建立主目标，并追问他想达到的结果。'

  const reasoningCard = goal.reasoningCards?.[0]
  const successSignals = formatJsonItems(reasoningCard?.successSignals)
  const evidence = formatJsonItems(reasoningCard?.evidence, 3)

  const keyResults = compactLines((goal.keyResults || []).map((kr: any, index: number) => {
    return [
      `- KR${index + 1}: ${kr.title}`,
      `进度 ${formatProgress(kr.progress)}`,
      `${kr.currentValue || '当前值未记录'} -> ${kr.targetValue || '目标值未记录'}`,
      kr.status ? `状态 ${kr.status}` : '',
      kr.whyNecessary ? `必要性：${trimForPrompt(kr.whyNecessary, 180)}` : '',
    ].filter(Boolean).join('；')
  }))

  const conditions = compactLines((goal.conditions || []).map((condition: any, index: number) => {
    return [
      `- 条件${index + 1}: ${condition.title}`,
      `类型 ${condition.type}`,
      `状态 ${condition.status}`,
      `原因：${trimForPrompt(condition.whyRequired || '', 180)}`,
    ].filter(Boolean).join('；')
  }))

  const stagePlans = compactLines((goal.stagePlans || []).map((stage: any, index: number) => {
    const signals = formatJsonItems(stage.successSignals, 3)
    return [
      `- 阶段${index + 1}: ${stage.title}`,
      `时间 ${formatDateRange(stage.startDate, stage.endDate)}`,
      stage.status ? `状态 ${stage.status}` : '',
      `目标：${trimForPrompt(stage.stageGoal || '', 180)}`,
      signals.length ? `验收信号：${signals.join(' / ')}` : '',
    ].filter(Boolean).join('；')
  }))

  const dailyActions = compactLines((goal.dailyActions || []).map((action: any) => {
    return [
      `- ${formatDate(action.actionDate)} ${action.title}`,
      action.status ? `状态 ${action.status}` : '',
      action.doneWhen ? `完成标准：${trimForPrompt(action.doneWhen, 160)}` : '',
      action.minimumStep ? `最小动作：${trimForPrompt(action.minimumStep, 140)}` : '',
      action.fallbackAction ? `兜底：${trimForPrompt(action.fallbackAction, 140)}` : '',
      action.checkinQuestion ? `反馈问题：${trimForPrompt(action.checkinQuestion, 140)}` : '',
    ].filter(Boolean).join('；')
  }))

  const checkins = compactLines((goal.checkins || []).map((checkin: any) => {
    return [
      `- ${formatDate(checkin.createdAt)} ${checkin.result}`,
      checkin.reasonCategory ? `原因 ${checkin.reasonCategory}` : '',
      checkin.userFeedback ? `反馈：${trimForPrompt(checkin.userFeedback, 180)}` : '',
      checkin.adjustment ? `调整：${trimForPrompt(checkin.adjustment, 180)}` : '',
    ].filter(Boolean).join('；')
  }))

  const diagnoses = compactLines((goal.diagnoses || []).map((diagnosis: any) => {
    return [
      `- ${diagnosis.category}`,
      diagnosis.evidence ? `证据：${trimForPrompt(diagnosis.evidence, 160)}` : '',
      diagnosis.adjustmentType ? `调整类型 ${diagnosis.adjustmentType}` : '',
      diagnosis.nextQuestion ? `下个问题：${trimForPrompt(diagnosis.nextQuestion, 160)}` : '',
      diagnosis.proposedNextAction ? `建议动作：${trimForPrompt(diagnosis.proposedNextAction, 160)}` : '',
    ].filter(Boolean).join('；')
  }))

  const reviews = compactLines((goal.reviews || []).map((review: any) => {
    return [
      `- ${review.type} ${formatDateRange(review.periodStart, review.periodEnd)}`,
      review.progressSummary ? `进展：${trimForPrompt(review.progressSummary, 180)}` : '',
      review.blockerSummary ? `阻塞：${trimForPrompt(review.blockerSummary, 160)}` : '',
      review.nextFocus ? `下周期重点：${trimForPrompt(review.nextFocus, 160)}` : '',
    ].filter(Boolean).join('；')
  }))

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

function buildMarkdownPromptContext(markdownDocuments: any[]) {
  if (!markdownDocuments.length) return '暂无 Markdown 文档。'
  return markdownDocuments.map((document) => {
    return [
      `- ${document.path} [${document.type}] ${document.title ? `《${document.title}》` : ''}`,
      `更新时间：${formatDate(document.updatedAt)}`,
      trimForPrompt(document.content || '', 900),
    ].join('\n')
  }).join('\n\n')
}

function buildMemoryPromptContext(goal: any, history: any[]) {
  const threadMessages = history.slice(-8).map((message: any) => {
    return `- ${message.role}: ${trimForPrompt(message.content || '', 220)}`
  })

  return [
    goal
      ? [
          `最近复盘重点：${(goal.reviews || []).map((review: any) => review.nextFocus).filter(Boolean).slice(0, 3).join('；') || '暂无'}`,
          `最近诊断问题：${(goal.diagnoses || []).map((diagnosis: any) => diagnosis.nextQuestion).filter(Boolean).slice(0, 3).join('；') || '暂无'}`,
        ].join('\n')
      : '',
    `已加载最近对话：${threadMessages.length} 条`,
    `最近对话片段：\n${compactLines(threadMessages)}`,
  ].filter(Boolean).join('\n')
}

function buildCapabilityPromptContext(settings: { canReadGoals: boolean; canReadLogs: boolean; memoryEnabled: boolean }) {
  const tools = listAgentTools()
  return [
    `读取权限：Goals=${settings.canReadGoals ? 'ON' : 'OFF'}；Logs=${settings.canReadLogs ? 'ON' : 'OFF'}；Memory=${settings.memoryEnabled ? 'ON' : 'OFF'}`,
    '可用系统动作：',
    ...tools.map((tool) => `- ${tool.name}: ${tool.description}；权限=${tool.permission}；风险=${tool.riskLevel}`),
    '执行原则：读操作可以直接回答；修改目标、设置、外部提醒等动作必须按工具确认规则执行。',
  ].join('\n')
}

function readBooleanSetting(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback
}

async function loadAgentRuntimeSettings(userId: string) {
  const settings = await prisma.userSetting.findUnique({ where: { userId } })
  const agentSettings = { ...defaultUserSettings.agent, ...asRecord(settings?.agent) }
  return {
    canReadGoals: readBooleanSetting(agentSettings.can_read_goals, defaultUserSettings.agent.can_read_goals),
    canReadLogs: readBooleanSetting(agentSettings.can_read_logs, defaultUserSettings.agent.can_read_logs),
    memoryEnabled: readBooleanSetting(agentSettings.memory_enabled, defaultUserSettings.agent.memory_enabled),
  }
}

function extractSearchTerms(input: string) {
  const rawTerms = input.match(/[A-Za-z0-9_-]{2,}|[\u4e00-\u9fff]{2,}/g) || []
  const terms = new Set<string>()
  for (const term of rawTerms) {
    if (/^[\u4e00-\u9fff]+$/.test(term) && term.length > 4) {
      for (let index = 0; index < term.length - 1; index += 2) {
        terms.add(term.slice(index, index + 2))
      }
    } else {
      terms.add(term)
    }
  }
  return [...terms].slice(0, 8)
}

async function findRelevantMarkdownDocuments(userId: string, input: string) {
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

  return prisma.markdownDocument.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    take: 8,
  })
}

function pickTextAfterCommand(content: string) {
  const normalized = content.trim()
  const separatorMatch = normalized.match(/[：:]\s*(.+)$/)
  if (separatorMatch?.[1]?.trim()) return separatorMatch[1].trim()
  return normalized
    .replace(/^(请|帮我|麻烦)?(查看|列出|创建|生成|新增|新建|写入|写|记录|更新|设置|安排)(一下|一个|一条)?/u, '')
    .replace(/^(目标|日志|记录|复盘|周报|日报|月报|季报|年报)/u, '')
    .trim()
}

function inferReviewType(content: string) {
  if (/年报|年度|yearly|year/i.test(content)) return 'yearly'
  if (/季报|季度|quarterly|quarter/i.test(content)) return 'quarterly'
  if (/月报|月度|monthly|month/i.test(content)) return 'monthly'
  if (/周报|周复盘|weekly|week/i.test(content)) return 'weekly'
  if (/日报|日复盘|daily|day/i.test(content)) return 'daily'
  if (/目标周期|goal_cycle/i.test(content)) return 'goal_cycle'
  return undefined
}

function buildMetaCognitionPromptContext(hypotheses: any[]) {
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

function generateFallbackAgentToolIntent(latestUserContent: string) {
  const content = latestUserContent.trim()
  if (!content) return null

  const feedbackIntent = inferCheckinFeedbackIntent(content)
  if (feedbackIntent) return feedbackIntent

  if (/(查看|列出|有哪些|当前).*(目标)|目标.*(列表|有哪些)/u.test(content)) {
    return { toolName: 'goal.list', input: {}, confidence: 0.82, reason: '本地兜底：用户明确要求查看目标。' }
  }

  if (/(查看|当前|今天|下一步).*(行动|任务|要做什么)|今天.*(做什么|下一步)/u.test(content)) {
    return { toolName: 'today.get', input: {}, confidence: 0.82, reason: '本地兜底：用户明确要求查看今日行动。' }
  }

  if (/(当前|查看|读取).*(模型|model)|模型.*(配置|是什么)/iu.test(content)) {
    return { toolName: 'settings.model.get', input: {}, confidence: 0.82, reason: '本地兜底：用户明确要求查看模型配置。' }
  }

  if (/(创建|生成|新增|新建).*(目标)|目标.*(创建|生成|新增|新建)/u.test(content)) {
    const title = pickTextAfterCommand(content)
    if (title.length >= 2) {
      return {
        toolName: 'goal.create_draft',
        input: {
          title: trimForPrompt(title, 60),
          rawInput: content,
          interpretedGoal: title,
        },
        confidence: 0.8,
        reason: '本地兜底：用户明确要求创建目标草稿。',
      }
    }
  }

  if (/(写入|写|记录).*(日志|记录)|记到日志|写个日志/u.test(content)) {
    const contentToWrite = pickTextAfterCommand(content)
    if (contentToWrite.length >= 2) {
      return {
        toolName: 'log.write_daily',
        input: {
          content: contentToWrite,
        },
        confidence: 0.8,
        reason: '本地兜底：用户明确要求写入日志。',
      }
    }
  }

  if (/(生成|写|做).*(复盘|周报|日报|月报|季报|年报)|复盘一下/u.test(content)) {
    const reviewType = inferReviewType(content)
    return {
      toolName: 'review.generate',
      input: reviewType ? { type: reviewType } : {},
      confidence: 0.8,
      reason: '本地兜底：用户明确要求生成复盘。',
    }
  }

  return null
}

function inferCheckinFeedbackIntent(content: string) {
  if (/(假如|如果|要是).*(没做|未完成|没推进|做不动|不想做|不想开始|不想碰)/u.test(content)) return null

  const feedbackInput = {
    userFeedback: trimForPrompt(content, 240),
  }

  if (/(完成了|做完了|已经完成|已完成|done)/iu.test(content)) {
    return {
      toolName: 'checkin.submit',
      input: { ...feedbackInput, result: 'done' },
      confidence: 0.84,
      reason: '本地兜底：用户明确反馈今日行动已完成，进入 Check-in 闭环。',
    }
  }

  if (/(部分完成|做了一点|做了点|只做了|完成一部分|partial)/iu.test(content)) {
    return {
      toolName: 'checkin.submit',
      input: { ...feedbackInput, result: 'partial' },
      confidence: 0.84,
      reason: '本地兜底：用户明确反馈今日行动部分完成，进入诊断闭环。',
    }
  }

  if (/(没做|没有做|未完成|没完成|没推进|没开始|做不动|不想做|不想开始|不想碰|提不起劲|失败了|not[_ -]?done)/iu.test(content)) {
    return {
      toolName: 'checkin.submit',
      input: { ...feedbackInput, result: 'not_done' },
      confidence: 0.84,
      reason: '本地兜底：用户明确反馈今日行动未完成，进入诊断闭环。',
    }
  }

  return null
}

function filterToolIntentByRuntimeSettings(intent: any, settings: { canReadGoals: boolean; canReadLogs: boolean }) {
  if (!intent?.toolName) return intent
  const goalReadTools = new Set(['goal.list', 'goal.get', 'today.get', 'review.generate'])
  if (!settings.canReadGoals && goalReadTools.has(intent.toolName)) return null
  return intent
}

function buildAgentReplyStructuredOutput(input: {
  naturalReply: string
  modelName: string
  ok: boolean
  runtimeSettings: { canReadGoals: boolean; canReadLogs: boolean; memoryEnabled: boolean }
  error?: string
  usage?: unknown
}) {
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

async function generateAssistantReplyLegacy(userId: string, threadId: string, latestUserContent: string) {
  const [modelConfig, runtimeSettings] = await Promise.all([
    prisma.modelConfig.findFirst({
      where: { userId, isDefault: true },
      orderBy: { createdAt: 'asc' },
    }),
    loadAgentRuntimeSettings(userId),
  ])
  const apiKey = resolveModelApiKey(modelConfig)
  const apiBase = String(modelConfig?.apiBase || defaultChatModel.apiBase).replace(/\/+$/, '')
  const modelName = String(modelConfig?.model || defaultChatModel.model)

  const thread = runtimeSettings.canReadGoals
    ? await prisma.agentThread.findFirst({ where: { id: threadId, userId }, select: { goalId: true } })
    : null
  const goalWhere = thread?.goalId ? { userId, id: thread.goalId } : { userId, isCurrentFocus: true }

  const [goal, history] = await Promise.all([
    runtimeSettings.canReadGoals ? prisma.goal.findFirst({
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
    }) : Promise.resolve(null),
    runtimeSettings.memoryEnabled ? prisma.agentMessage.findMany({ where: { userId, threadId }, orderBy: { createdAt: 'desc' }, take: 12 }) : Promise.resolve([]),
  ])
  const markdownDocuments = runtimeSettings.canReadLogs ? await findRelevantMarkdownDocuments(userId, latestUserContent) : []
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
    : buildMemoryPromptContext(goal, history)
  const metaCognitionContext = runtimeSettings.memoryEnabled
    ? buildMetaCognitionPromptContext(metaCognitionHypotheses)
    : 'Settings 已关闭 Agent 对话记忆。不要引用元认知判断。'
  const capabilityContext = buildCapabilityPromptContext(runtimeSettings)

  const systemPrompt = buildAgentSystemPrompt({
    goalContext,
    memoryContext,
    metaCognitionContext,
    capabilityContext,
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

  const messages = [
    { role: 'system', content: systemPrompt },
    ...conversationMessages,
  ]

  try {
    const response = await fetchModelProvider(chatCompletionsUrl(apiBase), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: modelName,
        messages,
        temperature: modelConfig?.temperature ?? defaultChatModel.temperature,
        max_tokens: 1200,
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      const rawMessage = parseModelProviderError(text)
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

export async function generateAssistantReply(userId: string, threadId: string, latestUserContent: string) {
  return generateAssistantReplyWithPrisma(prisma, {
    userId,
    threadId,
    latestUserContent,
    defaultAgentSettings: defaultUserSettings.agent,
    defaultChatModel,
    channel: 'web',
  })
}

async function generateAgentToolIntentLegacy(userId: string, latestUserContent: string) {
  const fallbackIntent = generateFallbackAgentToolIntent(latestUserContent)
  const runtimeSettings = await loadAgentRuntimeSettings(userId)
  const allowedFallbackIntent = filterToolIntentByRuntimeSettings(fallbackIntent, runtimeSettings)

  const modelConfig = await prisma.modelConfig.findFirst({
    where: { userId, isDefault: true },
    orderBy: { createdAt: 'asc' },
  })
  const apiKey = resolveModelApiKey(modelConfig)
  if (!apiKey) return allowedFallbackIntent
  const apiBase = String(modelConfig?.apiBase || defaultChatModel.apiBase).replace(/\/+$/, '')
  const modelName = String(modelConfig?.model || defaultChatModel.model)
  const tools = listAgentTools()

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
              '你是 Goal Mate 的工具路由器，只判断用户是否明确要求操作系统。',
              '如果用户只是聊天、提问、讨论、解释概念，不要选择工具。',
              '只有用户明确要求查看、创建、更新、提交、写入、生成、设置时才选择工具。',
              '首次没有目标时，如果用户用自然语言说清楚了想达到的结果、时间边界或当前状态，并且足够具体，应选择 goal.create_draft；不要要求用户填复杂表单。',
              'goal.create_draft 的 input 至少给出 title、rawInput、interpretedGoal；能判断时继续给出 keyResults、necessaryConditions、stagePlans、dailyAction。',
              'dailyAction 必须是今天能反馈的一步，包含 title、doneWhen、minimumStep、fallbackAction；不要套用固定行业模板。',
              '输出必须是 JSON，不要输出 Markdown。',
              '',
              'JSON 格式：',
              '{"toolName":null,"input":{},"confidence":0,"reason":"不需要工具"}',
              '{"toolName":"goal.list","input":{},"confidence":0.95,"reason":"用户要求查看目标"}',
              '',
              '可用工具：',
              JSON.stringify(tools),
            ].join('\n'),
          },
          { role: 'user', content: latestUserContent },
        ],
      }),
    })
    if (!response.ok) return null
    const data = await response.json()
    const content = data?.choices?.[0]?.message?.content
    if (typeof content !== 'string') return null
    const parsed = parseAgentToolIntentJson(content)
    if (!parsed) return allowedFallbackIntent

    const toolName = typeof parsed.toolName === 'string' ? parsed.toolName : null
    const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0
    const input = parsed.input && typeof parsed.input === 'object' ? parsed.input : {}
    const reason = typeof parsed.reason === 'string' ? parsed.reason : ''
    if (!toolName || confidence < 0.75) return allowedFallbackIntent
    if (!tools.some((tool) => tool.name === toolName)) return allowedFallbackIntent

    return filterToolIntentByRuntimeSettings({ toolName, input, confidence, reason }, runtimeSettings)
  } catch {
    return allowedFallbackIntent
  }
}

export async function generateAgentToolIntent(userId: string, latestUserContent: string) {
  return generateAgentToolIntentWithPrisma(prisma, {
    userId,
    latestUserContent,
    defaultAgentSettings: defaultUserSettings.agent,
    defaultChatModel,
  })
}
