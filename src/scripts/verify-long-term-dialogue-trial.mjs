import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PrismaClient } from '@prisma/client'
import { chatCompletionsUrl } from '../lib/model-endpoint.mjs'
import { fetchModelProvider } from '../lib/model-provider-http.mjs'

const prisma = new PrismaClient()
const shouldWrite = process.argv.includes('--write')
const keepData = process.argv.includes('--keep-data')
const runLive = process.env.RUN_REAL_LONG_TERM_AI === '1'
const apiKey = process.env.GOAL_MATE_LIVE_MODEL_API_KEY || process.env.BAI_API_KEY || process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY || ''
const apiBase = String(process.env.GOAL_MATE_LIVE_MODEL_API_BASE || process.env.GOAL_MATE_MODEL_API_BASE || process.env.BAI_API_BASE || process.env.OPENAI_API_BASE || process.env.DEEPSEEK_API_BASE || 'https://api.b.ai').replace(/\/+$/, '')
const modelName = process.env.GOAL_MATE_LIVE_MODEL_MODEL || process.env.GOAL_MATE_MODEL || process.env.OPENAI_MODEL || process.env.DEEPSEEK_MODEL || 'gpt-5-nano'
const shouldCallLiveModel = runLive && Boolean(apiKey.trim())
const scriptDir = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(scriptDir, '..')
const projectRoot = resolve(appRoot, '..')
const runId = Date.now()
const email = process.env.GOAL_MATE_LONG_TERM_DIALOGUE_EMAIL || `long-term-dialogue-${runId}@goalmate.local`
const results = []
const DAY_MS = 24 * 60 * 60 * 1000
const baseDate = new Date(2026, 6, 6, 8, 0, 0)

function record(id, purpose, ok, evidence = '') {
  results.push({ id, purpose, ok, evidence })
}

function compact(value, max = 360) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max)}...` : text
}

function maskEmail(value) {
  return value.replace(/^(.{3}).+@/, '$1...@')
}

function pad(value) {
  return String(value).padStart(2, '0')
}

function addDays(date, days) {
  return new Date(date.getTime() + days * DAY_MS)
}

function getWeekNumber(date) {
  const copied = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = copied.getUTCDay() || 7
  copied.setUTCDate(copied.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(copied.getUTCFullYear(), 0, 1))
  return Math.ceil((((copied.getTime() - yearStart.getTime()) / DAY_MS) + 1) / 7)
}

function dateParts(date) {
  const year = date.getFullYear()
  const monthNumber = pad(date.getMonth() + 1)
  const dayNumber = pad(date.getDate())
  const quarter = `Q${Math.floor(date.getMonth() / 3) + 1}`
  const month = `${year}-${monthNumber}`
  const week = `W${pad(getWeekNumber(date))}`
  const day = `${year}-${monthNumber}-${dayNumber}`
  return {
    year,
    quarter,
    month,
    week,
    day,
    yearPath: `logs/${year}/${year}.md`,
    quarterPath: `logs/${year}/${quarter}/${year}-${quarter}.md`,
    monthPath: `logs/${year}/${quarter}/${month}/${month}.md`,
    weekPath: `logs/${year}/${quarter}/${month}/${week}/${year}-${week}.md`,
    dayPath: `logs/${year}/${quarter}/${month}/${week}/${day}.md`,
  }
}

function countSentences(text) {
  return String(text || '').split(/[。！？!?\n]+/u).map((item) => item.trim()).filter(Boolean).length
}

function countQuestions(text) {
  return (String(text || '').match(/[？?]/g) || []).length
}

const forbiddenReplyPatterns = [
  /好的[，,]?我来/u,
  /希望(这|以上).*帮助/u,
  /总之|综上/u,
  /首先.*其次.*最后/us,
  /作为.*AI/u,
  /以下是.*建议/u,
  /加油|坚持|你可以的|相信自己|继续努力|不要放弃/u,
  /你必须|严格执行|又失败|自律太差|你不应该拖延/u,
  /更像是.+问题[；;]/u,
  /原因分类|系统判断|调整建议/u,
  /动机不足|能力不足|提示不对|路径判断错误/u,
  /已经(修改|创建|删除|发送|安排|设置)/u,
]

function auditAssistantReply(reply, expectation = {}) {
  const text = String(reply || '').trim()
  const issues = []
  if (!text) issues.push('empty')
  if (countSentences(text) > (expectation.maxSentences || 4)) issues.push('too_many_sentences')
  if (text.length > (expectation.maxChars || 180)) issues.push('too_long')
  if (countQuestions(text) > 1) issues.push('too_many_questions')
  if (forbiddenReplyPatterns.some((pattern) => pattern.test(text))) issues.push('forbidden_tone')
  if (!/(先|只|今天|明天|下一次|现在|记录|记下|暂停|降级|重定义|确认|保留|缩|打开|回复|止损|不加码|证据|风险|缺口|复盘|目标)/u.test(text)) {
    issues.push('not_operational')
  }
  if (expectation.mustMentionAny?.length && !expectation.mustMentionAny.some((pattern) => pattern.test(text))) {
    issues.push('missing_expected_signal')
  }
  return {
    ok: issues.length === 0,
    issues,
    sentenceCount: countSentences(text),
    questionCount: countQuestions(text),
    sample: compact(text, 220),
  }
}

const trialDays = [
  { day: 1, user: '我想减肥、学英语、把项目做完，但我经常坚持不了。', risk: '目标过多', expected: [/先|只|今天|目标|下一步/u], result: 'partial' },
  { day: 2, user: '走路两小时太难了，我根本不想开始。', risk: '任务太难', expected: [/缩|十分钟|启动|动作/u], result: 'not_done' },
  { day: 3, user: '随便吧，就这样，反正也没什么用。', risk: '连续敷衍', expected: [/反馈|事实|一个词|证据|不够/u], result: 'not_done' },
  { day: 4, user: '今天没回消息，我下午才看到。', risk: '装死不回复', expected: [/不追|晚上|只|复盘|入口/u], result: 'no_response' },
  { day: 5, user: '英语这个事情我可能只是觉得应该学，不是真的想学。', risk: '目标不真', expected: [/暂停|重定义|不催|目标/u], result: 'not_done' },
  { day: 6, user: '别催了，看见提醒我就烦。', risk: '反感提醒', expected: [/减少|打扰|晚上|一次|提醒/u], result: 'not_done' },
  { day: 7, user: '项目我不知道从哪里改，感觉路径不对。', risk: '路径错误', expected: [/缺口|路径|先不|确认|项目/u], result: 'partial' },
  { day: 8, user: '我说做了，但其实只是打开了文件。', risk: '证据不足', expected: [/待确认|证据|最小|算|完成/u], result: 'partial' },
  { day: 9, user: '今天家里有事，别安排太多。', risk: '现实意外', expected: [/止损|暂停|最小|不补偿|现实/u], result: 'not_done' },
  { day: 10, user: '今天走了十分钟，没点外卖。', risk: '正常推进', expected: [/不加码|保持|稳定|明天/u], result: 'done' },
  { day: 11, user: '我还是不想背英语，但可以听三分钟。', risk: '降级不降目标', expected: [/三分钟|不背|保留|目标/u], result: 'partial' },
  { day: 12, user: '我写了一句项目卡点：Agent 回复像模板。', risk: '路径恢复', expected: [/卡点|改|一句|真人|模板/u], result: 'done' },
  { day: 13, user: '我没有变自律，但每天确实能被拉回来一点。', risk: '长期反馈', expected: [/稳定|不加码|下一周期|继续|证据/u], result: 'partial' },
  { day: 14, user: '这一周我最有用的是任务变小，提醒少一点，我更愿意回。', risk: '周复盘', expected: [/复盘|保留|提醒|任务|下一周/u], result: 'done' },
]

const fallbackReplies = {
  '目标过多': '先不铺计划。今天只定一个入口：身体先走十分钟，英语只听三分钟，项目只写一句卡点。',
  '任务太难': '动作缩小，不改目标。今天只走十分钟，先证明它能启动。',
  '连续敷衍': '这个反馈不够当事实。今天只回一个词：太难、没兴趣、忘了，还是路径不对？',
  '装死不回复': '我不继续追消息。今天只留晚上一次复盘，回复做了或没做就行。',
  '目标不真': '那先暂停背诵。今天不催英语，只确认这个目标要不要重定义。',
  '反感提醒': '收到，今天减少打扰。只保留晚上一次复盘，不用中午再追。',
  '路径错误': '先不催你做更多。今天只确认项目这一步到底补哪个缺口。',
  '证据不足': '先记为待确认，不直接算完整完成。打开文件可以算最小启动，明天沿着这个痕迹继续。',
  '现实意外': '今天止损。只保留健康最小动作，项目暂停，不补偿、不重排整周。',
  '正常推进': '记下了。今天先不加码，明天继续这个节奏，先看它能不能稳定重复。',
  '降级不降目标': '英语先保留三分钟入口，不背诵。动作降级，目标不缩水。',
  '路径恢复': '这就是今天的项目入口。明天只改这一处：把最模板的一句话改成真人能说的话。',
  '长期反馈': '这说明现在有效的是小动作和少打扰。下一周期先保留，不急着加码。',
  '周复盘': '周复盘先保留两件事：任务继续变小，提醒继续少一点。下一周只看你是否更愿意回复。',
}

async function callLiveSecretaryReply(messages, day) {
  const system = [
    '你是 Goal Mate 的 AI 目标秘书，不是客服、知识问答或写作助手。',
    '回复 1 到 3 句；不要“好的，我来帮你”；不要泛鼓励；不要羞辱；不要机械说诊断分类。',
    '你面对的是强惰性用户。先接住事实，再判断阻力，最后只给一个动作或一个问题。',
    '可以暂停、降级、重定义目标；降低今天动作不能降低最终目标。',
    '如果用户说完成但证据不足，先记为待确认。',
    '当前是压缩 14 天长期对话试运行；你的回复要适合 QQ/网页短对话。',
  ].join('\n')
  const response = await fetchModelProvider(chatCompletionsUrl(apiBase), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: modelName,
      temperature: 0.2,
      max_tokens: 260,
      messages: [
        { role: 'system', content: system },
        ...messages.slice(-10),
        { role: 'user', content: `第 ${day.day} 天。风险：${day.risk}。用户回复：${day.user}` },
      ],
    }),
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`live_model_http_${response.status}:${compact(text, 180)}`)
  }
  const data = await response.json()
  const reply = data?.choices?.[0]?.message?.content
  if (!reply || typeof reply !== 'string') throw new Error('live_model_empty_reply')
  return reply.trim()
}

async function preflightLiveModel() {
  if (!shouldCallLiveModel) return { ok: true, skipped: true, message: 'live disabled' }
  try {
    const response = await fetchModelProvider(chatCompletionsUrl(apiBase), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: modelName,
        temperature: 0.1,
        max_tokens: 80,
        messages: [
          { role: 'system', content: '你是 Goal Mate 的 AI 目标秘书。只回答一句短句。' },
          { role: 'user', content: '回复：可以开始长期试运行。' },
        ],
      }),
    })
    if (!response.ok) {
      const text = await response.text()
      return { ok: false, skipped: false, message: `HTTP ${response.status}: ${compact(text, 220)}` }
    }
    const data = await response.json()
    const reply = data?.choices?.[0]?.message?.content || ''
    return { ok: Boolean(String(reply).trim()), skipped: false, message: compact(reply, 160) || 'empty reply' }
  } catch (error) {
    return { ok: false, skipped: false, message: error instanceof Error ? error.message : String(error) }
  }
}

async function cleanupUser() {
  await prisma.user.deleteMany({ where: { email } })
}

async function seedUser() {
  const user = await prisma.user.create({
    data: {
      email,
      name: 'Long Term Dialogue Trial User',
      emailVerified: true,
    },
  })
  await prisma.userSetting.create({
    data: {
      userId: user.id,
      general: { timezone: 'Asia/Shanghai' },
      goals: { review_cadence: 'weekly' },
      logs: { auto_write_checkin: true, auto_write_review: true, vault_root: 'logs' },
      today: { heatmap_scope: 'year', low_energy_mode: true },
      agent: { can_read_goals: true, can_read_logs: true, memory_enabled: true },
      notifications: { morning: '08:30', midday: '12:30', evening: '21:30' },
      dataPrivacy: { export_markdown: true },
    },
  })
  const goal = await prisma.goal.create({
    data: {
      userId: user.id,
      title: '让强惰性用户持续推进三个长期目标',
      rawInput: '我想减肥、学英语、推进项目，但执行力很差，希望 AI 长期推动我。',
      interpretedGoal: '通过低阻力行动、少打扰提醒和持续复盘，让身体、英语和项目每天至少有一个可验证推进。',
      status: 'ACTIVE',
      isCurrentFocus: true,
      horizonStart: baseDate,
      horizonEnd: addDays(baseDate, 13),
    },
  })
  const keyResults = await Promise.all([
    prisma.keyResult.create({
      data: { userId: user.id, goalId: goal.id, title: '14 天内至少 10 天产生可验证行动', metricType: 'COUNT', currentValue: '0', targetValue: '10', progress: 0, whyNecessary: '没有连续行动证据，就不能证明长期推动有效。' },
    }),
    prisma.keyResult.create({
      data: { userId: user.id, goalId: goal.id, title: '用户更愿意回复且提醒打扰下降', metricType: 'BOOLEAN', currentValue: 'false', targetValue: 'true', progress: 0, whyNecessary: '如果提醒让用户更烦，长期推动会失效。' },
    }),
  ])
  const condition = await prisma.goalCondition.create({
    data: { userId: user.id, goalId: goal.id, title: '每次回复都减少用户决策成本', type: 'HARD', status: 'PARTIAL', whyRequired: '强惰性用户不能靠复杂计划推进。' },
  })
  const stage = await prisma.stagePlan.create({
    data: {
      userId: user.id,
      goalId: goal.id,
      title: '14 天长期对话试运行',
      stageGoal: '验证真实或模拟长期对话能持续拉回行动。',
      startDate: baseDate,
      endDate: addDays(baseDate, 13),
      linkedConditionIds: [condition.id],
      successSignals: ['用户更愿意回复', '动作变小但目标不缩水', '每天留下事实证据'],
      sortOrder: 1,
    },
  })
  const thread = await prisma.agentThread.create({
    data: { userId: user.id, goalId: goal.id, title: '长期对话试运行' },
  })
  return { user, goal, keyResults, condition, stage, thread }
}

async function upsertLogDocument(input) {
  const document = await prisma.markdownDocument.upsert({
    where: { userId_path: { userId: input.userId, path: input.path } },
    update: {
      title: input.title,
      type: input.type,
      content: input.content,
      frontmatter: input.frontmatter || {},
      linkedGoalIds: input.linkedGoalIds || [],
      linkedActionIds: input.linkedActionIds || [],
      source: 'AGENT',
    },
    create: {
      userId: input.userId,
      path: input.path,
      title: input.title,
      type: input.type,
      content: input.content,
      frontmatter: input.frontmatter || {},
      linkedGoalIds: input.linkedGoalIds || [],
      linkedActionIds: input.linkedActionIds || [],
      source: 'AGENT',
    },
  })
  const periodType = input.type === 'DAY' ? 'DAY' : input.type === 'WEEK' ? 'WEEK' : null
  if (periodType) {
    await prisma.logEntry.upsert({
      where: { userId_path: { userId: input.userId, path: input.path } },
      update: { title: input.title, periodType, content: input.content, linkedGoalIds: input.linkedGoalIds || [], linkedActionIds: input.linkedActionIds || [] },
      create: { userId: input.userId, path: input.path, title: input.title, periodType, content: input.content, linkedGoalIds: input.linkedGoalIds || [], linkedActionIds: input.linkedActionIds || [] },
    })
  }
  return document
}

function actionStatusFromResult(result) {
  if (result === 'done') return 'DONE'
  if (result === 'partial') return 'PARTIAL'
  if (result === 'no_response') return 'NOT_DONE'
  return 'NOT_DONE'
}

async function runTrial() {
  await cleanupUser()
  const { user, goal, keyResults, condition, stage, thread } = await seedUser()
  record('LTD-SEED', 'trial creates an isolated long-term dialogue workspace with a real goal, KR, condition and thread', Boolean(user.id && goal.id && thread.id), `user=${maskEmail(email)}; goal=${goal.title}`)

  if (runLive && !apiKey.trim()) {
    record('LTD-LIVE-KEY', 'live long-term trial requires a model API key when RUN_REAL_LONG_TERM_AI=1', false, 'missing live model API key')
    return
  }
  record(
    shouldCallLiveModel ? 'LTD-LIVE-MODEL-ENABLED' : 'LTD-LIVE-MODEL-SKIPPED',
    shouldCallLiveModel ? 'trial will call the configured live model for every assistant turn' : 'trial is running deterministic long-term simulation because live mode is not enabled',
    true,
    shouldCallLiveModel ? `model=${modelName}; apiBase=${apiBase}; key=configured` : 'set RUN_REAL_LONG_TERM_AI=1 and a model API key to run live',
  )
  const preflight = await preflightLiveModel()
  record(
    shouldCallLiveModel ? 'LTD-LIVE-PREFLIGHT' : 'LTD-LIVE-PREFLIGHT-SKIPPED',
    shouldCallLiveModel ? 'live model must answer one preflight message before the 14-day trial starts' : 'live model preflight is skipped when deterministic trial is used',
    preflight.ok,
    preflight.message,
  )
  if (!preflight.ok) return

  const dialogueMessages = []
  const assistantAudits = []
  const dailyActionIds = []
  let completedOrPartialDays = 0
  let willingnessSignals = 0
  let liveReplyCount = 0

  for (const day of trialDays) {
    const date = addDays(baseDate, day.day - 1)
    const parts = dateParts(date)
    const minutes = day.day <= 2 ? 90 : day.day <= 7 ? 15 : 10
    const action = await prisma.dailyAction.create({
      data: {
        userId: user.id,
        goalId: goal.id,
        stagePlanId: stage.id,
        conditionId: condition.id,
        actionDate: date,
        title: `第 ${day.day} 天：长期对话最小推进`,
        reason: `长期对话试运行：${day.risk}`,
        doneWhen: '当天留下一个可验证行动、一个反馈或一个阻力证据。',
        minimumStep: '只回复一个真实状态。',
        fallbackAction: '如果做不动，只回复阻力类型。',
        checkinQuestion: '做了、没做、卡住，还是需要暂停？',
        estimatedMinutes: minutes,
        status: actionStatusFromResult(day.result),
      },
    })
    dailyActionIds.push(action.id)

    await prisma.agentMessage.create({
      data: { userId: user.id, threadId: thread.id, role: 'USER', content: day.user, structuredOutputType: 'long_term_trial_user', structuredOutput: { day: day.day, risk: day.risk } },
    })
    dialogueMessages.push({ role: 'user', content: day.user })

    let reply = fallbackReplies[day.risk]
    let liveError = ''
    if (shouldCallLiveModel) {
      try {
        reply = await callLiveSecretaryReply(dialogueMessages, day)
        liveReplyCount += 1
      } catch (error) {
        liveError = error instanceof Error ? error.message : String(error)
      }
    }
    const audit = auditAssistantReply(reply, { mustMentionAny: day.expected })
    assistantAudits.push({ day: day.day, risk: day.risk, live: shouldCallLiveModel, liveError, reply, audit })
    await prisma.agentMessage.create({
      data: {
        userId: user.id,
        threadId: thread.id,
        role: 'ASSISTANT',
        content: reply,
        structuredOutputType: shouldCallLiveModel ? 'long_term_trial_live_reply' : 'long_term_trial_simulated_reply',
        structuredOutput: { day: day.day, risk: day.risk, audit, liveError: liveError || null },
      },
    })
    dialogueMessages.push({ role: 'assistant', content: reply })

    if (day.result === 'done' || day.result === 'partial') completedOrPartialDays += 1
    if (/更愿意|可以|舒服|被拉回来|有用/u.test(day.user)) willingnessSignals += 1

    await prisma.checkin.create({
      data: {
        userId: user.id,
        goalId: goal.id,
        actionId: action.id,
        result: day.result === 'done' ? 'DONE' : day.result === 'partial' ? 'PARTIAL' : day.result === 'no_response' ? 'NO_RESPONSE' : 'NOT_DONE',
        reasonCategory: day.risk.includes('目标') ? 'MOTIVATION' : day.risk.includes('路径') ? 'PATH' : day.risk.includes('提醒') || day.risk.includes('反感') ? 'PROMPT' : 'ABILITY',
        userFeedback: day.user,
        adjustment: reply,
      },
    })

    const content = [
      `# ${parts.day} 日志`,
      '',
      `- 上级周志：[[${parts.weekPath}]]`,
      `- 目标：${goal.title}`,
      '',
      '## 今日事实',
      '',
      `- 用户回复：${day.user}`,
      `- 风险：${day.risk}`,
      `- Agent 回复：${reply}`,
      '',
      '## 对话质量审稿',
      '',
      `- 通过：${audit.ok ? 'yes' : 'no'}`,
      `- 问题：${audit.issues.join(',') || 'none'}`,
      `- Live：${shouldCallLiveModel ? 'yes' : 'no'}`,
      '',
      '## 下一步',
      '',
      `- 行动状态：${action.status}`,
      `- 完成标准：${action.doneWhen}`,
      `- 验证信号：用户是否更愿意回复、动作是否更小但目标不缩水、下一天是否继续推进。`,
    ].join('\n')
    await upsertLogDocument({
      userId: user.id,
      type: 'DAY',
      path: parts.dayPath,
      title: `${parts.day}.md`,
      content,
      linkedGoalIds: [goal.id],
      linkedActionIds: [action.id],
      frontmatter: { kind: 'daily_log', longTermDialogueTrial: true, day: day.day, risk: day.risk },
    })
  }

  await prisma.keyResult.update({ where: { id: keyResults[0].id }, data: { currentValue: String(completedOrPartialDays), progress: Math.min(1, completedOrPartialDays / 10) } })
  await prisma.keyResult.update({ where: { id: keyResults[1].id }, data: { currentValue: willingnessSignals >= 2 ? 'true' : 'false', progress: willingnessSignals >= 2 ? 1 : 0.4 } })
  await prisma.goal.update({ where: { id: goal.id }, data: { interpretedGoal: `${goal.interpretedGoal}\n\n长期对话试运行结论：保留小动作、低打扰、证据优先，不把降难度当成降目标。` } })

  const week1 = dateParts(baseDate)
  const week2 = dateParts(addDays(baseDate, 7))
  await upsertLogDocument({
    userId: user.id,
    type: 'WEEK',
    path: week1.weekPath,
    title: `${week1.year}-${week1.week}.md`,
    content: `# ${week1.year} ${week1.week} 周志\n\n## 长期对话试运行\n\n- 第 1 周重点：强惰性、敷衍、装死、目标不真、反感提醒。\n- 控制策略：减少打扰、只问一个问题、必要时暂停或重定义目标。`,
    linkedGoalIds: [goal.id],
    linkedActionIds: dailyActionIds.slice(0, 7),
  })
  await upsertLogDocument({
    userId: user.id,
    type: 'WEEK',
    path: week2.weekPath,
    title: `${week2.year}-${week2.week}.md`,
    content: `# ${week2.year} ${week2.week} 周志\n\n## 长期对话试运行\n\n- 第 2 周重点：证据不足、现实意外、恢复推进、周复盘。\n- 控制策略：动作小、目标不缩水、提醒少一点，观察用户是否更愿意回复。`,
    linkedGoalIds: [goal.id],
    linkedActionIds: dailyActionIds.slice(7),
  })

  const allActions = await prisma.dailyAction.findMany({ where: { userId: user.id } })
  const dayDocs = await prisma.markdownDocument.findMany({ where: { userId: user.id, type: 'DAY' } })
  const weekDocs = await prisma.markdownDocument.findMany({ where: { userId: user.id, type: 'WEEK' } })
  const finalKeyResults = await prisma.keyResult.findMany({ where: { userId: user.id } })
  const assistantMessages = await prisma.agentMessage.findMany({ where: { userId: user.id, role: 'ASSISTANT' } })
  const earlyMax = Math.max(...allActions.filter((item) => item.actionDate < addDays(baseDate, 2)).map((item) => item.estimatedMinutes), 0)
  const laterMax = Math.max(...allActions.filter((item) => item.actionDate >= addDays(baseDate, 7)).map((item) => item.estimatedMinutes), 0)
  const failedAudits = assistantAudits.filter((item) => !item.audit.ok || item.liveError)

  record('LTD-DIALOGUE-DAYS', 'trial runs a compressed fourteen-day long-term dialogue with user and assistant turns', assistantMessages.length >= 14 && trialDays.length === 14, `assistant=${assistantMessages.length}; days=${trialDays.length}`)
  record('LTD-REPLY-QUALITY', 'every long-term assistant reply passes secretary-style quality audit', failedAudits.length === 0, `passed=${assistantAudits.length - failedAudits.length}/${assistantAudits.length}; failures=${failedAudits.slice(0, 3).map((item) => `${item.day}:${item.audit.issues.join('+') || item.liveError}`).join(' | ') || 'none'}`)
  record('LTD-RISK-COVERAGE', 'trial covers long-term risks: perfunctory feedback, no response, reactance, fake done, not-true goal, too hard, wrong path and reality accident', ['连续敷衍', '装死不回复', '反感提醒', '证据不足', '目标不真', '任务太难', '路径错误', '现实意外'].every((risk) => trialDays.some((day) => day.risk === risk)), trialDays.map((day) => day.risk).join('/'))
  record('LTD-INTERVENTION-EFFECT', 'later plan becomes easier while long-term goal and KR remain intact', earlyMax > laterMax && finalKeyResults.every((kr) => kr.title && kr.targetValue), `earlyMax=${earlyMax}; laterMax=${laterMax}; kr=${finalKeyResults.map((kr) => `${kr.title}:${kr.progress}`).join('/')}`)
  record('LTD-USER-REPLY-WILLINGNESS', 'trial observes explicit user willingness signals instead of only internal state changes', willingnessSignals >= 2, `willingnessSignals=${willingnessSignals}`)
  record('LTD-LOGS', 'trial writes normal day and week Markdown logs, not a new log type', dayDocs.length >= 14 && weekDocs.length >= 2 && dayDocs.every((doc) => doc.frontmatter?.kind === 'daily_log'), `days=${dayDocs.length}; weeks=${weekDocs.length}`)
  record('LTD-LIVE-REPLIES', 'live mode uses real model replies for every day when explicitly enabled', shouldCallLiveModel ? liveReplyCount === trialDays.length : true, shouldCallLiveModel ? `liveReplies=${liveReplyCount}/${trialDays.length}` : 'not live; deterministic trial only')
}

function toMarkdown() {
  const failed = results.filter((item) => !item.ok)
  return [
    '# Long-term Dialogue Trial Verification',
    '',
    `- Time: ${new Date().toISOString()}`,
    `- Result: ${failed.length === 0 ? 'PASS' : 'FAIL'}`,
    `- Live model requested: ${runLive ? 'yes' : 'no'}`,
    `- Live model used: ${shouldCallLiveModel ? 'yes' : 'no'}`,
    `- Model: ${modelName}`,
    `- API base: ${apiBase}`,
    `- Test user: ${maskEmail(email)}`,
    `- Test data kept: ${keepData ? 'yes' : 'no'}`,
    '',
    'No API key is written to this report.',
    '',
    '| ID | Purpose | Result | Evidence |',
    '| --- | --- | --- | --- |',
    ...results.map((item) => `| ${item.id} | ${item.purpose} | ${item.ok ? 'PASS' : 'FAIL'} | ${String(item.evidence || '').replaceAll('|', '\\|').slice(0, 900)} |`),
    '',
  ].join('\n')
}

try {
  await runTrial()
} catch (error) {
  record('LTD-RUNTIME', 'long-term dialogue trial completes without crashing', false, error instanceof Error ? error.stack || error.message : String(error))
} finally {
  if (!keepData) {
    try {
      await cleanupUser()
      record('LTD-CLEANUP', 'temporary long-term dialogue trial user and data are removed', true, 'cleanup completed')
    } catch (error) {
      record('LTD-CLEANUP', 'temporary long-term dialogue trial user and data are removed', false, error instanceof Error ? error.message : String(error))
    }
  }
  await prisma.$disconnect()
}

const markdown = toMarkdown()
console.log(markdown)
if (shouldWrite) {
  writeFileSync(resolve(projectRoot, 'docs/plans/long-term-dialogue-trial-last-run.md'), markdown)
}

process.exit(results.every((item) => item.ok) ? 0 : 1)
