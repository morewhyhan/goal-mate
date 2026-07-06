import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PrismaClient } from '@prisma/client'
import { executeAgentToolWithPrisma, recordAgentToolActionWithPrisma } from '../lib/agent-tool-executor.mjs'
import { chatCompletionsUrl } from '../lib/model-endpoint.mjs'
import { fetchModelProvider } from '../lib/model-provider-http.mjs'
import { classifyQqSchedulerReply } from '../lib/qq-scheduler-reply.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(scriptDir, '..')
const projectRoot = resolve(appRoot, '..')

function loadLocalEnv() {
  const envPath = resolve(appRoot, '.env')
  let text = ''
  try {
    text = readFileSync(envPath, 'utf8')
  } catch {
    return
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!match || process.env[match[1]]) continue
    let value = match[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    process.env[match[1]] = value
  }
}

loadLocalEnv()

const prisma = new PrismaClient()
const shouldWrite = process.argv.includes('--write')
const keepData = process.argv.includes('--keep-data')
const turnsArg = process.argv.find((arg) => arg.startsWith('--turns='))
const turnCount = Math.max(3, Math.min(21, Number(turnsArg?.split('=')[1] || '14') || 14))
const runId = Date.now()
const email = process.env.GOAL_MATE_DYNAMIC_QQ_EMAIL || `dynamic-deepseek-qq-${runId}@goalmate.local`
const apiKey = process.env.DEEPSEEK_API_KEY || process.env.GOAL_MATE_LIVE_MODEL_API_KEY || ''
const apiBase = String(process.env.DEEPSEEK_API_BASE || process.env.GOAL_MATE_LIVE_MODEL_API_BASE || 'https://api.deepseek.com').replace(/\/+$/, '')
const modelName = process.env.DEEPSEEK_MODEL || process.env.GOAL_MATE_LIVE_MODEL_MODEL || 'deepseek-chat'
const baseDate = new Date(2026, 6, 6, 8, 0, 0)
const results = []
const turnRecords = []
const DAY_MS = 24 * 60 * 60 * 1000

function record(id, purpose, ok, evidence = '') {
  results.push({ id, purpose, ok, evidence })
}

function maskEmail(value) {
  return String(value || '').replace(/^(.{3}).+@/, '$1...@')
}

function compact(value, max = 360) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max)}...` : text
}

function addDays(date, days) {
  return new Date(date.getTime() + days * DAY_MS)
}

function countQuestions(text) {
  return (String(text || '').match(/[？?]/g) || []).length
}

function countSentences(text) {
  return String(text || '').split(/[。！？!?\n]+/u).map((item) => item.trim()).filter(Boolean).length
}

function auditSecretaryReply(text) {
  const reply = String(text || '').trim()
  const issues = []
  if (!reply) issues.push('empty')
  if (reply.length > 220) issues.push('too_long')
  if (countSentences(reply) > 4) issues.push('too_many_sentences')
  if (countQuestions(reply) > 1) issues.push('too_many_questions')
  if (/好的[，,]?我来|作为.*AI|以下是|总之|综上|希望.*帮助/u.test(reply)) issues.push('ai_tone')
  if (/加油|坚持|你可以的|不要放弃|严格执行|自律太差|又失败|一个字都不能少|不回.*当.*放弃|别只说/u.test(reply)) issues.push('generic_or_coercive')
  if (/截图|图片|照片|上传|发.*文件/u.test(reply)) issues.push('non_text_request')
  if (/报个到|在吗/u.test(reply)) issues.push('low_value_ping')
  if (!/(先|只|今天|明天|下一次|现在|暂停|继续|回复|回|告诉|选择|选|回答|做到|找|写|看|喝|伸展|发|确认|分钟|暂停|缩|降|证据|风险|缺口|路径|提醒|复盘|目标|动作|保留)/u.test(reply)) {
    issues.push('not_operational')
  }
  return { ok: issues.length === 0, issues, questions: countQuestions(reply), sentences: countSentences(reply) }
}

function extractJson(text) {
  const raw = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  try {
    return JSON.parse(raw)
  } catch {}
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(raw.slice(start, end + 1))
    } catch {}
  }
  return null
}

function readJsonStringField(text, key) {
  const match = String(text || '').match(new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, 's'))
  if (!match) return ''
  try {
    return JSON.parse(`"${match[1]}"`)
  } catch {
    return match[1].replace(/\\"/g, '"')
  }
}

async function callDeepSeek(messages, options = {}) {
  const retries = Math.max(1, Number(options.retries || 3))
  let lastError = 'deepseek_empty_reply'
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const response = await fetchModelProvider(chatCompletionsUrl(apiBase), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: modelName,
        temperature: options.temperature ?? 0.25,
        max_tokens: options.maxTokens ?? 900,
        messages,
      }),
    })
    const text = await response.text()
    if (!response.ok) {
      throw new Error(`deepseek_http_${response.status}:${compact(text, 220)}`)
    }
    let data = null
    try {
      data = JSON.parse(text)
    } catch {
      throw new Error(`deepseek_invalid_json:${compact(text, 220)}`)
    }
    const reply = data?.choices?.[0]?.message?.content
    if (reply && typeof reply === 'string' && reply.trim()) return reply.trim()
    lastError = `deepseek_empty_reply_attempt_${attempt}`
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 300 * attempt))
  }
  throw new Error(lastError)
}

async function preflightDeepSeek() {
  if (!apiKey.trim()) return { ok: false, message: 'missing DEEPSEEK_API_KEY' }
  try {
    const reply = await callDeepSeek([
      { role: 'system', content: '你是 Goal Mate 的目标秘书。只回一句短句。' },
      { role: 'user', content: '回复：DeepSeek 动态 QQ 试运行可以开始。' },
    ], { maxTokens: 180 })
    return { ok: Boolean(reply.trim()), message: compact(reply, 160) }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

async function cleanupUser() {
  await prisma.user.deleteMany({ where: { email } })
}

async function seedWorkspace() {
  await cleanupUser()
  const user = await prisma.user.create({
    data: { email, name: 'Dynamic DeepSeek QQ Trial User', emailVerified: true },
  })
  await prisma.userSetting.create({
    data: {
      userId: user.id,
      general: { timezone: 'Asia/Shanghai' },
      goals: { review_cadence: 'weekly' },
      logs: { auto_write_checkin: true, auto_write_review: true, vault_root: 'logs' },
      today: { heatmap_scope: 'year', low_energy_mode: true },
      agent: {
        can_read_goals: true,
        can_read_logs: true,
        memory_enabled: true,
        require_confirm_goal_changes: false,
        require_confirm_setting_changes: false,
        require_confirm_external_actions: true,
      },
      notifications: { morning: '08:30', midday: '12:30', evening: '21:30' },
      dataPrivacy: { export_markdown: true },
    },
  })
  await prisma.qqChatBinding.create({
    data: {
      userId: user.id,
      contextType: 'c2c',
      contextId: `dynamic-deepseek-qq-openid-${runId}`,
      nickname: 'Dynamic QQ User Simulator',
      status: 'ENABLED',
    },
  })
  const goal = await prisma.goal.create({
    data: {
      userId: user.id,
      title: '让强惰性用户两周内持续推进目标',
      rawInput: '我想减脂、学英语、推进 Goal Mate 项目，但我很懒，经常敷衍、不回复、嫌烦。',
      interpretedGoal: '通过 QQ 短对话、低阻力动作、风险前置和复盘，让用户每天留下一个可验证推进或阻力证据。',
      status: 'ACTIVE',
      isCurrentFocus: true,
      horizonStart: baseDate,
      horizonEnd: addDays(baseDate, turnCount - 1),
    },
  })
  const conditions = await Promise.all([
    prisma.goalCondition.create({
      data: { userId: user.id, goalId: goal.id, title: '行动足够小，用户愿意开始', type: 'HARD', status: 'PARTIAL', whyRequired: '强惰性用户不能靠大计划推进。' },
    }),
    prisma.goalCondition.create({
      data: { userId: user.id, goalId: goal.id, title: '提醒在风险点前出现', type: 'HARD', status: 'MISSING', whyRequired: '风险点后复盘无法阻止失控。' },
    }),
    prisma.goalCondition.create({
      data: { userId: user.id, goalId: goal.id, title: '路径动作补齐关键缺口', type: 'HARD', status: 'MISSING', whyRequired: '做了但不改变系统状态没有意义。' },
    }),
  ])
  await Promise.all([
    prisma.keyResult.create({
      data: { userId: user.id, goalId: goal.id, title: '14 轮 QQ 对话中至少 10 轮产生 Check-in', metricType: 'COUNT', currentValue: '0', targetValue: '10', progress: 0, whyNecessary: '没有 Check-in 就不能证明反馈闭环。' },
    }),
    prisma.keyResult.create({
      data: { userId: user.id, goalId: goal.id, title: '后半程动作明显变小且目标不缩水', metricType: 'BOOLEAN', currentValue: 'false', targetValue: 'true', progress: 0, whyNecessary: '长期推进应该调参，不是硬催。' },
    }),
  ])
  const stage = await prisma.stagePlan.create({
    data: {
      userId: user.id,
      goalId: goal.id,
      title: '动态 DeepSeek QQ 压缩试运行',
      stageGoal: '验证真实 DeepSeek 能否在 QQ 短对话中动态推动强惰性用户。',
      startDate: baseDate,
      endDate: addDays(baseDate, turnCount - 1),
      linkedConditionIds: conditions.map((item) => item.id),
      successSignals: ['回复更愿意', '动作变小', '风险点被提前控制', '路径更清楚'],
      status: 'ACTIVE',
      sortOrder: 1,
    },
  })
  const thread = await prisma.agentThread.create({
    data: { userId: user.id, goalId: goal.id, title: '动态 DeepSeek QQ 对话试运行' },
  })
  const rules = await Promise.all([
    prisma.reminderRule.create({
      data: { userId: user.id, goalId: goal.id, reminderType: 'midday_check', channel: 'qq', schedule: '12:30', timezone: 'Asia/Shanghai', maxPerDay: 2, enabled: true, metadata: { verification: 'dynamic_deepseek_qq_trial' } },
    }),
    prisma.reminderRule.create({
      data: { userId: user.id, goalId: goal.id, reminderType: 'evening_review', channel: 'qq', schedule: '21:30', timezone: 'Asia/Shanghai', maxPerDay: 2, enabled: true, metadata: { verification: 'dynamic_deepseek_qq_trial' } },
    }),
  ])
  return { user, goal, conditions, stage, thread, rules }
}

function stateSummary(turns) {
  const recent = turns.slice(-5).map((item) => {
    return `T${item.turn}: user=${compact(item.userMessage, 80)} result=${item.classified?.result || 'n/a'} reason=${item.classified?.reasonCategory || 'n/a'}`
  }).join('\n')
  const misses = turns.filter((item) => ['NOT_DONE', 'NO_RESPONSE'].includes(item.classified?.result)).length
  const partials = turns.filter((item) => item.classified?.result === 'PARTIAL').length
  const done = turns.filter((item) => item.classified?.result === 'DONE').length
  return [
    `历史轮数：${turns.length}`,
    `完成/部分/未完成：${done}/${partials}/${misses}`,
    recent ? `最近反馈：\n${recent}` : '最近反馈：无',
  ].join('\n')
}

async function askAgentForIntervention(context, turn, date) {
  const system = [
    '你是 Goal Mate 的 AI 目标秘书，通过 QQ 给强惰性用户发短消息。',
    '你不是客服，也不是知识问答。不要“好的，我来帮你”。不要鸡汤、羞辱、长篇计划。',
    '用户很懒，会敷衍、转移话题、不回复、反感提醒、说完成但证据不足。',
    '你每次只推动一个最小动作或一个关键判断。能暂停、降级、重审目标，但不能偷偷缩水最终目标。',
    'message 字段必须是直接发给 QQ 用户的原文，70 个中文以内，不得包含 JSON 字段名。',
    '不要用“不回我就当你放弃了”这类威胁式表达。',
    '不要要求截图、图片、照片、文件或外部上传；只能要求用户回一句文本。',
    '不要说“一个字都不能少”“别只说”这类强迫式表达。',
    '不要发送“在吗”“报个到”这类低价值 ping；每条都要连接目标、动作、证据或暂停判断。',
    '输出严格 JSON，不要 Markdown。',
    'JSON 字段：message, intervention_type, risk_point, fallback_action, verification_signal, next_action。',
    'next_action 字段：title, done_when, minimum_step, estimated_minutes, condition_index。',
  ].join('\n')
  const userPrompt = [
    `今天是压缩试运行第 ${turn} 轮，日期 ${date.toISOString().slice(0, 10)}。`,
    `目标：${context.goal.title}`,
    '候选条件：0=行动足够小；1=提醒在风险点前出现；2=路径动作补齐关键缺口。',
    stateSummary(turnRecords),
    '请基于真实历史动态决定这一次 QQ 应该怎么说，不要套固定剧本。',
  ].join('\n\n')
  const raw = await callDeepSeek([
    { role: 'system', content: system },
    { role: 'user', content: userPrompt },
  ], { temperature: 0.35, maxTokens: 1100 })
  const parsed = extractJson(raw) || {}
  const action = parsed.next_action && typeof parsed.next_action === 'object' ? parsed.next_action : {}
  const message = parsed.message || readJsonStringField(raw, 'message') || raw
  const rawMinutes = Math.max(1, Math.min(45, Number(action.estimated_minutes || (turn <= 2 ? 20 : 10)) || 10))
  const recentHighFriction = turnRecords.slice(-3).filter((item) => ['NOT_DONE', 'NO_RESPONSE'].includes(item.classified?.result)).length
  const maxAllowedMinutes = recentHighFriction >= 2 ? 1 : turn > Math.ceil(turnCount / 2) ? 3 : 45
  const intervention = {
    raw,
    message: compact(message, 180),
    intervention_type: String(parsed.intervention_type || 'nudge'),
    risk_point: String(parsed.risk_point || '用户可能因为启动成本或路径不清而不行动。'),
    fallback_action: String(parsed.fallback_action || action.minimum_step || '只回复一个真实状态。'),
    verification_signal: String(parsed.verification_signal || '看用户下一轮是否愿意回复并留下行动证据。'),
    next_action: {
      title: compact(action.title || '只完成一个最小动作', 120),
      done_when: compact(action.done_when || '用户回复一个可验证事实。', 180),
      minimum_step: compact(action.minimum_step || '只回复做了、没做或卡住。', 120),
      estimated_minutes: Math.min(rawMinutes, maxAllowedMinutes),
      condition_index: Math.max(0, Math.min(2, Number(action.condition_index || 0) || 0)),
    },
  }
  return repairInterventionIfNeeded(intervention)
}

async function repairInterventionIfNeeded(intervention) {
  const combined = [
    intervention.message,
    intervention.next_action.title,
    intervention.next_action.done_when,
    intervention.next_action.minimum_step,
    intervention.fallback_action,
  ].join('\n')
  if (!/(截图|图片|照片|上传|发.*文件|压缩.*文件|压缩.*图片|手机相册)/u.test(combined)) return intervention
  const raw = await callDeepSeek([
    {
      role: 'system',
      content: [
        '你是 Goal Mate 的 QQ 文本通道质量门禁。',
        '上一条干预要求了图片、文件、上传或外部操作，必须改写。',
        '只允许用户回一句文本；动作必须低摩擦，1 分钟以内。',
        '输出严格 JSON：message,next_action。',
        'next_action 字段：title,done_when,minimum_step,estimated_minutes,condition_index。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        bad_message: intervention.message,
        bad_next_action: intervention.next_action,
        rewrite_goal: '保留推进意图，但改成只让用户用一句文本说明当前状态、卡点、继续/暂停判断或最小证据。',
      }),
    },
  ], { temperature: 0.2, maxTokens: 700 })
  const parsed = extractJson(raw) || {}
  const action = parsed.next_action && typeof parsed.next_action === 'object' ? parsed.next_action : {}
  return {
    ...intervention,
    raw: `${intervention.raw}\n\n[quality_gate_rewrite]\n${raw}`,
    message: compact(parsed.message || readJsonStringField(raw, 'message') || '只回一句文本：现在是继续、暂停，还是卡住？', 180),
    fallback_action: compact(action.minimum_step || intervention.fallback_action || '只回一个词。', 120),
    next_action: {
      title: compact(action.title || '只回一句当前状态', 120),
      done_when: compact(action.done_when || '用户用一句文本说明当前状态。', 180),
      minimum_step: compact(action.minimum_step || '只回继续、暂停或卡住。', 120),
      estimated_minutes: Math.max(1, Math.min(3, Number(action.estimated_minutes || 1) || 1)),
      condition_index: Math.max(0, Math.min(2, Number(action.condition_index || intervention.next_action.condition_index || 0) || 0)),
    },
  }
}

async function askLazyUserToReply(context, intervention, turn) {
  const system = [
    '你现在模拟 QQ 里的真实用户。这个用户强惰性，不配合，不愿意做复杂任务。',
    '你不是测试脚本。你要根据上一条秘书消息、历史状态和当前情绪，自然回复一句 QQ 短消息。',
    '可以敷衍、抗拒、说太难、忘了、路径不对、现实有事、只做一点、偶尔完成。',
    '不要覆盖所有风险，不要解释自己在模拟。不要每次都同一种模式。',
    'message 不能为空；如果用户不想回，就写“不回了”或“0 不搞了”。',
    '输出严格 JSON：message, hidden_state, expected_result。',
    'expected_result 只能是 done, partial, not_done, no_response。',
  ].join('\n')
  const userPrompt = [
    `第 ${turn} 轮秘书消息：${intervention.message}`,
    `动作：${intervention.next_action.title}`,
    `最小启动：${intervention.next_action.minimum_step}`,
    stateSummary(turnRecords),
    '请生成这一次用户在 QQ 上的真实回复。短、自然、有点懒。',
  ].join('\n\n')
  const raw = await callDeepSeek([
    { role: 'system', content: system },
    { role: 'user', content: userPrompt },
  ], { temperature: 0.85, maxTokens: 700 })
  const parsed = extractJson(raw) || {}
  const rawMessage = parsed.message || readJsonStringField(raw, 'message') || ''
  const message = compact(rawMessage || (String(parsed.expected_result || '').toLowerCase() === 'no_response' || String(raw).trim().startsWith('{') ? '不回了' : raw), 220)
  return {
    raw,
    message,
    hidden_state: compact(parsed.hidden_state || '', 220),
    expected_result: String(parsed.expected_result || '').toLowerCase(),
  }
}

async function createDailyAction(context, intervention, date) {
  const condition = context.conditions[intervention.next_action.condition_index] || context.conditions[0]
  return prisma.dailyAction.create({
    data: {
      userId: context.user.id,
      goalId: context.goal.id,
      stagePlanId: context.stage.id,
      conditionId: condition.id,
      actionDate: date,
      title: intervention.next_action.title,
      reason: `DeepSeek dynamic QQ intervention: ${intervention.risk_point}`,
      doneWhen: intervention.next_action.done_when,
      minimumStep: intervention.next_action.minimum_step,
      estimatedMinutes: intervention.next_action.estimated_minutes,
      fallbackAction: intervention.fallback_action,
      checkinQuestion: '现在是做了、做了一点、没做，还是卡住？',
      status: 'PLANNED',
    },
  })
}

async function saveAssistantTurn(context, turn, date, intervention, action) {
  const rule = context.rules[turn % context.rules.length]
  const assistantMessage = await prisma.agentMessage.create({
    data: {
      userId: context.user.id,
      threadId: context.thread.id,
      role: 'ASSISTANT',
      content: intervention.message,
      structuredOutputType: 'dynamic_deepseek_qq_agent',
      structuredOutput: { turn, intervention, actionId: action.id },
      createdAt: date,
    },
  })
  const schedulerEvent = await prisma.schedulerEvent.create({
    data: {
      userId: context.user.id,
      reminderRuleId: rule.id,
      eventType: rule.reminderType,
      channel: 'qq',
      dueKey: `dynamic-deepseek-qq-${runId}-${turn}`,
      scheduledFor: date,
      status: 'sent',
      messageText: intervention.message,
      sentAt: date,
      agentThreadId: context.thread.id,
      agentMessageId: assistantMessage.id,
      externalMessageId: `simulated-qq-out-${runId}-${turn}`,
      payload: {
        verification: 'dynamic_deepseek_qq_trial',
        simulatedQq: true,
        actionId: action.id,
        goalId: context.goal.id,
        intervention_decision: {
          intervention_type: intervention.intervention_type,
          risk_point: intervention.risk_point,
          question_or_message: intervention.message,
          fallback_action: intervention.fallback_action,
          reasoning_summary: 'DeepSeek generated this QQ intervention dynamically from previous turns.',
          verification_signal: intervention.verification_signal,
          planner_source: 'deepseek_dynamic',
          policy_version: 'dynamic-deepseek-qq-v0.1',
        },
      },
    },
  })
  await prisma.qqMessageEvent.create({
    data: {
      userId: context.user.id,
      eventId: `dynamic-deepseek-qq-out-${runId}-${turn}`,
      eventType: 'message.sent',
      contextType: 'c2c',
      contextId: `dynamic-deepseek-qq-openid-${runId}`,
      messageText: intervention.message,
      payload: { simulatedQq: true, schedulerEventId: schedulerEvent.id },
      status: 'sent',
      agentThreadId: context.thread.id,
      agentMessageId: assistantMessage.id,
      replyMessageId: assistantMessage.id,
      createdAt: date,
    },
  })
  await recordAgentToolActionWithPrisma(prisma, {
    context: { userId: context.user.id, source: 'scheduler', agentThreadId: context.thread.id, agentMessageId: assistantMessage.id },
    toolName: 'reminder.send',
    permission: 'execute',
    inputSummary: `${rule.reminderType} -> simulated qq`,
    input: { reminderRuleId: rule.id, schedulerEventId: schedulerEvent.id, intervention_decision: schedulerEvent.payload.intervention_decision, simulatedQq: true },
    result: { simulatedQq: true, message: intervention.message },
    targetType: 'reminder',
    targetId: rule.id,
    riskLevel: 'low',
    requiresConfirmation: false,
    status: 'executed',
  })
  return { assistantMessage, schedulerEvent }
}

async function saveUserTurn(context, turn, date, userReply, schedulerEvent, action) {
  const inboundAt = new Date(date.getTime() + 30 * 60 * 1000)
  const userMessage = await prisma.agentMessage.create({
    data: {
      userId: context.user.id,
      threadId: context.thread.id,
      role: 'USER',
      content: userReply.message,
      structuredOutputType: 'dynamic_deepseek_qq_user',
      structuredOutput: { turn, hidden_state: userReply.hidden_state, expected_result: userReply.expected_result },
      createdAt: inboundAt,
    },
  })
  const qqEvent = await prisma.qqMessageEvent.create({
    data: {
      userId: context.user.id,
      eventId: `dynamic-deepseek-qq-in-${runId}-${turn}`,
      eventType: 'C2C_MESSAGE_CREATE',
      contextType: 'c2c',
      contextId: `dynamic-deepseek-qq-openid-${runId}`,
      messageText: userReply.message,
      payload: { simulatedQq: true, schedulerEventId: schedulerEvent.id, actionId: action.id },
      status: 'received',
      agentThreadId: context.thread.id,
      agentMessageId: userMessage.id,
      createdAt: inboundAt,
    },
  })
  const classified = classifyQqSchedulerReply(userReply.message)
  const execution = await executeAgentToolWithPrisma(
    prisma,
    { userId: context.user.id, source: 'scheduler', confirmed: true, agentThreadId: context.thread.id, agentMessageId: userMessage.id },
    'checkin.submit',
    {
      actionId: action.id,
      result: classified.result.toLowerCase(),
      reasonCategory: classified.reasonCategory,
      userFeedback: userReply.message,
      adjustment: classified.adjustment,
    },
  )
  await prisma.qqMessageEvent.update({
    where: { id: qqEvent.id },
    data: { status: execution.action?.status === 'failed' ? 'failed' : 'processed' },
  })
  await prisma.schedulerEvent.update({
    where: { id: schedulerEvent.id },
    data: {
      status: 'responded',
      payload: {
        ...(schedulerEvent.payload || {}),
        reply: {
          messageId: qqEvent.eventId,
          text: userReply.message,
          feedback: classified,
          processedAt: new Date().toISOString(),
          simulatedQq: true,
        },
      },
    },
  })
  return { userMessage, qqEvent, classified, execution }
}

async function maybeGenerateReview(context, turn, date, userMessage) {
  if (turn % 7 !== 0 && turn !== turnCount) return null
  return executeAgentToolWithPrisma(
    prisma,
    { userId: context.user.id, source: 'scheduler', confirmed: true, agentThreadId: context.thread.id, agentMessageId: userMessage.id },
    'review.generate',
    {
      type: 'weekly',
      periodStart: addDays(date, -6).toISOString(),
      periodEnd: date.toISOString(),
      goalId: context.goal.id,
      nextFocus: '继续保留小动作、少打扰、风险前置和路径校验。',
    },
  )
}

async function updateFinalKr(context) {
  const checkins = await prisma.checkin.findMany({ where: { userId: context.user.id, goalId: context.goal.id } })
  const keyResults = await prisma.keyResult.findMany({ where: { userId: context.user.id, goalId: context.goal.id }, orderBy: { createdAt: 'asc' } })
  const early = await prisma.dailyAction.findMany({ where: { userId: context.user.id, goalId: context.goal.id, actionDate: { lt: addDays(baseDate, Math.ceil(turnCount / 2)) } } })
  const late = await prisma.dailyAction.findMany({ where: { userId: context.user.id, goalId: context.goal.id, actionDate: { gte: addDays(baseDate, Math.ceil(turnCount / 2)) } } })
  const earlyMax = Math.max(...early.map((item) => item.estimatedMinutes), 0)
  const lateMax = Math.max(...late.map((item) => item.estimatedMinutes), 0)
  if (keyResults[0]) {
    await prisma.keyResult.update({
      where: { id: keyResults[0].id },
      data: { currentValue: String(checkins.length), progress: Math.min(1, checkins.length / 10) },
    })
  }
  if (keyResults[1]) {
    await prisma.keyResult.update({
      where: { id: keyResults[1].id },
      data: { currentValue: lateMax < earlyMax ? 'true' : 'false', progress: lateMax < earlyMax ? 1 : 0.4 },
    })
  }
  return { checkins, earlyMax, lateMax }
}

async function runTrial() {
  const preflight = await preflightDeepSeek()
  record('DDQ-DEEPSEEK-PREFLIGHT', 'DeepSeek API key, base URL and model can return a real reply', preflight.ok, `model=${modelName}; apiBase=${apiBase}; reply=${compact(preflight.message, 180)}`)
  if (!preflight.ok) return

  const context = await seedWorkspace()
  record('DDQ-SEED', 'dynamic QQ trial creates isolated user, goal, QQ binding, thread and reminder rules', Boolean(context.user.id && context.goal.id && context.thread.id), `user=${maskEmail(email)}; goal=${context.goal.title}`)

  for (let turn = 1; turn <= turnCount; turn += 1) {
    const date = addDays(baseDate, turn - 1)
    const intervention = await askAgentForIntervention(context, turn, date)
    const action = await createDailyAction(context, intervention, date)
    const sent = await saveAssistantTurn(context, turn, date, intervention, action)
    const userReply = await askLazyUserToReply(context, intervention, turn)
    const received = await saveUserTurn(context, turn, date, userReply, sent.schedulerEvent, action)
    const review = await maybeGenerateReview(context, turn, date, received.userMessage)
    const audit = auditSecretaryReply(intervention.message)
    turnRecords.push({
      turn,
      date: date.toISOString().slice(0, 10),
      assistantMessage: intervention.message,
      userMessage: userReply.message,
      classified: received.classified,
      audit,
      actionMinutes: action.estimatedMinutes,
      checkinStatus: received.execution.action?.status || '',
      reviewStatus: review?.action?.status || '',
    })
    console.log(`[dynamic-qq] turn ${turn}/${turnCount} ${received.classified.result}/${received.classified.reasonCategory}: ${compact(userReply.message, 80)}`)
  }

  const final = await updateFinalKr(context)
  const [
    qqInbound,
    qqOutbound,
    schedulerEvents,
    toolActions,
    diagnoses,
    dayDocs,
    weekDocs,
    metaDocs,
    reviews,
  ] = await Promise.all([
    prisma.qqMessageEvent.findMany({ where: { userId: context.user.id, eventType: 'C2C_MESSAGE_CREATE' } }),
    prisma.qqMessageEvent.findMany({ where: { userId: context.user.id, eventType: 'message.sent' } }),
    prisma.schedulerEvent.findMany({ where: { userId: context.user.id } }),
    prisma.agentToolAction.findMany({ where: { userId: context.user.id } }),
    prisma.diagnosis.findMany({ where: { userId: context.user.id } }),
    prisma.markdownDocument.findMany({ where: { userId: context.user.id, type: 'DAY' } }),
    prisma.markdownDocument.findMany({ where: { userId: context.user.id, type: 'WEEK' } }),
    prisma.markdownDocument.findMany({ where: { userId: context.user.id, type: 'SYSTEM', path: { contains: 'system/meta-cognition/' } } }),
    prisma.review.findMany({ where: { userId: context.user.id } }),
  ])
  const qualityFailures = turnRecords.filter((item) => !item.audit.ok)
  const reasonCategories = new Set(diagnoses.map((item) => item.category).filter((item) => item && item !== 'UNKNOWN'))
  const uniqueUserReplies = new Set(turnRecords.map((item) => item.userMessage))

  record('DDQ-DYNAMIC-TURNS', 'trial runs dynamic DeepSeek Agent turns and dynamic lazy QQ user replies, not a fixed user script', turnRecords.length === turnCount && uniqueUserReplies.size >= Math.min(turnCount, 10), `turns=${turnRecords.length}; uniqueUserReplies=${uniqueUserReplies.size}`)
  record('DDQ-QQ-EVENTS', 'every turn is persisted as QQ-like outbound and inbound events', qqInbound.length === turnCount && qqOutbound.length === turnCount, `inbound=${qqInbound.length}; outbound=${qqOutbound.length}; simulatedQq=true`)
  record('DDQ-SCHEDULER-RESPONDED', 'every sent scheduler event is marked responded after QQ user feedback', schedulerEvents.length === turnCount && schedulerEvents.every((item) => item.status === 'responded'), `events=${schedulerEvents.length}; responded=${schedulerEvents.filter((item) => item.status === 'responded').length}`)
  record('DDQ-TOOL-AUDIT', 'scheduler source writes reminder.send and checkin.submit through shared Agent Tool Runtime', toolActions.some((item) => item.source === 'scheduler' && item.toolName === 'reminder.send') && toolActions.some((item) => item.source === 'scheduler' && item.toolName === 'checkin.submit'), `actions=${toolActions.map((item) => `${item.source}:${item.toolName}:${item.status}`).slice(0, 12).join(',')}`)
  record('DDQ-CONTROL-LOOP', 'QQ feedback creates Check-in, Diagnosis, Markdown logs, Review and Meta-Cognition evidence', final.checkins.length >= Math.min(turnCount, 10) && diagnoses.length >= 6 && dayDocs.length >= turnCount && weekDocs.length >= 2 && reviews.length >= 2 && metaDocs.length >= 1, `checkins=${final.checkins.length}; diagnoses=${diagnoses.length}; days=${dayDocs.length}; weeks=${weekDocs.length}; reviews=${reviews.length}; meta=${metaDocs.length}`)
  record('DDQ-DIAGNOSIS-COVERAGE', 'dynamic conversation covers at least three diagnosis categories', reasonCategories.size >= 3, `categories=${Array.from(reasonCategories).join(',') || 'none'}`)
  record('DDQ-REPLY-QUALITY', 'DeepSeek secretary messages stay short, specific, non-coercive and operational', qualityFailures.length === 0, `passed=${turnRecords.length - qualityFailures.length}/${turnRecords.length}; failures=${qualityFailures.slice(0, 3).map((item) => `${item.turn}:${item.audit.issues.join('+')}`).join(' | ') || 'none'}`)
  record('DDQ-LOAD-CONTROL', 'actions are kept small or become smaller while the goal remains active', final.lateMax < final.earlyMax || (final.earlyMax <= 3 && final.lateMax <= final.earlyMax), `earlyMax=${final.earlyMax}; lateMax=${final.lateMax}; goal=${context.goal.title}`)
}

function toMarkdown() {
  const failed = results.filter((item) => !item.ok)
  return [
    '# Dynamic DeepSeek QQ Trial Verification',
    '',
    `- Time: ${new Date().toISOString()}`,
    `- Result: ${failed.length === 0 ? 'PASS' : 'FAIL'}`,
    `- Model: ${modelName}`,
    `- API base: ${apiBase}`,
    `- Test user: ${maskEmail(email)}`,
    `- Turns: ${turnCount}`,
    `- Test data kept: ${keepData ? 'yes' : 'no'}`,
    '',
    'No API key, QQ token, cookie or session is written to this report.',
    '',
    'Important boundary: this verifies live DeepSeek plus QQ-channel data semantics. It does not prove a real QQ Gateway client delivered these messages.',
    '',
    '| ID | Purpose | Result | Evidence |',
    '| --- | --- | --- | --- |',
    ...results.map((item) => `| ${item.id} | ${item.purpose} | ${item.ok ? 'PASS' : 'FAIL'} | ${String(item.evidence || '').replaceAll('|', '\\|').slice(0, 900)} |`),
    '',
    '## Turns',
    '',
    '| Turn | Date | Agent QQ message | User QQ reply | Classified | Quality |',
    '| --- | --- | --- | --- | --- | --- |',
    ...turnRecords.map((item) => `| ${item.turn} | ${item.date} | ${compact(item.assistantMessage, 180).replaceAll('|', '\\|')} | ${compact(item.userMessage, 160).replaceAll('|', '\\|')} | ${item.classified.result}/${item.classified.reasonCategory} | ${item.audit.ok ? 'ok' : item.audit.issues.join('+')} |`),
    '',
  ].join('\n')
}

try {
  await runTrial()
} catch (error) {
  record('DDQ-RUNTIME', 'dynamic DeepSeek QQ trial completes without crashing', false, error instanceof Error ? error.stack || error.message : String(error))
} finally {
  if (!keepData) {
    try {
      await cleanupUser()
      record('DDQ-CLEANUP', 'temporary dynamic QQ trial user and data are removed', true, 'cleanup completed')
    } catch (error) {
      record('DDQ-CLEANUP', 'temporary dynamic QQ trial user and data are removed', false, error instanceof Error ? error.message : String(error))
    }
  }
  await prisma.$disconnect()
}

const markdown = toMarkdown()
console.log(markdown)
if (shouldWrite) {
  writeFileSync(resolve(projectRoot, 'docs/plans/dynamic-deepseek-qq-trial-last-run.md'), markdown)
}

process.exit(results.every((item) => item.ok) ? 0 : 1)
