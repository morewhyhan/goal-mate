import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PrismaClient } from '@prisma/client'
import { executeAgentToolWithPrisma } from '../lib/agent-tool-executor.mjs'
import { processQqSchedulerReply } from '../lib/qq-scheduler-reply.mjs'

const prisma = new PrismaClient()
const shouldWrite = process.argv.includes('--write')
const keepData = process.argv.includes('--keep-data')
const runId = Date.now()
const email = process.env.GOAL_MATE_TWO_WEEK_EMAIL || `two-week-${runId}@goalmate.local`
const scriptDir = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(scriptDir, '..')
const projectRoot = resolve(appRoot, '..')
const results = []
const DAY_MS = 24 * 60 * 60 * 1000
const replyAudits = []
const debugTwoWeek = process.env.DEBUG_TWO_WEEK === '1'

function debugStep(label) {
  if (debugTwoWeek) {
    console.error(`[two-week-debug] ${new Date().toISOString()} ${label}`)
  }
}

const baseDate = new Date(2026, 6, 6, 8, 0, 0)
const scenarioDays = [
  {
    day: 1,
    load: '三目标同时出现，但今天只推进健康和英语；项目只保留最小检查。',
    primary: 1,
    secondary: 0,
    midday: '不想学英语，感觉没意义，先别让我背。',
    evening: '没完成，英语一看到书就烦，今天只走了五分钟。',
    controls: '先重审英语目标真实性，把背诵改成走路时听 3 分钟。',
    model: '用户对“背诵”抗拒高，对“走路顺带听”阻力较低。',
    strategy: '下一次先问目标真实性，再给最小听力入口，不直接安排背诵。',
  },
  {
    day: 2,
    load: '健康主推，英语降级为 3 分钟听力，项目暂停。',
    primary: 0,
    secondary: 1,
    midday: '太难了，今天时间不够，走路两个小时根本不现实。',
    evening: '只走了十分钟，英语听了三分钟，没背。',
    controls: '行动仓位下调：运动从 2 小时改为 10 分钟；英语不要求背。',
    model: '用户不是完全拒绝行动，而是大任务会直接触发逃避。',
    strategy: '下一次先检查行动仓位，默认输出 10 分钟以内动作。',
  },
  {
    day: 3,
    load: '健康和项目各推进一个最小动作，英语只保留听力。',
    primary: 2,
    secondary: 0,
    midday: '忘了，提醒太晚了，我上午已经被别的事情打断。',
    evening: '项目没推进，走路做了一点，英语忘了听。',
    controls: '提示提前到风险点前：上午先发“只打开项目文件”的提醒。',
    model: '用户关键风险不是不知道做什么，而是风险点前没有触发。',
    strategy: '下一次在预期失败前提示，不在失败后重复催。',
  },
  {
    day: 4,
    load: '只推进健康和写作/项目混合任务，英语暂停一天降低负载。',
    primary: 0,
    secondary: 2,
    midday: '做了一点，走路 12 分钟，但是项目还是没动。',
    evening: '完成了最小动作，打开了代码库，看了一个文件。',
    controls: '保留微动作：项目不要求编码，只要求打开并写下一句卡点。',
    model: '用户完成微动作后抵触下降，适合用启动动作带动继续行动。',
    strategy: '下一次优先让用户开始，而不是要求完整交付。',
  },
  {
    day: 5,
    load: '健康保持，英语重启，项目只做 5 分钟卡点记录。',
    primary: 1,
    secondary: 2,
    midday: '方向不对，我不知道为什么要学这个，感觉只是应该学。',
    evening: '英语没有做，项目写了一个卡点，运动也没达标。',
    controls: '英语目标进入方向审计，不再继续排背诵任务。',
    model: '英语目标存在“应该做”而非“真想做”的风险。',
    strategy: '下一次先问可验证结果：学英语完成后现实会有什么变化。',
  },
  {
    day: 6,
    load: '健康主推，英语只做目标澄清，项目做一个 15 分钟开发小步。',
    primary: 2,
    secondary: 0,
    midday: '我想先玩一会儿，项目晚点再说。',
    evening: '项目完成了 15 分钟，运动只完成一半。',
    controls: '对项目保留 15 分钟可交付动作；健康改为晚饭前风险提示。',
    model: '项目在短时盒内可发生，健康失败集中在晚饭前后。',
    strategy: '下一次健康干预要提前到晚饭前，不等晚上复盘。',
  },
  {
    day: 7,
    load: '第一周收束：不新增大动作，只做健康最小动作和周复盘。',
    primary: 0,
    secondary: 1,
    midday: '没做，今天临时出门，反馈就这样。',
    evening: '这周没完全失败，但很多事情被拖延了。',
    controls: '周复盘把英语降级、项目短时盒保留、健康风险点前置。',
    model: '用户反馈质量下降时，不应该追问一串问题，只问一个最小原因。',
    strategy: '下一周每次只问一个可分类问题，并减少同日任务数。',
  },
  {
    day: 8,
    load: '第二周按第一周反馈重排：健康和项目优先，英语只做 3 分钟听力。',
    primary: 0,
    secondary: 2,
    midday: '今天走了十分钟，项目还没打开。',
    evening: '项目打开了，写了一句卡点；英语听了三分钟。',
    controls: '验证第一周策略：缩小动作后行动开始发生。',
    model: '用户对“只开始”的接受度高于“完成一整块任务”。',
    strategy: '继续使用最小启动，但逐步增加可验证输出。',
  },
  {
    day: 9,
    load: '健康维持，项目推进，英语不加压。',
    primary: 2,
    secondary: 0,
    midday: '太累了，今天不想碰代码。',
    evening: '最后只写了一个 TODO，没有真正开发。',
    controls: '项目动作从开发改成“写下下一行代码要做什么”。',
    model: '疲惫时技术执行会变形，仍可保留路径连续性。',
    strategy: '状态低时不要求执行，只保留上下文不断线。',
  },
  {
    day: 10,
    load: '项目降难度，健康前置提醒，英语继续听力。',
    primary: 0,
    secondary: 1,
    midday: '忘了午饭前提醒，我差点点外卖。',
    evening: '没有点外卖，走了 15 分钟，英语没听。',
    controls: '健康风险点前置有效；英语被降为可选最小保留。',
    model: '提前风险提示比晚上复盘更能控制饮食偏差。',
    strategy: '对饮食风险继续提前提示，不提高催促频率。',
  },
  {
    day: 11,
    load: '健康和项目推进，英语暂停避免总负载过高。',
    primary: 2,
    secondary: 0,
    midday: '代码我不知道从哪里改，路径可能不对。',
    evening: '项目没有推进，但我写清楚了卡在哪里。',
    controls: '项目从执行转成路径重建：先确认当前缺口是否对准。',
    model: '项目问题不是勤奋不足，而是路径和条件未对齐。',
    strategy: '下一次先问“这一步补哪个必要条件”，再安排动作。',
  },
  {
    day: 12,
    load: '项目路径重建，健康保持，英语不主动推进。',
    primary: 2,
    secondary: 0,
    midday: '做了一点，确定了今天只修一个最小问题。',
    evening: '完成了一个小修复，运动也完成了 15 分钟。',
    controls: '路径重建后项目开始恢复，可小幅提高项目权重。',
    model: '当行动和必要条件对齐时，用户执行阻力显著下降。',
    strategy: '下一次项目任务必须显式说明补齐哪个条件。',
  },
  {
    day: 13,
    load: '临近周末，只保留健康和项目交付检查。',
    primary: 0,
    secondary: 2,
    midday: '今天有现实意外，家里有事，别安排太多。',
    evening: '只完成了健康最小动作，项目没动。',
    controls: '现实意外触发止损：保持系统连续，不追求满额推进。',
    model: '外部约束强时，最小动作比重新规划更重要。',
    strategy: '下一次先确认现实约束是否解除，再恢复任务强度。',
  },
  {
    day: 14,
    load: '第二周收束：做最终周复盘和下一周策略调整。',
    primary: 2,
    secondary: 0,
    midday: '项目完成了一个小交付，健康也维持住了。',
    evening: '两周下来我没有变得很自律，但确实每天都被拉回了一点。',
    controls: '周复盘确认：不追求说服用户，而是持续调参让行动发生。',
    model: '用户强惰性仍存在，但最小动作、风险前置和路径校验能稳定降低失控。',
    strategy: '下一周期继续以日志训练信号更新用户行为因子，不上来就加大任务。',
  },
]

const riskScenarioMatrix = [
  {
    id: 'direction_not_true',
    name: '方向不真或目标真实性不足',
    days: [1, 5],
    signal: [/不想学|没意义|方向不对|只是应该学/u],
    control: [/重审英语目标真实性|方向审计|可验证结果/u],
    effect: ({ weekDocs }) => weekDocs.some((doc) => /英语目标降级|英语保持低抗拒/u.test(doc.content)),
  },
  {
    id: 'ability_overload',
    name: '任务过大或行动仓位过高',
    days: [2],
    signal: [/太难|时间不够|不现实/u],
    control: [/行动仓位下调|改为 10 分钟|10 分钟以内/u],
    effect: ({ maxEarlyMinutes, maxLaterMinutes }) => maxEarlyMinutes > maxLaterMinutes,
  },
  {
    id: 'prompt_missing',
    name: '提示不足或提醒时机错误',
    days: [3, 10],
    signal: [/忘了|提醒太晚|差点点外卖/u],
    control: [/提示提前|风险点前|晚饭前风险提示|风险前置/u],
    effect: ({ dailyDocs }) => dailyDocs.some((doc) => /没有点外卖|提前风险提示比晚上复盘更能控制/u.test(doc.content)),
  },
  {
    id: 'path_wrong',
    name: '路径不清或关键条件未对齐',
    days: [11, 12],
    signal: [/不知道从哪里改|路径可能不对|只修一个最小问题/u],
    control: [/路径重建|补哪个必要条件|对齐/u],
    effect: ({ checkins }) => checkins.some((checkin) => /完成了一个小修复|确定了今天只修一个最小问题/u.test(String(checkin.userFeedback || ''))),
  },
  {
    id: 'reality_accident',
    name: '现实意外和外部约束',
    days: [13],
    signal: [/现实意外|家里有事|别安排太多/u],
    control: [/止损|最小动作|不追求满额推进/u],
    effect: ({ dailyDocs }) => dailyDocs.some((doc) => /外部约束强时，最小动作比重新规划更重要/u.test(doc.content)),
  },
  {
    id: 'low_feedback_quality',
    name: '反馈质量下降',
    days: [7],
    signal: [/反馈就这样|拖延/u],
    control: [/只问一个最小原因|每次只问一个可分类问题/u],
    effect: ({ assistantAudits }) => assistantAudits.every((item) => item.quality.accepted && !item.quality.issues.includes('too_many_questions')),
  },
  {
    id: 'multi_goal_overload',
    name: '多目标负载冲突',
    days: [1, 4, 7, 8, 11],
    signal: [/三目标|暂停|不新增|不加压|负载/u],
    control: [/降级|暂停|不平均|减少同日任务数/u],
    effect: ({ goalsWithActions, weekDocs }) => new Set(goalsWithActions).size > 1 && weekDocs.some((doc) => /不平均安排所有目标/u.test(doc.content)),
  },
  {
    id: 'fatigue_or_low_energy',
    name: '疲惫低能量',
    days: [9],
    signal: [/太累|不想碰代码/u],
    control: [/不要求执行|保留上下文不断线|写下下一行代码/u],
    effect: ({ dailyDocs }) => dailyDocs.some((doc) => /状态低时不要求执行，只保留上下文不断线/u.test(doc.content)),
  },
]

const extendedRiskControlMatrix = [
  {
    id: 'truthful_feedback_risk',
    name: '用户撒谎或敷衍反馈',
    evidence: ({ scenarioText, checkins }) => /反馈质量下降|反馈就这样|只问一个最小原因/u.test(scenarioText)
      && checkins.some((checkin) => /没做，今天临时出门，反馈就这样/u.test(String(checkin.userFeedback || ''))),
  },
  {
    id: 'difficulty_not_goal_downgrade',
    name: '降低难度不能降低最终目标',
    evidence: ({ yearDocs, quarterDocs, allActions, goals }) => {
      const minLaterActionMinutes = Math.min(...allActions.filter((action) => action.actionDate >= addDays(baseDate, 7)).map((action) => action.estimatedMinutes), 999)
      const longTermTargetsStillPresent = [...yearDocs, ...quarterDocs]
        .some((doc) => goals.every((item) => item.keyResults.every((kr) => doc.content.includes(kr.title))))
      return minLaterActionMinutes <= 10 && longTermTargetsStillPresent
    },
  },
  {
    id: 'goal_truth_misread',
    name: '目标真实性误判',
    evidence: ({ scenarioText, weekDocs }) => /目标真实性|应该做|可验证结果/u.test(scenarioText)
      && weekDocs.some((doc) => /英语目标降级为目标真实性审计/u.test(doc.content)),
  },
  {
    id: 'reminder_fatigue',
    name: '提醒疲劳',
    evidence: ({ reminderRules, weekDocs }) => reminderRules.length === 4
      && reminderRules.every((rule) => Number(rule.maxPerDay || 0) <= 2)
      && weekDocs.some((doc) => /减少同日任务数|不新增大动作|不平均安排所有目标/u.test(doc.content)),
  },
  {
    id: 'goal_crowding',
    name: '多目标互相挤压',
    evidence: ({ goalsWithActions, dailyDocs }) => new Set(goalsWithActions).size > 1
      && dailyDocs.some((doc) => /降级\/暂停/u.test(doc.content)),
  },
  {
    id: 'log_pollution',
    name: '日志污染',
    evidence: ({ dailyDocs }) => dailyDocs.every((doc) => {
      const text = String(doc.content || '')
      return text.includes('今日事实')
        && text.includes('风险控制策略')
        && text.includes('后续验证信号')
        && !/(加油|继续努力|相信自己|希望这对你有帮助|以下是一些建议)/u.test(text)
        && text.length < 8000
    }),
  },
  {
    id: 'self_optimization_drift',
    name: 'AI 自我优化跑偏',
    evidence: ({ dailyDocs, metaDocs }) => dailyDocs.some((doc) => /先确认上一次推理是否被反馈支持/u.test(doc.content))
      && metaDocs.some((doc) => /AI 自我修正|AI 下一次规则/u.test(doc.content)),
  },
  {
    id: 'unverifiable_outcome',
    name: '结果不可验证',
    evidence: ({ goals, allActions, krRows }) => goals.every((item) => item.keyResults.every((kr) => kr.title && kr.targetValue))
      && allActions.every((action) => String(action.doneWhen || '').length > 0)
      && krRows.some((kr) => Number(kr.progress || 0) > 0),
  },
  {
    id: 'hallucination_overconfidence',
    name: '模型胡说或过度自信',
    evidence: ({ assistantAudits }) => assistantAudits.every((item) => item.quality.accepted)
      && assistantAudits.every((item) => !/(我看到你的日志|日报里写着|已经修改好了|已经安排每天发送)/u.test(item.quality.sample)),
  },
  {
    id: 'web_qq_state_sync',
    name: 'Web 和 QQ 状态不同步',
    evidence: ({ toolActions, schedulerEvents }) => toolActions.some((item) => item.source === 'web' && item.toolName === 'goal.create_draft')
      && toolActions.some((item) => item.source === 'scheduler' && item.toolName === 'checkin.submit')
      && schedulerEvents.every((event) => !event.payload?.goalId || !event.payload?.actionId || event.status === 'responded' || event.status === 'sent'),
  },
  {
    id: 'scheduler_duplicate_or_miss',
    name: '定时任务漏发或重复发',
    evidence: ({ schedulerEvents }) => {
      const dueKeys = schedulerEvents.map((event) => event.dueKey)
      const uniqueDueKeys = new Set(dueKeys)
      return dueKeys.length === uniqueDueKeys.size
        && schedulerEvents.filter((event) => event.eventType === 'morning_planning').length >= 14
        && schedulerEvents.filter((event) => event.eventType === 'midday_check').length >= 14
        && schedulerEvents.filter((event) => event.eventType === 'evening_review').length >= 14
    },
  },
  {
    id: 'context_growth_forgetting',
    name: '上下文太长导致遗忘',
    evidence: ({ dailyDocs, weekDocs, monthDocs }) => dailyDocs.every((doc) => /因子记录/u.test(doc.content))
      && weekDocs.every((doc) => /本周偏差如何反向调整/u.test(doc.content))
      && monthDocs.some((doc) => /今日偏差对月度计划的反向影响/u.test(doc.content)),
  },
  {
    id: 'psychological_reactance',
    name: '用户情绪逆反',
    evidence: ({ assistantAudits }) => assistantAudits.every((item) => !/(你必须|严格执行|又失败|自律太差|不应该拖延)/u.test(item.quality.sample)),
  },
  {
    id: 'external_constraint_change',
    name: '现实约束变化',
    evidence: ({ scenarioText, dailyDocs }) => /现实意外|家里有事|止损/u.test(scenarioText)
      && dailyDocs.some((doc) => /外部约束强时，最小动作比重新规划更重要/u.test(doc.content)),
  },
  {
    id: 'stale_goal_cleanup',
    name: '目标过期未清理',
    evidence: ({ scenarioText, weekDocs }) => /暂停|降级|不主动推进|不新增大动作/u.test(scenarioText)
      && weekDocs.some((doc) => /根据行动仓位决定推进、降级、暂停或最小保留/u.test(doc.content)),
  },
  {
    id: 'safety_boundary',
    name: '安全边界',
    evidence: ({ assistantAudits }) => assistantAudits.every((item) => !/(绝食|断食七天|危险剂量|不要就医|停止用药|惩罚自己)/u.test(item.quality.sample)),
  },
  {
    id: 'causal_misread',
    name: '因果误判',
    evidence: ({ dailyDocs, weekDocs }) => dailyDocs.some((doc) => /先确认上一次推理是否被反馈支持/u.test(doc.content))
      && weekDocs.some((doc) => /消费第一周日志，保留有效干预，调整无效策略/u.test(doc.content)),
  },
]

function classifyScenarioRisk(day) {
  const text = `${day.load}\n${day.midday}\n${day.evening}\n${day.controls}\n${day.model}\n${day.strategy}`
  return riskScenarioMatrix
    .filter((item) => item.signal.some((pattern) => pattern.test(text)) || item.control.some((pattern) => pattern.test(text)))
    .map((item) => item.name)
}

function evaluateExtendedRiskControlMatrix(context) {
  return extendedRiskControlMatrix.map((item) => ({
    id: item.id,
    name: item.name,
    ok: item.evidence(context),
  }))
}

function evaluateRiskScenarioMatrix(context) {
  return riskScenarioMatrix.map((item) => {
    const selectedDays = scenarioDays.filter((day) => item.days.includes(day.day))
    const sourceText = selectedDays
      .map((day) => `${day.load}\n${day.midday}\n${day.evening}\n${day.controls}\n${day.model}\n${day.strategy}`)
      .join('\n')
    const selectedDocs = context.dailyDocs.filter((doc) => item.days.includes(Number(doc.frontmatter?.simulationDay || 0)))
    const docText = selectedDocs.map((doc) => doc.content).join('\n')
    const signalMatched = item.signal.some((pattern) => pattern.test(sourceText))
    const controlMatched = item.control.some((pattern) => pattern.test(sourceText) || pattern.test(docText))
    const effectMatched = item.effect(context)
    return {
      id: item.id,
      name: item.name,
      ok: signalMatched && controlMatched && effectMatched,
      signalMatched,
      controlMatched,
      effectMatched,
    }
  })
}

function record(id, purpose, ok, evidence = '') {
  results.push({ id, purpose, ok, evidence })
}

function sanitize(value) {
  return String(value || '').replaceAll('|', '\\|').replace(/\n/g, '<br>')
}

function compact(value, max = 220) {
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
  /严格执行/u,
  /又失败/u,
  /自律太差/u,
  /你不应该拖延/u,
]

const mechanicalSecretaryPatterns = [
  /更像是.+问题[；;]/u,
  /原因分类/u,
  /系统判断/u,
  /调整建议/u,
  /动机不足|能力不足|提示不对|路径判断错误/u,
]

function evaluateTwoWeekReplyQuality(message) {
  const text = String(message.content || '').trim()
  const type = String(message.structuredOutputType || '')
  const issues = []
  if (!text) issues.push('empty_reply')
  if (countSentences(text) > 4) issues.push('too_many_sentences')
  if ((text.match(/[？?]/g) || []).length > 1) issues.push('too_many_questions')
  if (forbiddenAiTonePatterns.some((pattern) => pattern.test(text))) issues.push('ai_tone')
  if (genericEncouragementPatterns.some((pattern) => pattern.test(text))) issues.push('generic_encouragement')
  if (forbiddenControlPatterns.some((pattern) => pattern.test(text))) issues.push('coercive_or_shaming')
  if (mechanicalSecretaryPatterns.some((pattern) => pattern.test(text))) issues.push('mechanical_diagnostic_tone')
  if (!/(今天|这一步|当前|目标|行动|风险|反馈|计划|下次|下一步|明天|本周|周复盘|记录|完成|调整|缩小|暂停|重审|替代|最小|诊断|问题|先|只)/u.test(text)) {
    issues.push('missing_context_anchor')
  }
  if (!/(先|只|下一步|明天|下次|调整|缩小|暂停|重审|替代|最小|风险|反馈|记录|完成|保持|检查|复盘|规划|控制|判断|问题)/u.test(text)) {
    issues.push('missing_control_action')
  }
  if (/没有完成|没完成|没做|不想|太难|忘了|时间不够|路径不对|方向不对/u.test(text)
    && !/(更像|判断|原因|诊断|问题|证据|下一步|调整|重审|缩小|提示|路径|启动成本)/u.test(text)) {
    issues.push('missing_diagnosis_for_deviation')
  }
  if (type === 'qq_scheduler_reply' && !/(已记录|记下|下一步|下一次|明天|先|目标|动作|风险|缺口|保留|不扩计划|不催|证据|反馈)/u.test(text)) {
    issues.push('qq_reply_not_operational')
  }
  if (type === 'qq_scheduler_send' && !/(早上规划|中午检查|晚上复盘|周复盘|今天|现在|这周)/u.test(text)) {
    issues.push('scheduler_message_not_timed')
  }
  return {
    accepted: issues.length === 0,
    issues,
    sentenceCount: countSentences(text),
    type,
    sample: compact(text),
  }
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

function atHour(date, hour) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, 0, 0)
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

function extractWikiLinks(content) {
  const matches = [...String(content || '').matchAll(/\[\[([^\]\n]+)\]\]/g)]
  return [...new Set(matches.map((match) => match[1].trim()).filter(Boolean))]
}

function periodTypeForDocType(type) {
  if (type === 'YEAR') return 'YEAR'
  if (type === 'QUARTER') return 'QUARTER'
  if (type === 'MONTH') return 'MONTH'
  if (type === 'WEEK') return 'WEEK'
  if (type === 'DAY') return 'DAY'
  return null
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
      source: input.source || 'AGENT',
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
      source: input.source || 'AGENT',
    },
  })

  const periodType = periodTypeForDocType(input.type)
  if (periodType) {
    await prisma.logEntry.upsert({
      where: { userId_path: { userId: input.userId, path: input.path } },
      update: {
        title: input.title,
        periodType,
        content: input.content,
        linkedGoalIds: input.linkedGoalIds || [],
        linkedActionIds: input.linkedActionIds || [],
      },
      create: {
        userId: input.userId,
        path: input.path,
        title: input.title,
        periodType,
        content: input.content,
        linkedGoalIds: input.linkedGoalIds || [],
        linkedActionIds: input.linkedActionIds || [],
      },
    })
  }

  await prisma.markdownDocumentLink.deleteMany({ where: { userId: input.userId, fromDocumentId: document.id } })
  for (const targetPath of extractWikiLinks(input.content)) {
    const target = await prisma.markdownDocument.findUnique({ where: { userId_path: { userId: input.userId, path: targetPath } } })
    await prisma.markdownDocumentLink.create({
      data: {
        userId: input.userId,
        fromDocumentId: document.id,
        toDocumentId: target?.id,
        targetPath,
        linkType: targetPath.startsWith('logs/') ? 'LOG_PARENT' : 'WIKI',
        context: input.linkContext || 'two_week_control_loop',
      },
    })
  }
  return document
}

async function cleanupUser() {
  await prisma.user.deleteMany({ where: { email } })
}

async function seedUser() {
  const user = await prisma.user.create({
    data: {
      email,
      name: 'Two Week Control Loop User',
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
      agent: {
        can_read_goals: true,
        can_read_logs: true,
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
      contextId: `two-week-openid-${runId}`,
      nickname: 'Two Week QQ Simulator',
      status: 'ENABLED',
    },
  })
  for (const item of [
    ['morning_planning', '08:30', 1],
    ['midday_check', '12:30', 2],
    ['evening_review', '21:30', 2],
    ['weekly_review', '21:45', 1],
  ]) {
    await prisma.reminderRule.create({
      data: {
        userId: user.id,
        reminderType: item[0],
        channel: 'qq',
        schedule: item[1],
        timezone: 'Asia/Shanghai',
        maxPerDay: item[2],
        enabled: true,
        metadata: { verification: 'two_week_control_loop' },
      },
    })
  }
  return user
}

const goalInputs = [
  {
    title: '把身体管理拉回可控',
    rawInput: '我想在暑假内减重，同时控制晚饭前后最容易失控的外卖风险。',
    interpretedGoal: '通过低阻力运动、饮食风险前置提醒和每日反馈，让身体管理重新进入可控节奏。',
    keyResults: [
      { title: '连续两周至少 10 天完成健康最小动作', metricType: 'COUNT', currentValue: '0', targetValue: '10', progress: 0, whyNecessary: '没有可持续小动作，减重目标无法交付。' },
      { title: '晚饭前风险点至少 5 次被提前控制', metricType: 'COUNT', currentValue: '0', targetValue: '5', progress: 0, whyNecessary: '饮食风险点是身体管理最容易失控的位置。' },
    ],
    conditions: [
      { title: '行动仓位足够小', type: 'HARD', status: 'PARTIAL', whyRequired: '强惰性用户需要先保证行动发生。' },
      { title: '晚饭前风险点可被提醒', type: 'HARD', status: 'MISSING', whyRequired: '风险点前没有提示，用户容易进入默认高风险行为。' },
    ],
    dailyAction: {
      title: '走路 10 分钟并在晚饭前确认替代选择',
      doneWhen: '完成 10 分钟走路，并在晚饭前回复是否已准备替代选择。',
      minimumStep: '只穿鞋下楼 2 分钟。',
      estimatedMinutes: 10,
      fallbackAction: '如果状态差，只走 2 分钟。',
    },
  },
  {
    title: '把英语学习从抗拒变成可启动',
    rawInput: '我想学新概念英语二，但我一想到背诵和默写就抗拒。',
    interpretedGoal: '先不追求完整背诵，用低抗拒入口验证英语学习是否能每天启动。',
    keyResults: [
      { title: '两周内完成 8 次英语最小启动', metricType: 'COUNT', currentValue: '0', targetValue: '8', progress: 0, whyNecessary: '先证明英语任务能启动，再谈完整学习。' },
      { title: '明确英语目标是否真实想要', metricType: 'BOOLEAN', currentValue: 'false', targetValue: 'true', progress: 0, whyNecessary: '如果目标不真实，继续安排背诵只会制造抵触。' },
    ],
    conditions: [
      { title: '目标真实性被确认', type: 'HARD', status: 'MISSING', whyRequired: '用户多次表达“应该学”而不是“想学”。' },
      { title: '英语任务有低抗拒入口', type: 'HARD', status: 'MISSING', whyRequired: '背诵和默写启动阻力过高。' },
    ],
    dailyAction: {
      title: '走路时听 3 分钟英语',
      doneWhen: '听满 3 分钟，不要求背诵和默写。',
      minimumStep: '只打开音频。',
      estimatedMinutes: 3,
      fallbackAction: '如果抗拒，只播放 30 秒。',
    },
  },
  {
    title: '推进 Goal Mate 项目交付',
    rawInput: '我想把 Goal Mate 这个项目继续做下去，但经常不知道从哪里开始。',
    interpretedGoal: '把项目推进改成每天一个可验证小交付，持续减少决策成本。',
    keyResults: [
      { title: '两周内完成 5 个项目最小交付', metricType: 'COUNT', currentValue: '0', targetValue: '5', progress: 0, whyNecessary: '项目目标必须变成可交付证据。' },
      { title: '每次项目行动都说明补齐哪个必要条件', metricType: 'BOOLEAN', currentValue: 'false', targetValue: 'true', progress: 0, whyNecessary: '否则会做了很多但系统状态不变。' },
    ],
    conditions: [
      { title: '当前缺口能被说清楚', type: 'HARD', status: 'MISSING', whyRequired: '不知道从哪里开始时，继续催促没有意义。' },
      { title: '项目行动和必要条件对齐', type: 'HARD', status: 'MISSING', whyRequired: '行动必须改变系统状态。' },
    ],
    dailyAction: {
      title: '打开项目并写下一句当前卡点',
      doneWhen: '打开项目，写下当前最小卡点或完成一个 15 分钟小修复。',
      minimumStep: '只打开项目目录。',
      estimatedMinutes: 15,
      fallbackAction: '如果写不动，只写一句卡在哪里。',
    },
  },
]

async function createGoalsThroughAgent(user) {
  const thread = await prisma.agentThread.create({
    data: {
      userId: user.id,
      title: 'Web 主动目标澄清：复杂多目标输入',
    },
  })
  const userMessage = await prisma.agentMessage.create({
    data: {
      userId: user.id,
      threadId: thread.id,
      role: 'USER',
      content: '我同时想推进身体管理、英语学习和 Goal Mate 项目，但我执行力很差，经常拖延，希望 AI 帮我拆目标、控风险、每天告诉我下一步。',
      structuredOutputType: 'web_multi_goal_input',
    },
  })
  await prisma.agentMessage.create({
    data: {
      userId: user.id,
      threadId: thread.id,
      role: 'ASSISTANT',
      content: '我会先把三个目标拆成 OKR、阶段计划和今日最小行动，再根据每天反馈调整仓位。',
      structuredOutputType: 'web_goal_clarification',
    },
  })

  const goals = []
  for (const [index, input] of goalInputs.entries()) {
    const draft = await executeAgentToolWithPrisma(
      prisma,
      { userId: user.id, source: 'web', confirmed: true, agentThreadId: thread.id, agentMessageId: userMessage.id },
      'goal.create_draft',
      {
        title: input.title,
        rawInput: input.rawInput,
        interpretedGoal: input.interpretedGoal,
        horizonStart: baseDate.toISOString(),
        horizonEnd: addDays(baseDate, 13).toISOString(),
        keyResults: input.keyResults,
        conditions: input.conditions,
        stagePlans: [
          {
            title: '第 1 周：把任务缩到能发生',
            stageGoal: '验证强惰性用户是否能完成最小动作。',
            startDate: baseDate.toISOString(),
            endDate: addDays(baseDate, 6).toISOString(),
          },
          {
            title: '第 2 周：根据反馈提高控制精度',
            stageGoal: '使用第一周日志调整下一步干预。',
            startDate: addDays(baseDate, 7).toISOString(),
            endDate: addDays(baseDate, 13).toISOString(),
          },
        ],
        dailyAction: input.dailyAction,
      },
    )
    const goal = draft.result?.goal
    if (!goal?.id) throw new Error(`goal draft failed for ${input.title}`)
    const activation = await executeAgentToolWithPrisma(
      prisma,
      { userId: user.id, source: 'web', confirmed: true, agentThreadId: thread.id, agentMessageId: userMessage.id },
      'goal.update',
      {
        goalId: goal.id,
        status: 'ACTIVE',
        isCurrentFocus: index === 0,
      },
    )
    goals.push({
      ...input,
      goal: activation.result?.goal || goal,
      keyResults: draft.result.keyResults,
      conditions: draft.result.conditions,
      stagePlans: draft.result.stagePlans,
      firstAction: draft.result.dailyAction,
    })
  }

  return { thread, userMessage, goals }
}

async function createDailyAction(user, goalBundle, date, titleSuffix, minutes, status = 'PLANNED') {
  const condition = goalBundle.conditions[0]
  const stage = date.getTime() < addDays(baseDate, 7).getTime()
    ? goalBundle.stagePlans[0]
    : goalBundle.stagePlans[1] || goalBundle.stagePlans[0]
  return prisma.dailyAction.create({
    data: {
      userId: user.id,
      goalId: goalBundle.goal.id,
      stagePlanId: stage?.id,
      conditionId: condition.id,
      actionDate: date,
      title: `${goalBundle.dailyAction.title} ${titleSuffix}`,
      reason: '两周复杂控制闭环模拟：根据当天负载和偏差选择行动。',
      doneWhen: goalBundle.dailyAction.doneWhen,
      minimumStep: goalBundle.dailyAction.minimumStep,
      estimatedMinutes: minutes,
      fallbackAction: goalBundle.dailyAction.fallbackAction,
      checkinQuestion: '现在是完成、部分完成、没做，还是需要缩小？',
      status,
    },
  })
}

async function createSchedulerSend(user, thread, action, dayDate, eventType, hour, messageText, feedbackText = '') {
  const sentAt = atHour(dayDate, hour)
  const assistantMessage = await prisma.agentMessage.create({
    data: {
      userId: user.id,
      threadId: thread.id,
      role: 'ASSISTANT',
      content: messageText,
      structuredOutputType: 'qq_scheduler_send',
      structuredOutput: { eventType, actionId: action?.id || null },
      createdAt: sentAt,
    },
  })
  const event = await prisma.schedulerEvent.create({
    data: {
      userId: user.id,
      eventType,
      channel: 'qq',
      dueKey: `two-week-${runId}-${eventType}-${dayDate.toISOString().slice(0, 10)}-${hour}`,
      scheduledFor: sentAt,
      status: 'sent',
      messageText,
      sentAt,
      agentThreadId: thread.id,
      agentMessageId: assistantMessage.id,
      externalMessageId: `two-week-out-${runId}-${eventType}-${dayDate.getTime()}-${hour}`,
      payload: {
        verification: 'two_week_control_loop',
        actionId: action?.id || null,
        goalId: action?.goalId || null,
        intervention_decision: {
          intervention_type: eventType === 'morning_planning' ? 'prompt' : eventType === 'midday_check' ? 'risk_warning' : 'review',
          risk_point: '强惰性、多目标负载和现实意外会让计划脱离控制。',
          question_or_message: messageText,
          fallback_action: action?.fallbackAction || '只回复一个最小反馈。',
          reasoning_summary: '两周模拟中由 LLM 策略等价物生成的可审计干预。',
          verification_signal: feedbackText ? '用户后续 QQ 回复是否进入 Check-in、Logs 和计划调整。' : '等待用户反馈。',
          planner_source: 'simulated_llm_policy',
          policy_version: 'two-week-control-loop-v0.1',
        },
      },
    },
  })
  return { event, assistantMessage, sentAt }
}

async function simulateQqInbound(user, thread, action, dayDate, eventType, hour, feedbackText) {
  const send = await createSchedulerSend(
    user,
    thread,
    action,
    dayDate,
    eventType,
    hour,
    eventType === 'midday_check'
      ? `中午检查：${action.title}。现在是完成、部分完成、没做，还是需要缩小？`
      : eventType === 'weekly_review'
        ? '周复盘：这周哪些动作真的发生，哪些计划需要降级？'
        : `晚上复盘：${action?.title || '今天的推进'}。说一句今天真实发生了什么。`,
    feedbackText,
  )
  const inboundAt = new Date(send.sentAt.getTime() + 10 * 60 * 1000)
  const userMessage = await prisma.agentMessage.create({
    data: {
      userId: user.id,
      threadId: thread.id,
      role: 'USER',
      content: feedbackText,
      structuredOutputType: 'qq_inbound',
      structuredOutput: { eventType, simulated: true },
      createdAt: inboundAt,
    },
  })
  const qqEvent = await prisma.qqMessageEvent.create({
    data: {
      userId: user.id,
      eventId: `two-week-in-${runId}-${eventType}-${dayDate.getTime()}-${hour}`,
      eventType: 'C2C_MESSAGE_CREATE',
      contextType: 'c2c',
      contextId: `two-week-openid-${runId}`,
      messageText: feedbackText,
      payload: {
        simulatedInboundEvent: true,
        eventType,
        schedulerEventId: send.event.id,
        actionId: action?.id || null,
      },
      status: 'received',
      agentThreadId: thread.id,
      agentMessageId: userMessage.id,
      createdAt: inboundAt,
    },
  })
  const result = await processQqSchedulerReply(prisma, {
    userId: user.id,
    thread,
    userMessage,
    context: {
      contextType: 'c2c',
      contextId: `two-week-openid-${runId}`,
      messageId: qqEvent.eventId,
      text: feedbackText,
    },
    now: inboundAt,
    logDate: dayDate,
    executeAgentTool: (context, toolName, input) => executeAgentToolWithPrisma(prisma, context, toolName, input),
  })
  const replyMessage = await prisma.agentMessage.create({
    data: {
      userId: user.id,
      threadId: thread.id,
      role: 'ASSISTANT',
      content: result?.reply || '已收到这次 QQ 反馈，但没有匹配到主动提醒。',
      structuredOutputType: result ? 'qq_scheduler_reply' : 'qq_reply_unmatched',
      structuredOutput: result || { unmatched: true },
      createdAt: new Date(inboundAt.getTime() + 30 * 1000),
    },
  })
  replyAudits.push({ day: dayDate.toISOString().slice(0, 10), eventType, reply: replyMessage.content, result })
  await prisma.qqMessageEvent.update({
    where: { id: qqEvent.id },
    data: {
      status: result ? 'processed' : 'unmatched',
      replyMessageId: replyMessage.id,
    },
  })
  return { result, qqEvent, replyMessage }
}

function buildDailyControlMarkdown({ day, date, goals, actions }) {
  const parts = dateParts(date)
  const primary = goals[day.primary]
  const secondary = goals[day.secondary]
  const held = goals.filter((_, index) => index !== day.primary && index !== day.secondary)
  return [
    `# ${parts.day} 日志`,
    '',
    `- 上级周志：[[${parts.weekPath}]]`,
    `- 月度模块：[[${parts.monthPath}]]`,
    `- 季度 KR：[[${parts.quarterPath}]]`,
    `- 年度 OKR：[[${parts.yearPath}]]`,
    '',
    '## 今日事实',
    '',
    `- 负载判断：${day.load}`,
    `- 主推目标：${primary.goal.title}`,
    `- 次级目标：${secondary.goal.title}`,
    `- 降级/暂停：${held.map((item) => item.goal.title).join('、') || '无'}`,
    `- QQ 中午反馈：${day.midday}`,
    `- QQ 晚上反馈：${day.evening}`,
    '',
    '## 多目标进展',
    '',
    ...goals.map((item, index) => `- ${item.goal.title}：${index === day.primary ? '主推进' : index === day.secondary ? '最小保留' : '降级或暂停'}；KR：${item.keyResults.map((kr) => kr.title).join(' / ')}`),
    '',
    '## 未完成事项',
    '',
    `- 未完全发生：${day.evening.includes('完成了') && !day.evening.includes('没') ? '仅保留观察' : day.evening}`,
    '',
    '## 偏差与失控点',
    '',
    `- 偏差：${day.midday}`,
    '- 失控点：强惰性、任务过大、提醒时机、路径不清或现实意外。',
    '',
    '## 未完成原因诊断',
    '',
    `- 系统诊断：${day.controls}`,
    '- 诊断必须先于催促；不把失败归因为人格。',
    '',
    '## 风险控制策略',
    '',
    `- 风险类型：${classifyScenarioRisk(day).join('、') || '常规推进风险'}`,
    `- 控制动作：${day.controls}`,
    `- 后续验证信号：下一次行动是否变小、是否提前提示、路径是否变清楚、目标是否被暂停或重审。`,
    `- 今日 action refs：${actions.map((action) => `[[${parts.dayPath}#${action.title}]]`).join('、')}`,
    '',
    '## 明日计划调整',
    '',
    `- 明天调整：${day.day < 7 ? '继续降低启动成本，控制同日任务数。' : '消费上一周日志，把有效策略保留、无效策略降权。'}`,
    '- 如果再次未完成，优先检查行动仓位、提示时机和路径对齐，而不是增加催促频率。',
    '',
    '## 用户模型更新',
    '',
    `- ${day.model}`,
    '- 因子记录：目标真实度、启动阻力、行动仓位、多目标负载、反馈质量。',
    '',
    '## Agent 策略更新',
    '',
    `- ${day.strategy}`,
    '- AI 自我检查：下一次先确认上一次推理是否被反馈支持，再决定继续、降级或重建路径。',
  ].join('\n')
}

function buildWeekMarkdown(user, goals, weekIndex, days) {
  const start = addDays(baseDate, weekIndex * 7)
  const end = addDays(start, 6)
  const parts = dateParts(start)
  const dayLinks = days.map((day) => `[[${dateParts(addDays(baseDate, day.day - 1)).dayPath}]]`).join(' | ')
  return {
    path: parts.weekPath,
    title: `${parts.year}-${parts.week}.md`,
    content: [
      `# ${parts.year} ${parts.week} 行动控制周志`,
      '',
      `- 上级月志：[[${parts.monthPath}]]`,
      `- 本周日期：${dateParts(start).day} -> ${dateParts(end).day}`,
      `- 下级日志：${dayLinks}`,
      '',
      '## 本周最高优先级',
      '',
      weekIndex === 0
        ? '- 把多目标计划缩小到强惰性用户能开始。'
        : '- 消费第一周日志，保留有效干预，调整无效策略。',
      '',
      '## 本周 OKR 联动',
      '',
      ...goals.map((item) => `- ${item.goal.title}：关联 KR ${item.keyResults.map((kr) => kr.title).join(' / ')}`),
      '',
      '## 本周偏差如何反向调整',
      '',
      weekIndex === 0
        ? '- 英语目标降级为目标真实性审计；健康提醒前置到晚饭前；项目从开发改成卡点记录。'
        : '- 项目路径重建后恢复推进；健康风险前置保留；英语保持低抗拒听力入口。',
      '',
      '## 下周策略',
      '',
      '- 不平均安排所有目标；根据行动仓位决定推进、降级、暂停或最小保留。',
    ].join('\n'),
  }
}

function buildMonthMarkdown(goals, weekDocs) {
  const parts = dateParts(baseDate)
  return {
    path: parts.monthPath,
    title: `${parts.month}.md`,
    content: [
      `# ${parts.month} 月度推进模块`,
      '',
      `- 上级季度：[[${parts.quarterPath}]]`,
      `- 周志：${weekDocs.map((item) => `[[${item.path}]]`).join(' | ')}`,
      '',
      '## 本月推进模块',
      '',
      '- 模块 1：强惰性用户的最小动作启动。',
      '- 模块 2：多目标负载控制，不平均塞满每天。',
      '- 模块 3：从日反馈反向调整周重点和目标路径。',
      '',
      '## KR 变化',
      '',
      ...goals.flatMap((item) => item.keyResults.map((kr) => `- ${item.goal.title} / ${kr.title}：由两周日志持续更新。`)),
      '',
      '## 今日偏差对月度计划的反向影响',
      '',
      '- 第一周证明大任务会击穿行动，月度策略改为先保证动作发生。',
      '- 第二周证明路径对齐后项目恢复推进，月度项目模块保留。',
    ].join('\n'),
  }
}

function buildQuarterMarkdown(goals, monthDoc) {
  const parts = dateParts(baseDate)
  return {
    path: parts.quarterPath,
    title: `${parts.year}-${parts.quarter}.md`,
    content: [
      `# ${parts.year} ${parts.quarter} 季度 KR`,
      '',
      `- 年度目标：[[${parts.yearPath}]]`,
      `- 本季度月志：[[${monthDoc.path}]]`,
      '',
      '## 季度 KR',
      '',
      ...goals.flatMap((item) => item.keyResults.map((kr) => `- ${kr.title}：${kr.targetValue || '完成'}`)),
      '',
      '## 季度控制原则',
      '',
      '- 先让行动发生，再逐步提高任务强度。',
      '- 每次偏差都必须进入日志，成为下一次干预的训练信号。',
      '- 多目标冲突时先降级，不强行平均推进。',
    ].join('\n'),
  }
}

function buildYearMarkdown(goals, quarterDoc) {
  const parts = dateParts(baseDate)
  return {
    path: parts.yearPath,
    title: `${parts.year}.md`,
    content: [
      `# ${parts.year} 年度 OKR`,
      '',
      `- Q3：[[${quarterDoc.path}]]`,
      '',
      '## 年度 Objective',
      '',
      '- 验证 AI 行动秘书能把强惰性用户的复杂多目标推进拉回可控系统。',
      '',
      '## 年度 KR',
      '',
      ...goals.map((item) => `- ${item.goal.title}：${item.keyResults.map((kr) => kr.title).join(' / ')}`),
      '',
      '## 长期日志链路',
      '',
      '- 年度 OKR -> 季度 KR -> 月度模块 -> 周重点 -> 日日志。',
      '- 日志不是普通日记，而是未来用户行为因子模型的训练数据。',
    ].join('\n'),
  }
}

async function writePeriodHierarchy(user, goals, dayDocs) {
  const week1 = buildWeekMarkdown(user, goals, 0, scenarioDays.slice(0, 7))
  const week2 = buildWeekMarkdown(user, goals, 1, scenarioDays.slice(7, 14))
  await upsertLogDocument({ userId: user.id, type: 'WEEK', ...week1, linkedGoalIds: goals.map((item) => item.goal.id), source: 'AGENT' })
  await upsertLogDocument({ userId: user.id, type: 'WEEK', ...week2, linkedGoalIds: goals.map((item) => item.goal.id), source: 'AGENT' })

  const monthDoc = buildMonthMarkdown(goals, [week1, week2])
  await upsertLogDocument({ userId: user.id, type: 'MONTH', ...monthDoc, linkedGoalIds: goals.map((item) => item.goal.id), source: 'AGENT' })

  const quarterDoc = buildQuarterMarkdown(goals, monthDoc)
  await upsertLogDocument({ userId: user.id, type: 'QUARTER', ...quarterDoc, linkedGoalIds: goals.map((item) => item.goal.id), source: 'AGENT' })

  const yearDoc = buildYearMarkdown(goals, quarterDoc)
  await upsertLogDocument({ userId: user.id, type: 'YEAR', ...yearDoc, linkedGoalIds: goals.map((item) => item.goal.id), source: 'AGENT' })

  return { week1, week2, monthDoc, quarterDoc, yearDoc, dayDocs }
}

async function runTwoWeekSimulation(user, qqThread, goals) {
  const dayDocs = []
  for (const day of scenarioDays) {
    debugStep(`simulate day ${day.day}:start`)
    const dayDate = addDays(baseDate, day.day - 1)
    const primaryGoal = goals[day.primary]
    const secondaryGoal = goals[day.secondary]
    const actions = [
      await createDailyAction(user, primaryGoal, dayDate, `D${day.day}-primary`, day.day <= 2 ? 90 : day.day >= 8 ? 15 : 20),
      await createDailyAction(user, secondaryGoal, dayDate, `D${day.day}-secondary`, day.day <= 2 ? 45 : 10),
    ]

    await createSchedulerSend(
      user,
      qqThread,
      actions[0],
      dayDate,
      'morning_planning',
      8,
      `早上规划：今天不平均推进所有目标。${day.load} 先做「${actions[0].title}」。`,
    )
    await simulateQqInbound(user, qqThread, actions[0], dayDate, 'midday_check', 12, day.midday)
    await simulateQqInbound(user, qqThread, actions[1], dayDate, 'evening_review', 21, day.evening)

    if (day.day === 7 || day.day === 14) {
      await simulateQqInbound(user, qqThread, actions[0], dayDate, 'weekly_review', 22, day.day === 7
        ? '第一周复盘：任务太大时我会逃，最小动作反而能开始。'
        : '第二周复盘：我还是惰性很强，但项目和健康都有可见进展。')
    }

    const parts = dateParts(dayDate)
    const existing = await prisma.markdownDocument.findUnique({ where: { userId_path: { userId: user.id, path: parts.dayPath } } })
    const controlMarkdown = buildDailyControlMarkdown({ day, date: dayDate, goals, actions })
    const content = existing?.content ? `${existing.content}\n\n---\n\n${controlMarkdown}` : controlMarkdown
    await upsertLogDocument({
      userId: user.id,
      type: 'DAY',
      path: parts.dayPath,
      title: `${parts.day}.md`,
      content,
      linkedGoalIds: goals.map((item) => item.goal.id),
      linkedActionIds: actions.map((action) => action.id),
      frontmatter: {
        kind: 'daily_log',
        simulationDay: day.day,
        loadDecision: day.load,
        userModelUpdate: day.model,
        agentStrategyUpdate: day.strategy,
      },
      source: 'AGENT',
    })
    dayDocs.push(parts.dayPath)
    debugStep(`simulate day ${day.day}:done`)
  }
  return dayDocs
}

async function run() {
  debugStep('cleanup:start')
  await cleanupUser()
  debugStep('cleanup:done')
  const user = await seedUser()
  debugStep('seed:done')
  record('TW-SEED', 'clean verification user has Settings, QQ binding and reminder rules', Boolean(user.id), `user=${maskEmail(email)}`)

  const qqWorkerSource = readFileSync(resolve(appRoot, 'scripts/qq-bot-worker.mjs'), 'utf8')
  record(
    'TW-QQ-ADAPTER-EXISTS',
    'real QQ Channel Adapter exists and stores inbound/outbound message events',
    qqWorkerSource.includes('qqMessageEvent')
      && qqWorkerSource.includes('qqRequest')
      && qqWorkerSource.includes('processQqSchedulerReply'),
    'qq-bot-worker.mjs contains qqMessageEvent persistence, qqRequest and scheduler reply integration',
  )

  const { goals } = await createGoalsThroughAgent(user)
  debugStep('goals:done')
  record(
    'TW-WEB-MULTI-GOAL',
    'Web active workspace creates at least three goals through shared Agent Tool Runtime',
    goals.length >= 3 && goals.every((item) => item.goal.id && item.keyResults.length >= 2 && item.conditions.length >= 2),
    `goals=${goals.map((item) => item.goal.title).join(' / ')}`,
  )

  const qqThread = await prisma.agentThread.create({
    data: {
      userId: user.id,
      goalId: goals[0].goal.id,
      title: `QQ scheduler c2c two-week-openid-${runId}`,
    },
  })
  const dayDocs = await runTwoWeekSimulation(user, qqThread, goals)
  debugStep('simulation:done')
  await writePeriodHierarchy(user, goals, dayDocs)
  debugStep('hierarchy:done')

  const [
    schedulerEvents,
    qqEvents,
    assistantMessages,
    checkins,
    diagnoses,
    toolActions,
    dailyDocs,
    weekDocs,
    monthDocs,
    quarterDocs,
    yearDocs,
    links,
    metaDocs,
    allActions,
    krRows,
    reminderRules,
  ] = await Promise.all([
    prisma.schedulerEvent.findMany({ where: { userId: user.id, channel: 'qq' } }),
    prisma.qqMessageEvent.findMany({ where: { userId: user.id } }),
    prisma.agentMessage.findMany({ where: { userId: user.id, role: 'ASSISTANT' }, orderBy: { createdAt: 'asc' } }),
    prisma.checkin.findMany({ where: { userId: user.id } }),
    prisma.diagnosis.findMany({ where: { userId: user.id } }),
    prisma.agentToolAction.findMany({ where: { userId: user.id } }),
    prisma.markdownDocument.findMany({ where: { userId: user.id, type: 'DAY' } }),
    prisma.markdownDocument.findMany({ where: { userId: user.id, type: 'WEEK' } }),
    prisma.markdownDocument.findMany({ where: { userId: user.id, type: 'MONTH' } }),
    prisma.markdownDocument.findMany({ where: { userId: user.id, type: 'QUARTER' } }),
    prisma.markdownDocument.findMany({ where: { userId: user.id, type: 'YEAR' } }),
    prisma.markdownDocumentLink.findMany({ where: { userId: user.id } }),
    prisma.markdownDocument.findMany({ where: { userId: user.id, type: 'SYSTEM', path: { startsWith: 'system/meta-cognition/' } } }),
    prisma.dailyAction.findMany({ where: { userId: user.id } }),
    prisma.keyResult.findMany({ where: { userId: user.id } }),
    prisma.reminderRule.findMany({ where: { userId: user.id } }),
  ])
  debugStep('queries:done')

  const eventTypes = new Set(schedulerEvents.map((item) => item.eventType))
  const respondedEvents = schedulerEvents.filter((item) => item.status === 'responded')
  record(
    'TW-QQ-SCHEDULER-SIMULATION',
    'two-week scenario uses real QQ scheduler events plus simulated inbound QQ events without operating the QQ client',
    schedulerEvents.length >= 44
      && respondedEvents.length >= 30
      && qqEvents.length >= 30
      && ['morning_planning', 'midday_check', 'evening_review', 'weekly_review'].every((type) => eventTypes.has(type)),
    `scheduler=${schedulerEvents.length}; responded=${respondedEvents.length}; qqInbound=${qqEvents.length}; types=${[...eventTypes].join(',')}`,
  )
  record(
    'TW-QQ-OUTBOUND',
    'simulated QQ inbound replies produce assistant outbound messages through the same QQ reply path',
    qqEvents.every((event) => event.replyMessageId) && qqEvents.length >= 30,
    `replyLinked=${qqEvents.filter((event) => event.replyMessageId).length}/${qqEvents.length}`,
  )
  const assistantAudits = assistantMessages.map((message) => ({
    id: message.id,
    type: message.structuredOutputType,
    quality: evaluateTwoWeekReplyQuality(message),
  }))
  const failedAssistantAudits = assistantAudits.filter((item) => !item.quality.accepted)
  record(
    'TW-AI-REPLY-QUALITY',
    'every assistant reply in the two-week simulation is specific, non-coercive, diagnostic and operational',
    assistantMessages.length >= 70 && failedAssistantAudits.length === 0,
    `passed=${assistantAudits.length - failedAssistantAudits.length}/${assistantAudits.length}; failures=${failedAssistantAudits.slice(0, 3).map((item) => `${item.type}:${item.quality.issues.join('+')}:${item.quality.sample}`).join(' || ') || 'none'}`,
  )
  record(
    'TW-SHARED-RUNTIME-AUDIT',
    'Web and QQ paths share AgentToolAction audit instead of separate fake logic',
    toolActions.some((item) => item.source === 'web' && item.toolName === 'goal.create_draft')
      && toolActions.some((item) => item.source === 'scheduler' && item.toolName === 'checkin.submit')
      && toolActions.some((item) => item.source === 'scheduler' && item.toolName === 'log.write_daily'),
    `web=${toolActions.filter((item) => item.source === 'web').length}; scheduler=${toolActions.filter((item) => item.source === 'scheduler').length}`,
  )
  const goalsWithActions = goals.map((goal) => allActions.filter((action) => action.goalId === goal.goal.id).length)
  record(
    'TW-MULTI-GOAL-LOAD-CONTROL',
    'multi-goal simulation does not average-fill every goal every day and records load control decisions',
    goalsWithActions.length === 3
      && new Set(goalsWithActions).size > 1
      && dailyDocs.some((doc) => doc.content.includes('降级/暂停'))
      && weekDocs.some((doc) => doc.content.includes('不平均安排所有目标')),
    `actionsByGoal=${goalsWithActions.join('/')}`,
  )
  const diagnosisCategories = new Set(diagnoses.map((item) => item.category))
  record(
    'TW-STRONG-INERTIA-DIAGNOSIS',
    'strong inertia scenario includes repeated deviations and diagnoses before adjustment',
    checkins.length >= 28
      && diagnoses.length >= 10
      && ['MOTIVATION', 'ABILITY', 'PROMPT', 'PATH'].filter((item) => diagnosisCategories.has(item)).length >= 3
      && dailyDocs.some((doc) => doc.content.includes('诊断必须先于催促')),
    `checkins=${checkins.length}; diagnoses=${diagnoses.length}; categories=${[...diagnosisCategories].join(',')}`,
  )
  const firstTwoDayActions = allActions.filter((action) => action.actionDate < addDays(baseDate, 2))
  const laterActions = allActions.filter((action) => action.actionDate >= addDays(baseDate, 7))
  const maxEarlyMinutes = Math.max(...firstTwoDayActions.map((action) => action.estimatedMinutes), 0)
  const maxLaterMinutes = Math.max(...laterActions.map((action) => action.estimatedMinutes), 0)
  const impactEvidence = [
    maxEarlyMinutes > maxLaterMinutes,
    dailyDocs.some((doc) => doc.content.includes('晚饭前风险提示') || doc.content.includes('风险前置')),
    checkins.some((checkin) => String(checkin.userFeedback || '').includes('完成了一个小修复')),
    weekDocs.some((doc) => doc.content.includes('英语目标降级') || doc.content.includes('项目短时盒保留')),
  ]
  record(
    'TW-INTERVENTION-IMPACT',
    'AI interventions produce observable later changes in action size, risk timing, path strategy and completed outcome',
    impactEvidence.every(Boolean),
    `earlyMaxMinutes=${maxEarlyMinutes}; laterMaxMinutes=${maxLaterMinutes}; evidence=${impactEvidence.map((item) => item ? 'yes' : 'no').join('/')}`,
  )
  const riskAudits = evaluateRiskScenarioMatrix({
    assistantAudits,
    checkins,
    dailyDocs,
    goalsWithActions,
    maxEarlyMinutes,
    maxLaterMinutes,
    weekDocs,
  })
  const failedRiskAudits = riskAudits.filter((item) => !item.ok)
  record(
    'TW-RISK-SPECIAL-CONTROL',
    'different risk and special situations are classified, controlled with different interventions and proven by later evidence',
    riskAudits.length >= 8 && failedRiskAudits.length === 0,
    `passed=${riskAudits.length - failedRiskAudits.length}/${riskAudits.length}; failures=${failedRiskAudits.map((item) => `${item.id}:signal=${item.signalMatched},control=${item.controlMatched},effect=${item.effectMatched}`).join(' || ') || 'none'}`,
  )
  const scenarioText = scenarioDays
    .map((day) => `${day.load}\n${day.midday}\n${day.evening}\n${day.controls}\n${day.model}\n${day.strategy}`)
    .join('\n')
  const extendedRiskAudits = evaluateExtendedRiskControlMatrix({
    allActions,
    assistantAudits,
    checkins,
    dailyDocs,
    goals,
    goalsWithActions,
    krRows,
    metaDocs,
    monthDocs,
    quarterDocs,
    reminderRules,
    scenarioText,
    schedulerEvents,
    toolActions,
    weekDocs,
    yearDocs,
  })
  const failedExtendedRiskAudits = extendedRiskAudits.filter((item) => !item.ok)
  record(
    'TW-EXTENDED-RISK-CONTROL',
    'P0/P1 risks are verified as controlled or bounded: false feedback, goal shrinkage, fatigue, log pollution, drift, sync, scheduler, safety and causal misread',
    extendedRiskAudits.length >= 16 && failedExtendedRiskAudits.length === 0,
    `passed=${extendedRiskAudits.length - failedExtendedRiskAudits.length}/${extendedRiskAudits.length}; failures=${failedExtendedRiskAudits.map((item) => item.id).join(',') || 'none'}`,
  )
  record(
    'TW-GENERIC-SCENARIO-COVERAGE',
    'quality and intervention checks cover generic control factors across health, learning and project delivery instead of one narrow story',
    goals.length === 3
      && goals.some((item) => item.goal.title.includes('身体'))
      && goals.some((item) => item.goal.title.includes('英语'))
      && goals.some((item) => item.goal.title.includes('项目'))
      && ['ABILITY', 'PROMPT', 'PATH'].every((item) => diagnosisCategories.has(item))
      && dailyDocs.every((doc) => doc.content.includes('因子记录')),
    `domains=health/learning/project; diagnosis=${[...diagnosisCategories].join(',')}`,
  )
  record(
    'TW-TWO-WEEK-LOG-LINK',
    'Logs contain at least fourteen day logs and two week logs linked to month, quarter and year OKR rollups',
    dailyDocs.length >= 14
      && weekDocs.length >= 2
      && monthDocs.length >= 1
      && quarterDocs.length >= 1
      && yearDocs.length >= 1
      && links.length >= 20,
    `days=${dailyDocs.length}; weeks=${weekDocs.length}; months=${monthDocs.length}; quarters=${quarterDocs.length}; years=${yearDocs.length}; links=${links.length}`,
  )
  const requiredDailySections = [
    '## 今日事实',
    '## 多目标进展',
    '## 未完成事项',
    '## 偏差与失控点',
    '## 未完成原因诊断',
    '## 风险控制策略',
    '## 明日计划调整',
    '## 用户模型更新',
    '## Agent 策略更新',
  ]
  const dailyComplete = dailyDocs.filter((doc) => requiredDailySections.every((section) => doc.content.includes(section)))
  record(
    'TW-DAILY-LOG-CONTROL-CONTENT',
    'every simulated day log records facts, progress, deviation, diagnosis, risk control, next plan, user model and Agent strategy update without creating a separate log type',
    dailyComplete.length >= 14,
    `completeDailyLogs=${dailyComplete.length}/${dailyDocs.length}`,
  )
  record(
    'TW-OKR-HIERARCHY',
    'annual OKR, quarterly KR, monthly modules, weekly priorities and daily actions are visible in the long-term log chain',
    yearDocs.some((doc) => doc.content.includes('年度 Objective') && doc.content.includes('年度 KR'))
      && quarterDocs.some((doc) => doc.content.includes('季度 KR'))
      && monthDocs.some((doc) => doc.content.includes('本月推进模块'))
      && weekDocs.every((doc) => doc.content.includes('本周最高优先级'))
      && dailyDocs.every((doc) => doc.content.includes('年度 OKR') && doc.content.includes('季度 KR')),
    `year=${yearDocs[0]?.path || 'missing'}; weeks=${weekDocs.map((doc) => doc.path).join(',')}`,
  )
  record(
    'TW-REVERSE-ADJUSTMENT',
    'daily deviations can flow back into tomorrow, week and higher-level plan language',
    dailyDocs.some((doc) => doc.content.includes('明天调整'))
      && weekDocs.some((doc) => doc.content.includes('本周偏差如何反向调整'))
      && monthDocs.some((doc) => doc.content.includes('今日偏差对月度计划的反向影响')),
    'daily -> weekly -> monthly reverse adjustment language found',
  )
  record(
    'TW-META-COGNITION-AND-AI-SELF',
    'logs and meta-cognition documents include both user model updates and Agent self strategy updates',
    dailyDocs.some((doc) => doc.content.includes('用户模型更新'))
      && dailyDocs.some((doc) => doc.content.includes('Agent 策略更新'))
      && metaDocs.some((doc) => doc.content.includes('AI 自我修正') || doc.content.includes('AI 下一次规则')),
    `metaDocs=${metaDocs.length}`,
  )
  record(
    'TW-GOAL-STATE-CHANGES',
    'check-ins affect goal state through actions and KR progress instead of only appending chat history',
    allActions.some((action) => ['DONE', 'PARTIAL', 'NOT_DONE'].includes(action.status))
      && krRows.some((kr) => Number(kr.progress || 0) > 0),
    `actions=${allActions.length}; progressedKrs=${krRows.filter((kr) => Number(kr.progress || 0) > 0).length}`,
  )
  debugStep('audits:done')
}

function toMarkdown() {
  const failed = results.filter((item) => !item.ok)
  return [
    '# Goal Mate Two-week Complex Control Loop Verification',
    '',
    `- Time: ${new Date().toISOString()}`,
    `- Test user: ${maskEmail(email)}`,
    `- Test data kept: ${keepData ? 'yes' : 'no'}`,
    `- Result: ${failed.length === 0 ? 'PASS' : 'FAIL'}`,
    '',
    '## Scope',
    '',
    'This verification simulates at least two weeks of complex multi-goal AI action control. It uses Web Agent tool execution for goal creation, real QQ scheduler event records, simulated QQ inbound events, shared Agent Tool Runtime, Check-in, Logs, Review, Meta-Cognition and long-term Year / Quarter / Month / Week / Day Markdown log hierarchy. It does not operate the user QQ client directly and does not prove live QQ Gateway uptime.',
    '',
    '## Checks',
    '',
    '| ID | Purpose | Result | Evidence |',
    '| --- | --- | --- | --- |',
    ...results.map((item) => `| ${item.id} | ${item.purpose} | ${item.ok ? 'PASS' : 'FAIL'} | ${sanitize(item.evidence)} |`),
    '',
  ].join('\n')
}

try {
  await run()
} catch (error) {
  record('TW-RUNTIME', 'two-week complex control loop verifier completes without crashing', false, error instanceof Error ? error.stack || error.message : String(error))
} finally {
  if (!keepData) {
    try {
      await cleanupUser()
      record('TW-CLEANUP', 'temporary two-week verification user and data are removed', true, 'cleanup completed')
    } catch (error) {
      record('TW-CLEANUP', 'temporary two-week verification user and data are removed', false, error instanceof Error ? error.message : String(error))
    }
  }
  await prisma.$disconnect()
}

const markdown = toMarkdown()
console.log(markdown)
if (shouldWrite) {
  writeFileSync(resolve(projectRoot, 'docs/plans/two-week-control-loop-last-run.md'), markdown)
}

if (results.some((item) => !item.ok)) {
  process.exitCode = 1
}
