import { prisma } from '@/lib/db'
import { defaultDeepSeekModel } from '@/server/api/context'
import { listAgentTools } from '@/lib/agent-tools'
import { parseAgentToolIntentJson } from '@/lib/agent-tool-shared.mjs'

function toChatRole(role: string) {
  const normalized = role.toLowerCase()
  if (normalized === 'assistant' || normalized === 'system' || normalized === 'user') return normalized
  return 'user'
}

export function trimForPrompt(value: string, max = 900) {
  return value.length > max ? `${value.slice(0, max)}...` : value
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

export async function generateAssistantReply(userId: string, threadId: string, latestUserContent: string) {
  const apiKey = process.env.DEEPSEEK_API_KEY
  const modelConfig = await prisma.modelConfig.findFirst({
    where: { userId, isDefault: true },
    orderBy: { createdAt: 'asc' },
  })
  const apiBase = String(modelConfig?.apiBase || defaultDeepSeekModel.apiBase).replace(/\/+$/, '')
  const modelName = String(modelConfig?.model || defaultDeepSeekModel.model)

  const [goal, history] = await Promise.all([
    prisma.goal.findFirst({
      where: { userId, isCurrentFocus: true },
      include: {
        keyResults: true,
        conditions: true,
        stagePlans: { orderBy: { sortOrder: 'asc' } },
        dailyActions: { orderBy: { actionDate: 'desc' }, take: 3 },
        reasoningCards: { orderBy: { version: 'desc' }, take: 1 },
      },
    }),
    prisma.agentMessage.findMany({ where: { userId, threadId }, orderBy: { createdAt: 'desc' }, take: 12 }),
  ])
  const markdownDocuments = await findRelevantMarkdownDocuments(userId, latestUserContent)

  const goalContext = goal
    ? [
        `当前目标：${goal.title}`,
        `解释：${goal.interpretedGoal || goal.rawInput}`,
        `KR：${goal.keyResults.map((kr) => `${kr.title}(${Math.round(kr.progress * 100)}%)`).join('；')}`,
        `条件：${goal.conditions.map((condition) => `${condition.title}[${condition.status}]`).join('；')}`,
        `今日行动：${goal.dailyActions[0]?.title || '暂无'}`,
        `当前推理重点：${goal.reasoningCards[0]?.recommendedFocus || '暂无'}`,
      ].join('\n')
    : '当前还没有主目标。'

  const markdownContext = markdownDocuments.length
    ? markdownDocuments.map((document) => `- ${document.path} [${document.type}]\n${trimForPrompt(document.content, 600)}`).join('\n\n')
    : '暂无 Markdown 文档。'

  const systemPrompt = [
    '你是 Goal Mate 的 AI 目标秘书。',
    '你的任务不是闲聊，而是帮助用户澄清目标、理解当前计划、调整下一步行动、整理日志和解释系统状态。',
    '回答必须具体、简洁、可行动。不要编造不存在的数据；如果需要用户补充信息，直接问一个最关键的问题。',
    '涉及修改目标、设置、外部发送消息等高风险动作时，只提出建议，不要声称已经执行。',
    '',
    '系统已知上下文：',
    goalContext,
    '',
    '相关 Markdown 文档：',
    markdownContext,
  ].join('\n')

  if (!apiKey) {
    return {
      content: '我已经保存了你的消息，但当前没有配置 DEEPSEEK_API_KEY，所以还不能调用真实模型。请先在 Settings 里完成模型配置。',
      modelName,
      ok: false,
    }
  }

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.reverse().map((message) => ({
      role: toChatRole(message.role),
      content: trimForPrompt(message.content, 1600),
    })),
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
      return {
        content: `模型调用失败，当前未改动任何计划。状态码：${response.status}。错误摘要：${trimForPrompt(text, 220)}`,
        modelName,
        ok: false,
      }
    }

    const data = await response.json()
    const content = data?.choices?.[0]?.message?.content
    return {
      content: typeof content === 'string' && content.trim()
        ? content.trim()
        : '模型返回为空。我已经保存你的消息，但这次没有得到可用回复。',
      modelName,
      ok: true,
    }
  } catch (error) {
    return {
      content: `模型连接失败，当前未改动任何计划。错误：${error instanceof Error ? error.message : String(error)}`,
      modelName,
      ok: false,
    }
  }
}

export async function generateAgentToolIntent(userId: string, latestUserContent: string) {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) return null

  const modelConfig = await prisma.modelConfig.findFirst({
    where: { userId, isDefault: true },
    orderBy: { createdAt: 'asc' },
  })
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
    if (!parsed) return null

    const toolName = typeof parsed.toolName === 'string' ? parsed.toolName : null
    const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0
    const input = parsed.input && typeof parsed.input === 'object' ? parsed.input : {}
    const reason = typeof parsed.reason === 'string' ? parsed.reason : ''
    if (!toolName || confidence < 0.75) return null
    if (!tools.some((tool) => tool.name === toolName)) return null

    return { toolName, input, confidence, reason }
  } catch {
    return null
  }
}
