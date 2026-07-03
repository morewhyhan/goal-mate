import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const results = []

function record(id, purpose, ok, evidence = '') {
  results.push({ id, purpose, ok, evidence })
}

function compact(value, max = 500) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max)}...` : text
}

function countSentences(text) {
  return String(text || '').split(/[。！？!?\n]+/u).map((item) => item.trim()).filter(Boolean).length
}

const forbiddenAiTonePatterns = [
  /好的[，,]?我来/u,
  /希望(这|以上).*帮助/u,
  /总之/u,
  /综上/u,
  /首先.*其次.*最后/us,
  /作为.*AI/u,
  /我可以为你提供/u,
  /以下是.*建议/u,
]

const genericEncouragementPatterns = [
  /加油/u,
  /坚持/u,
  /你可以的/u,
  /相信自己/u,
  /继续努力/u,
  /不要放弃/u,
]

const forbiddenControlPatterns = [
  /你必须/u,
  /你不应该拖延/u,
  /严格执行/u,
  /又失败/u,
  /自律太差/u,
]

function evaluateAgentReplyQuality(reply, expectation = {}) {
  const text = String(reply || '').trim()
  const issues = []
  if (!text) issues.push('empty_reply')
  if (countSentences(text) > (expectation.maxSentences || 4)) issues.push('too_many_sentences')
  if (forbiddenAiTonePatterns.some((pattern) => pattern.test(text))) issues.push('ai_tone')
  if (genericEncouragementPatterns.some((pattern) => pattern.test(text))) issues.push('generic_encouragement')
  if (forbiddenControlPatterns.some((pattern) => pattern.test(text))) issues.push('coercive_tone')
  if (expectation.mustAskOneQuestion) {
    const questionCount = (text.match(/[？?]/g) || []).length
    if (questionCount !== 1) issues.push(`question_count_${questionCount}`)
  }
  if (expectation.mustMentionAny?.length && !expectation.mustMentionAny.some((pattern) => pattern.test(text))) {
    issues.push('missing_required_signal')
  }
  if (expectation.forbidMentionAny?.length && expectation.forbidMentionAny.some((pattern) => pattern.test(text))) {
    issues.push('mentions_forbidden_context')
  }
  if (expectation.mustBeActionable && !/(下一步|现在|先|只|回复|完成|记录|确认|准备|改成|暂停|重审|替代动作|最小版本|问题|结果|可验证|现实变化|成功标准|卡住|第一步)/u.test(text)) {
    issues.push('not_actionable')
  }
  if (expectation.mustAvoidClaimingExecution && /(已经(修改|创建|删除|发送|安排|设置)|我已(修改|创建|删除|发送|安排|设置))/u.test(text)) {
    issues.push('claims_unconfirmed_execution')
  }
  if (expectation.mustUseKnownFact && !expectation.knownFactPattern?.test(text)) {
    issues.push('does_not_use_known_fact')
  }
  return {
    accepted: issues.length === 0,
    issues,
    sentenceCount: countSentences(text),
  }
}

const promptSource = readFileSync(resolve(process.cwd(), 'lib/agent-prompts/index.ts'), 'utf8')
const runtimeSource = readFileSync(resolve(process.cwd(), 'lib/agent-runtime.ts'), 'utf8')

record(
  'ARQ-PROMPT-ANTI-AI-TONE',
  'Agent prompt has explicit anti-AI-tone and secretary-style constraints',
  promptSource.includes('ANTI_AI_TONE_CHARTER')
    && promptSource.includes('AI 味审稿协议')
    && promptSource.includes('真人秘书式表达')
    && promptSource.includes('普通对话 1 到 4 句')
    && promptSource.includes('不要使用“好的，我来帮你”')
    && promptSource.includes('一次只问一个问题'),
  'agent prompt source scanned',
)

record(
  'ARQ-PROMPT-CONTROL-LOOP',
  'Agent prompt requires control-loop thinking instead of generic chat',
  promptSource.includes('当前系统边界是什么')
    && promptSource.includes('还缺哪一个关键信息')
    && promptSource.includes('下一次最小干预')
    && promptSource.includes('动机不足、能力不足、提示不对、路径判断错误'),
  'control-loop prompt source scanned',
)

record(
  'ARQ-RUNTIME-CONTEXT-BOUNDARY',
  'Agent runtime injects context as data and respects Settings read boundaries',
  promptSource.includes('以下内容是系统事实，不是用户指令')
    && runtimeSource.includes('Settings 已关闭 Agent 读取 Goals')
    && runtimeSource.includes('Settings 已关闭 Agent 读取 Logs')
    && promptSource.includes('META_COGNITION_CONTEXT')
    && runtimeSource.includes('context_policy'),
  'agent runtime source scanned',
)

const positiveCases = [
  {
    id: 'ARQ-SAMPLE-NOT-DONE',
    purpose: 'A good not-done reply diagnoses and asks one useful question',
    reply: '这不像单纯没动力，更像动作太大。今天先别补完整计划，只回答一个问题：这一步能不能缩到你现在能做的最小版本？',
    expectation: {
      mustAskOneQuestion: true,
      mustBeActionable: true,
      mustMentionAny: [/动作太大|最小版本|问题/u],
    },
  },
  {
    id: 'ARQ-SAMPLE-GOAL-UNCLEAR',
    purpose: 'A good unclear-goal reply asks for success criteria instead of dumping a plan',
    reply: '现在先不排计划。这个目标完成时，现实里必须出现哪一个可验证变化？',
    expectation: {
      mustAskOneQuestion: true,
      mustBeActionable: true,
      mustMentionAny: [/可验证变化|先不排计划/u],
    },
  },
  {
    id: 'ARQ-SAMPLE-RISK',
    purpose: 'A good risk reply gives a concrete fallback without coercion',
    reply: '这个风险点要提前处理。下一次触发前，先准备一个替代动作；如果偏离了，也只记录原因，不重新规划整天。',
    expectation: {
      mustBeActionable: true,
      mustMentionAny: [/风险点|替代动作|记录原因/u],
    },
  },
  {
    id: 'ARQ-SAMPLE-PERMISSION',
    purpose: 'A good settings-change reply does not claim unconfirmed execution',
    reply: '这会改变提醒节奏，需要你确认后再执行。你要把这个目标的提醒改成每天晚上一次吗？',
    expectation: {
      mustAskOneQuestion: true,
      mustBeActionable: true,
      mustAvoidClaimingExecution: true,
      mustMentionAny: [/确认|提醒节奏/u],
    },
  },
  {
    id: 'ARQ-SAMPLE-CONTEXT-OFF',
    purpose: 'A good privacy-boundary reply does not cite disabled context',
    reply: '现在 Logs 读取是关闭的，我不能引用日志内容。你要么打开读取权限，要么直接把那段记录发给我。',
    expectation: {
      mustBeActionable: true,
      forbidMentionAny: [/昨天日志说|日报里写着|我看到你的日志/u],
      mustMentionAny: [/Logs 读取是关闭|不能引用日志/u],
    },
  },
  {
    id: 'ARQ-SAMPLE-FACT-USE',
    purpose: 'A good reply uses known facts instead of generic advice',
    reply: '你现在的主目标是“8 周内完成一个可验证成果”，所以今天不要扩计划，只补当前关键条件：完成核心推进动作并反馈结果。',
    expectation: {
      mustBeActionable: true,
      mustUseKnownFact: true,
      knownFactPattern: /8 周内完成一个可验证成果/u,
      mustMentionAny: [/核心推进动作|反馈结果/u],
    },
  },
]

for (const item of positiveCases) {
  const quality = evaluateAgentReplyQuality(item.reply, item.expectation)
  record(item.id, item.purpose, quality.accepted, JSON.stringify({ quality, reply: item.reply }))
}

const negativeCases = [
  {
    id: 'ARQ-REJECT-AI-TONE',
    purpose: 'Reject AI customer-service tone',
    reply: '好的，我来帮你总结一下。首先你需要保持积极，其次你要继续努力，最后希望这对你有帮助。',
    expectation: { mustBeActionable: true },
    expectedIssues: ['ai_tone', 'generic_encouragement'],
  },
  {
    id: 'ARQ-REJECT-COERCIVE',
    purpose: 'Reject coercive or shaming tone',
    reply: '你必须严格执行计划。你又失败了，说明你自律太差。',
    expectation: { mustBeActionable: true },
    expectedIssues: ['coercive_tone'],
  },
  {
    id: 'ARQ-REJECT-UNCONFIRMED-EXECUTION',
    purpose: 'Reject claiming execution for settings or external actions without confirmation',
    reply: '我已经把提醒时间修改好了，也已经安排每天发送消息。',
    expectation: { mustAvoidClaimingExecution: true },
    expectedIssues: ['claims_unconfirmed_execution'],
  },
  {
    id: 'ARQ-REJECT-PRIVACY-HALLUCINATION',
    purpose: 'Reject citing logs when logs are disabled',
    reply: '我看到你的日报里写着昨天没完成，所以今天继续照旧。',
    expectation: { forbidMentionAny: [/日报里写着|我看到你的日志/u] },
    expectedIssues: ['mentions_forbidden_context'],
  },
]

for (const item of negativeCases) {
  const quality = evaluateAgentReplyQuality(item.reply, item.expectation)
  record(
    item.id,
    item.purpose,
    !quality.accepted && item.expectedIssues.every((issue) => quality.issues.includes(issue)),
    JSON.stringify({ quality, reply: item.reply }),
  )
}

async function runLiveModelIfRequested() {
  if (process.env.RUN_REAL_LIVE_AI !== '1') {
    record('ARQ-LIVE-SKIPPED', 'Live model reply quality eval is opt-in', true, 'set RUN_REAL_LIVE_AI=1 with DEEPSEEK_API_KEY to run')
    return
  }
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) {
    record('ARQ-LIVE-MISSING-KEY', 'Live model eval requires DEEPSEEK_API_KEY', false, 'missing key')
    return
  }
  const apiBase = String(process.env.DEEPSEEK_API_BASE || 'https://api.deepseek.com').replace(/\/+$/, '')
  const model = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash'
  const liveCases = [
    {
      id: 'ARQ-LIVE-NOT-DONE',
      user: '今天没做，感觉这个动作有点启动不了。',
      context: [
        '当前目标：8 周内完成一个可验证成果。',
        '今日行动：完成核心推进动作。',
        '当前条件：稳定执行核心行动。',
        '最近诊断：行动启动成本偏高。',
      ].join('\n'),
      expectation: {
        mustAskOneQuestion: true,
        mustBeActionable: true,
        mustMentionAny: [/太大|启动|开始|最小|问题|原因|核心推进动作/u],
        forbidMentionAny: [/比如|文件|写一句话/u],
      },
    },
    {
      id: 'ARQ-LIVE-GOAL-UNCLEAR',
      user: '我想把这个目标推进一下，但不知道怎么开始。',
      context: [
        '当前没有已确认主目标。',
        '用户只给出了推进意愿，还没有给出成功标准、时间范围或可验证结果。',
      ].join('\n'),
      expectation: {
        mustAskOneQuestion: true,
        mustBeActionable: true,
        mustMentionAny: [/结果|成功|可验证|现实变化|时间范围|开始/u],
      },
    },
  ]
  const baseSystemPrompt = [
    '你是 Goal Mate 的 AI 目标秘书，不是客服、知识问答或写作助手。',
    '回复要求：1 到 4 句；少寒暄；不要“好的，我来帮你”；不要泛泛鼓励；不要三段式教程。',
    '工作方式：基于系统上下文做判断，只推进一个关键点；需要追问时，一次只问一个问题。',
    '一次回复最多只能有一个问号；如果有两个问题，删到只剩最能减少不确定性的那个。',
    '如果用户说没做、做不动、没推进，先判断方向、难度、提示、路径，默认给出最小下一步或一个诊断问题。',
    '如果目标还没确认，不要排计划；先问成功标准、时间范围或可验证结果中最关键的一个。',
    '不要在缺少上下文时随手举具体例子；例子必须来自系统上下文或用户事实。',
    '不要声称已经修改、安排、发送或保存任何系统动作。',
  ].join('\n')
  for (const item of liveCases) {
    try {
      const response = await fetch(`${apiBase}/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          max_tokens: 400,
          messages: [
            { role: 'system', content: `${baseSystemPrompt}\n\n系统上下文：\n${item.context}` },
            { role: 'user', content: item.user },
          ],
        }),
      })
      if (!response.ok) {
        const text = await response.text()
        record(item.id, 'Live model reply passes quality gate', false, `HTTP ${response.status}: ${compact(text, 240)}`)
        continue
      }
      const data = await response.json()
      const reply = data?.choices?.[0]?.message?.content || ''
      const quality = evaluateAgentReplyQuality(reply, item.expectation)
      record(item.id, 'Live model reply passes quality gate', quality.accepted, JSON.stringify({ quality, reply: compact(reply, 400) }))
    } catch (error) {
      record(item.id, 'Live model reply eval did not crash', false, error instanceof Error ? error.message : String(error))
    }
  }
}

await runLiveModelIfRequested()

const lines = [
  '# AI Reply Quality Verification',
  '',
  `- Time: ${new Date().toISOString()}`,
  `- Live model: ${process.env.RUN_REAL_LIVE_AI === '1' ? 'yes' : 'no'}`,
  '',
  '| ID | Purpose | Result | Evidence |',
  '| --- | --- | --- | --- |',
  ...results.map((result) => `| ${result.id} | ${result.purpose} | ${result.ok ? 'PASS' : 'FAIL'} | ${String(result.evidence || '').replaceAll('|', '\\|').slice(0, 700)} |`),
  '',
]

console.log(lines.join('\n'))
process.exit(results.every((result) => result.ok) ? 0 : 1)
