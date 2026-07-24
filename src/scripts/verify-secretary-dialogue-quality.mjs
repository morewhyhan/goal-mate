import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSecretarySchedulerReply, classifyQqSchedulerReply } from '../lib/qq-scheduler-reply.mjs'

const shouldWrite = process.argv.includes('--write')
const scriptDir = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(scriptDir, '..')
const projectRoot = resolve(appRoot, '..')
const results = []

function record(id, purpose, ok, evidence = '') {
  results.push({ id, purpose, ok, evidence })
}

function compact(value, max = 260) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max)}...` : text
}

function countSentences(text) {
  return String(text || '').split(/[。！？!?\n]+/u).map((item) => item.trim()).filter(Boolean).length
}

const forbiddenPatterns = [
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
]

function questionCount(text) {
  return (String(text || '').match(/[？?]/g) || []).length
}

function auditSecretaryReply(reply, expectation = {}) {
  const text = String(reply || '').trim()
  const issues = []
  if (!text) issues.push('empty')
  if (countSentences(text) > (expectation.maxSentences || 3)) issues.push('too_many_sentences')
  if (questionCount(text) > 1) issues.push('too_many_questions')
  if (/^\s*[-*]\s/m.test(text)) issues.push('bullet_list')
  if (text.length > (expectation.maxChars || 110)) issues.push('too_long')
  if (forbiddenPatterns.some((pattern) => pattern.test(text))) issues.push('forbidden_tone')
  if (expectation.mustAskOneQuestion && questionCount(text) !== 1) issues.push(`question_count_${questionCount(text)}`)
  if (expectation.mustNotAsk && questionCount(text) !== 0) issues.push('unwanted_question')
  if (expectation.mustMentionAny?.length && !expectation.mustMentionAny.some((pattern) => pattern.test(text))) {
    issues.push('missing_expected_signal')
  }
  if (expectation.mustBeActionable && !/(先|只|今天|明天|现在|下一次|保留|暂停|降级|重定义|确认|记录|记下|缩|打开|回复|止损|不加码|不追问|待确认|证据)/u.test(text)) {
    issues.push('not_actionable')
  }
  if (expectation.mustKeepLongTermGoal && !/(不改目标|不能改小目标|目标不缩水|动作缩小)/u.test(text)) {
    issues.push('goal_shrinkage_risk')
  }
  if (expectation.mustPauseOrRedefine && !/(暂停|重定义|放弃当前路径|先不推进|不催执行)/u.test(text)) {
    issues.push('missing_pause_or_redefine')
  }
  return { ok: issues.length === 0, issues, sentenceCount: countSentences(text), questionCount: questionCount(text), sample: compact(text) }
}

const dialogueScenarios = [
  {
    id: 'normal_progress',
    title: '正常推进',
    outcome: /不加码|打开项目|卡在哪里/u,
    turns: [
      { role: 'user', content: '今天走了十分钟，英语听了三分钟。' },
      { role: 'assistant', content: '记下了。今天先不加码，明天继续这两个最小动作，先看它能不能稳定发生。', expect: { mustBeActionable: true, mustMentionAny: [/不加码|稳定/u] } },
      { role: 'user', content: '那项目呢？' },
      { role: 'assistant', content: '项目今天先不抢时间。只留一个入口：睡前打开项目，写一句卡在哪里。', expect: { mustBeActionable: true, mustMentionAny: [/不抢时间|打开项目|卡在哪里/u] } },
    ],
  },
  {
    id: 'not_done',
    title: '未完成',
    outcome: /缩到|两分钟|启动/u,
    turns: [
      { role: 'user', content: '今天没做，一想到就烦。' },
      { role: 'assistant', content: '先不补计划。这个动作现在太大了；把它缩到两分钟，今晚只确认能不能启动。', expect: { mustBeActionable: true, mustMentionAny: [/先不补计划|太大|两分钟/u] } },
      { role: 'user', content: '两分钟好像可以。' },
      { role: 'assistant', content: '那今天就只算这个。完成两分钟就停，不用顺手加任务。', expect: { mustBeActionable: true, mustNotAsk: true, mustMentionAny: [/只算这个|不用顺手加任务/u] } },
    ],
  },
  {
    id: 'repeated_perfunctory',
    title: '连续敷衍',
    outcome: /一个词|不够用/u,
    turns: [
      { role: 'user', content: '随便吧，就这样。' },
      { role: 'assistant', content: '这个反馈不够用，我不会把它当成事实。今天只回一个词：太难、没兴趣、忘了、路径不对。', expect: { mustBeActionable: true, mustMentionAny: [/不够用|一个词/u] } },
      { role: 'user', content: '太难。' },
      { role: 'assistant', content: '收到。那不是继续催，明天动作直接降到能开始的最小版本。', expect: { mustBeActionable: true, mustNotAsk: true, mustMentionAny: [/不是继续催|最小版本/u] } },
    ],
  },
  {
    id: 'no_response',
    title: '装死不回复',
    outcome: /不追|晚上一次|最小入口/u,
    turns: [
      { role: 'user', content: '（一天没有回复）' },
      { role: 'assistant', content: '我不继续追消息。今天只留一个最小入口，晚上一次复盘就够了。', expect: { mustBeActionable: true, mustNotAsk: true, mustMentionAny: [/不继续追|晚上一次/u] } },
      { role: 'user', content: '晚上才看到。' },
      { role: 'assistant', content: '那就不补白天的账。现在只回做了或没做，别重新规划整天。', expect: { mustBeActionable: true, mustNotAsk: true, mustMentionAny: [/不补|做了或没做/u] } },
    ],
  },
  {
    id: 'topic_shift',
    title: '转移话题',
    outcome: /目标不会因为换话题消失|保留入口/u,
    turns: [
      { role: 'user', content: '先不说英语了，聊点别的。' },
      { role: 'assistant', content: '可以换话题，但目标不会因为换话题消失。英语今天只保留三分钟入口，不谈背诵。', expect: { mustBeActionable: true, mustMentionAny: [/换话题|保留三分钟/u] } },
      { role: 'user', content: '那就三分钟吧。' },
      { role: 'assistant', content: '就三分钟。先听完直接停，别把它变成新压力。', expect: { mustBeActionable: true, mustNotAsk: true, mustMentionAny: [/直接停|新压力/u] } },
    ],
  },
  {
    id: 'fake_done_no_evidence',
    title: '说做了但证据不足',
    outcome: /待确认|证据/u,
    turns: [
      { role: 'user', content: '做了。' },
      { role: 'assistant', content: '先记为待确认，不直接算完成。补一个证据：留下了什么痕迹？', expect: { mustBeActionable: true, mustAskOneQuestion: true, mustMentionAny: [/待确认|证据|痕迹/u] } },
      { role: 'user', content: '写了一句卡点。' },
      { role: 'assistant', content: '这就够了。今天按最小完成记，明天继续沿着这个卡点走。', expect: { mustBeActionable: true, mustNotAsk: true, mustMentionAny: [/最小完成|沿着这个卡点/u] } },
    ],
  },
  {
    id: 'goal_not_true',
    title: '目标不真',
    outcome: /暂停|重定义/u,
    turns: [
      { role: 'user', content: '我只是觉得应该学英语，其实没觉得它重要。' },
      { role: 'assistant', content: '那先暂停背诵。今天不推进英语，只确认这个目标要不要重定义。', expect: { mustBeActionable: true, mustPauseOrRedefine: true, mustMentionAny: [/暂停|重定义/u] } },
      { role: 'user', content: '可能我要的是能看懂文档。' },
      { role: 'assistant', content: '那目标换成看懂文档，不再用默写证明自己努力。下一步只找一段真实文档。', expect: { mustBeActionable: true, mustNotAsk: true, mustMentionAny: [/换成看懂文档|真实文档/u] } },
    ],
  },
  {
    id: 'too_hard',
    title: '任务太难',
    outcome: /动作缩小|不改目标/u,
    turns: [
      { role: 'user', content: '走路两小时太难了，我根本做不到。' },
      { role: 'assistant', content: '动作缩小，不改目标。今天只走十分钟，目标还是让身体管理重新可控。', expect: { mustBeActionable: true, mustKeepLongTermGoal: true, mustMentionAny: [/动作缩小|不改目标|十分钟/u] } },
      { role: 'user', content: '十分钟可以。' },
      { role: 'assistant', content: '那就十分钟。完成后不要追加，先让这个动作稳定出现。', expect: { mustBeActionable: true, mustNotAsk: true, mustMentionAny: [/不要追加|稳定出现/u] } },
    ],
  },
  {
    id: 'path_wrong',
    title: '路径错误',
    outcome: /补哪个缺口|先不写代码/u,
    turns: [
      { role: 'user', content: '代码我不知道从哪里改，感觉路径不对。' },
      { role: 'assistant', content: '先不写代码。今天只确认这一步补哪个缺口，别用忙碌替代推进。', expect: { mustBeActionable: true, mustMentionAny: [/先不写代码|补哪个缺口/u] } },
      { role: 'user', content: '缺口是 Agent 回复太像模板。' },
      { role: 'assistant', content: '那今天只改这一处：先抓一句最模板的话，把它改成真人能说的话。', expect: { mustBeActionable: true, mustNotAsk: true, mustMentionAny: [/只改这一处|真人能说的话/u] } },
    ],
  },
  {
    id: 'reality_accident',
    title: '现实意外',
    outcome: /止损|不补偿/u,
    turns: [
      { role: 'user', content: '今天家里有事，别安排太多。' },
      { role: 'assistant', content: '今天止损。只保留健康最小动作，不补偿、不加班、不重排整周。', expect: { mustBeActionable: true, mustNotAsk: true, mustMentionAny: [/止损|不补偿|不重排/u] } },
      { role: 'user', content: '那项目怎么办？' },
      { role: 'assistant', content: '项目今天暂停。明天先看现实约束解除没有，再恢复强度。', expect: { mustBeActionable: true, mustNotAsk: true, mustPauseOrRedefine: true, mustMentionAny: [/暂停|现实约束/u] } },
    ],
  },
  {
    id: 'reminder_reactance',
    title: '反感提醒',
    outcome: /减少打扰|晚上一次/u,
    turns: [
      { role: 'user', content: '别催了，看见提醒我就烦。' },
      { role: 'assistant', content: '收到，今天减少打扰。只保留晚上一次复盘，不用中午再追。', expect: { mustBeActionable: true, mustNotAsk: true, mustMentionAny: [/减少打扰|晚上一次/u] } },
      { role: 'user', content: '这样舒服一点。' },
      { role: 'assistant', content: '那这个节奏先保留三天。三天后只看一件事：你有没有更愿意回复？', expect: { mustBeActionable: true, mustAskOneQuestion: true, mustMentionAny: [/三天|更愿意回复/u] } },
    ],
  },
]

const promptSource = readFileSync(resolve(appRoot, 'lib/agent-prompts/index.ts'), 'utf8')
const qqSource = readFileSync(resolve(appRoot, 'lib/qq-scheduler-reply.mjs'), 'utf8')

record(
  'SDQ-PROMPT-SOURCE',
  'Prompt contains explicit multi-turn secretary dialogue rules',
  promptSource.includes('SECRETARY_DIALOGUE_POLICY')
    && promptSource.includes('不要把诊断标签说给用户听')
    && promptSource.includes('不做也可能是正确选择')
    && promptSource.includes('用户说完成但证据不足，先记为待确认'),
  'prompt source scanned',
)

record(
  'SDQ-QQ-SOURCE',
  'QQ scheduler reply uses secretary-style reply builder instead of mechanical category phrasing',
  qqSource.includes('buildSecretarySchedulerReply')
    && !qqSource.includes('更像是${formatReasonCategory')
    && qqSource.includes('先不催执行')
    && qqSource.includes('先记为待确认') === false,
  'qq scheduler reply source scanned',
)

for (const scenario of dialogueScenarios) {
  const assistantTurns = scenario.turns.filter((turn) => turn.role === 'assistant')
  const userTurns = scenario.turns.filter((turn) => turn.role === 'user')
  const audits = assistantTurns.map((turn) => auditSecretaryReply(turn.content, turn.expect || {}))
  const transcript = scenario.turns.map((turn) => turn.content).join('\n')
  const ok = userTurns.length >= 2
    && assistantTurns.length >= 2
    && audits.every((audit) => audit.ok)
    && /先|只|今天|明天|暂停|保留|不加码|待确认|重定义|止损|减少打扰/u.test(transcript)
    && scenario.outcome.test(transcript)
  record(
    `SDQ-SCENE-${scenario.id.toUpperCase()}`,
    `Multi-turn secretary dialogue handles ${scenario.title}`,
    ok,
    JSON.stringify({ audits, outcomeMatched: scenario.outcome.test(transcript), assistantTurns: assistantTurns.length }),
  )
}

const qqCases = [
  {
    text: '不想做，感觉没意义。',
    expect: [/先不催执行|值得继续/u],
    persisted: { title: '先不催执行，确认这个目标是否值得继续' },
  },
  {
    text: '太难了，时间不够。',
    expect: [/硬顶|切小|能启动/u],
    persisted: { title: '把动作切小到两分钟，先做到能启动' },
  },
  {
    text: '忘了，提醒太晚。',
    expect: [/风险点前|提示提前/u],
    persisted: {
      title: '把提示提前到风险点前',
      reminderAdjustment: {
        applied: true,
        previousSchedule: '0 21 * * *',
        newSchedule: '0 20 * * *',
      },
    },
  },
  {
    text: '路径不对，不知道从哪里改。',
    expect: [/补哪个缺口|不催/u],
    persisted: { title: '先确认要补哪个缺口，不催着继续执行' },
  },
  {
    text: '做完了。',
    expect: [/不加码|稳定重复/u],
    persisted: { title: '下一次不加码，先稳定重复这个最小动作' },
  },
  {
    text: '嗯',
    expect: [/不扩计划|保留/u],
    persisted: { title: '不扩计划，只保留当前最小动作' },
  },
]

const qqAudits = qqCases.map((item) => {
  const feedback = classifyQqSchedulerReply(item.text)
  const reply = buildSecretarySchedulerReply(feedback, {
    nextCommitment: {
      persisted: true,
      title: item.persisted.title,
    },
    reminderAdjustment: item.persisted.reminderAdjustment,
  })
  const audit = auditSecretaryReply(reply, { mustBeActionable: true, mustMentionAny: item.expect })
  return { text: item.text, feedback, reply, audit }
})

record(
  'SDQ-QQ-REPLIES',
  'QQ scheduler replies are natural secretary interventions across done, not-done and low-signal feedback',
  qqAudits.every((item) => item.audit.ok),
  JSON.stringify(qqAudits.map((item) => ({ text: item.text, result: item.feedback.result, reason: item.feedback.reasonCategory, audit: item.audit, reply: item.reply }))),
)

const coverage = {
  normal: dialogueScenarios.some((item) => item.id === 'normal_progress'),
  notDone: dialogueScenarios.some((item) => item.id === 'not_done'),
  perfunctory: dialogueScenarios.some((item) => item.id === 'repeated_perfunctory'),
  noResponse: dialogueScenarios.some((item) => item.id === 'no_response'),
  topicShift: dialogueScenarios.some((item) => item.id === 'topic_shift'),
  notTrue: dialogueScenarios.some((item) => item.id === 'goal_not_true'),
  tooHard: dialogueScenarios.some((item) => item.id === 'too_hard'),
  pathWrong: dialogueScenarios.some((item) => item.id === 'path_wrong'),
  realityAccident: dialogueScenarios.some((item) => item.id === 'reality_accident'),
  reactance: dialogueScenarios.some((item) => item.id === 'reminder_reactance'),
  evidenceDoubt: dialogueScenarios.some((item) => item.id === 'fake_done_no_evidence'),
}

record(
  'SDQ-COVERAGE',
  'Dialogue audit covers required strong-inertia and risk scenarios',
  Object.values(coverage).every(Boolean),
  JSON.stringify(coverage),
)

function toMarkdown() {
  const failed = results.filter((item) => !item.ok)
  return [
    '# Secretary Dialogue Quality Verification',
    '',
    `- Time: ${new Date().toISOString()}`,
    `- Result: ${failed.length === 0 ? 'PASS' : 'FAIL'}`,
    '',
    '| ID | Purpose | Result | Evidence |',
    '| --- | --- | --- | --- |',
    ...results.map((item) => `| ${item.id} | ${item.purpose} | ${item.ok ? 'PASS' : 'FAIL'} | ${String(item.evidence || '').replaceAll('|', '\\|').slice(0, 900)} |`),
    '',
  ].join('\n')
}

const markdown = toMarkdown()
console.log(markdown)
if (shouldWrite) {
  writeFileSync(resolve(projectRoot, 'docs/plans/secretary-dialogue-quality-last-run.md'), markdown)
}

process.exit(results.every((item) => item.ok) ? 0 : 1)
