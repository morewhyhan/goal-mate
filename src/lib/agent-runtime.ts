import { prisma } from '@/lib/db'
import { defaultDeepSeekModel, defaultUserSettings } from '@/server/api/context'
import { listAgentTools } from '@/lib/agent-tools'
import { parseAgentToolIntentJson } from '@/lib/agent-tool-shared.mjs'
import { AGENT_SYSTEM_PROMPT_VERSION, buildAgentSystemPrompt } from '@/lib/agent-prompts'
import { loadMetaCognitionHypotheses } from '@/lib/meta-cognition-layer.mjs'
import { resolveModelApiKey } from '@/lib/model-secret.mjs'

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
  if (/(假如|如果|要是).*(没做|未完成|没推进|做不动)/u.test(content)) return null

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

  if (/(没做|没有做|未完成|没完成|没推进|没开始|做不动|失败了|not[_ -]?done)/iu.test(content)) {
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

export async function generateAssistantReply(userId: string, threadId: string, latestUserContent: string) {
  const [modelConfig, runtimeSettings] = await Promise.all([
    prisma.modelConfig.findFirst({
      where: { userId, isDefault: true },
      orderBy: { createdAt: 'asc' },
    }),
    loadAgentRuntimeSettings(userId),
  ])
  const apiKey = resolveModelApiKey(modelConfig)
  const apiBase = String(modelConfig?.apiBase || defaultDeepSeekModel.apiBase).replace(/\/+$/, '')
  const modelName = String(modelConfig?.model || defaultDeepSeekModel.model)

  const [goal, history] = await Promise.all([
    runtimeSettings.canReadGoals ? prisma.goal.findFirst({
      where: { userId, isCurrentFocus: true },
      include: {
        keyResults: true,
        conditions: true,
        stagePlans: { orderBy: { sortOrder: 'asc' } },
        dailyActions: { orderBy: { actionDate: 'desc' }, take: 3 },
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
    : goal
    ? [
        `当前目标：${goal.title}`,
        `解释：${goal.interpretedGoal || goal.rawInput}`,
        `KR：${goal.keyResults.map((kr) => `${kr.title}(${Math.round(kr.progress * 100)}%)`).join('；')}`,
        `条件：${goal.conditions.map((condition) => `${condition.title}[${condition.status}]`).join('；')}`,
        `今日行动：${goal.dailyActions[0]?.title || '暂无'}`,
        `当前推理重点：${goal.reasoningCards[0]?.recommendedFocus || '暂无'}`,
      ].join('\n')
    : '当前还没有主目标。'

  const markdownContext = !runtimeSettings.canReadLogs
    ? 'Settings 已关闭 Agent 读取 Logs。不要引用 Markdown 日志内容；如果用户需要日志信息，请先说明需要开启 Logs 读取。'
    : markdownDocuments.length
    ? markdownDocuments.map((document) => `- ${document.path} [${document.type}]\n${trimForPrompt(document.content, 600)}`).join('\n\n')
    : '暂无 Markdown 文档。'

  const memoryContext = !runtimeSettings.memoryEnabled
    ? 'Settings 已关闭 Agent 对话记忆。不要引用历史对话。'
    : goal
    ? [
        `最近复盘：${goal.reviews.map((review) => `${review.type}:${review.nextFocus}`).join('；') || '暂无'}`,
        `最近诊断：${goal.diagnoses.map((diagnosis) => `${diagnosis.category}:${diagnosis.nextQuestion}`).join('；') || '暂无'}`,
        `已加载最近对话：${history.length} 条。`,
      ].join('\n')
    : `已加载最近对话：${history.length} 条。`
  const metaCognitionContext = runtimeSettings.memoryEnabled
    ? buildMetaCognitionPromptContext(metaCognitionHypotheses)
    : 'Settings 已关闭 Agent 对话记忆。不要引用元认知判断。'

  const systemPrompt = buildAgentSystemPrompt({
    goalContext,
    memoryContext,
    metaCognitionContext,
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
    const response = await fetch(`${apiBase}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: modelName,
        messages,
        temperature: modelConfig?.temperature ?? defaultDeepSeekModel.temperature,
        max_tokens: 900,
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      const content = `模型调用失败，当前未改动任何计划。状态码：${response.status}。错误摘要：${trimForPrompt(text, 220)}`
      return {
        content,
        modelName,
        ok: false,
        structuredOutput: buildAgentReplyStructuredOutput({
          naturalReply: content,
          modelName,
          ok: false,
          runtimeSettings,
          error: `http_${response.status}`,
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
    const content = `模型连接失败，当前未改动任何计划。错误：${error instanceof Error ? error.message : String(error)}`
    return {
      content,
      modelName,
      ok: false,
      structuredOutput: buildAgentReplyStructuredOutput({
        naturalReply: content,
        modelName,
        ok: false,
        runtimeSettings,
        error: error instanceof Error ? error.message : String(error),
      }),
    }
  }
}

export async function generateAgentToolIntent(userId: string, latestUserContent: string) {
  const fallbackIntent = generateFallbackAgentToolIntent(latestUserContent)
  const runtimeSettings = await loadAgentRuntimeSettings(userId)
  const allowedFallbackIntent = filterToolIntentByRuntimeSettings(fallbackIntent, runtimeSettings)

  const modelConfig = await prisma.modelConfig.findFirst({
    where: { userId, isDefault: true },
    orderBy: { createdAt: 'asc' },
  })
  const apiKey = resolveModelApiKey(modelConfig)
  if (!apiKey) return allowedFallbackIntent
  const apiBase = String(modelConfig?.apiBase || defaultDeepSeekModel.apiBase).replace(/\/+$/, '')
  const modelName = String(modelConfig?.model || defaultDeepSeekModel.model)
  const tools = listAgentTools()

  try {
    const response = await fetch(`${apiBase}/chat/completions`, {
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
