import { ensureLogPeriodRollups } from './log-period-rollup.mjs'
import {
  buildMetaCognitionHypothesis,
  evaluateMetaCognitionHypotheses,
  loadMetaCognitionHypotheses,
  persistMetaCognitionEvaluations,
  persistMetaCognitionHypothesis,
} from './meta-cognition-layer.mjs'

const DAY_MS = 24 * 60 * 60 * 1000

function pad(value) {
  return String(value).padStart(2, '0')
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function compact(value, max = 220) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max)}...` : text
}

function getWeekNumber(date) {
  const copied = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = copied.getUTCDay() || 7
  copied.setUTCDate(copied.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(copied.getUTCFullYear(), 0, 1))
  return Math.ceil((((copied.getTime() - yearStart.getTime()) / DAY_MS) + 1) / 7)
}

export function buildControlLoopDailyLogPath(date = new Date()) {
  const year = date.getFullYear()
  const month = `${year}-${pad(date.getMonth() + 1)}`
  const quarter = `Q${Math.floor(date.getMonth() / 3) + 1}`
  const week = `W${pad(getWeekNumber(date))}`
  const day = `${year}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  return `logs/${year}/${quarter}/${month}/${week}/${day}.md`
}

export function normalizeControlLoopCheckinResult(value) {
  const normalized = String(value || '').trim().replaceAll('-', '_').toUpperCase()
  if (['DONE', '完成', 'DONE'].includes(normalized)) return 'DONE'
  if (['PARTIAL', '部分完成'].includes(normalized)) return 'PARTIAL'
  if (['NOT_DONE', '未完成', '没做', 'NO'].includes(normalized)) return 'NOT_DONE'
  if (['SKIPPED', 'NO_RESPONSE', '跳过', '未回应'].includes(normalized)) return 'NO_RESPONSE'
  if (/^done$/iu.test(String(value || ''))) return 'DONE'
  if (/^partial$/iu.test(String(value || ''))) return 'PARTIAL'
  if (/not[_ -]?done/iu.test(String(value || ''))) return 'NOT_DONE'
  return 'NO_RESPONSE'
}

function actionStatusFromCheckin(result) {
  if (result === 'DONE') return 'DONE'
  if (result === 'PARTIAL') return 'PARTIAL'
  if (result === 'NOT_DONE') return 'NOT_DONE'
  return 'SKIPPED'
}

function resultLabel(result) {
  if (result === 'DONE') return '完成'
  if (result === 'PARTIAL') return '部分完成'
  if (result === 'NOT_DONE') return '没做'
  return '未回应'
}

async function readLogBooleanSetting(prisma, userId, key, fallback) {
  const settings = await prisma.userSetting.findUnique({ where: { userId } })
  const logs = asObject(settings?.logs)
  return typeof logs[key] === 'boolean' ? logs[key] : fallback
}

export function inferControlLoopDiagnosis(input = {}) {
  const feedback = String(input.feedback || '').toLowerCase()
  const estimatedMinutes = Number(input.estimatedMinutes || 0)
  const explicitCategory = String(input.reasonCategory || '').toUpperCase()

  if (explicitCategory === 'ABILITY' || feedback.includes('没做到') || feedback.includes('还没') || feedback.includes('下次吧') || feedback.includes('太难') || feedback.includes('太忙') || feedback.includes('没空') || feedback.includes('没时间') || feedback.includes('没有时间') || feedback.includes('没工夫') || feedback.includes('不会') || feedback.includes('想不出来') || feedback.includes('做不了') || feedback.includes('累') || feedback.includes('麻烦') || feedback.includes('费劲') || estimatedMinutes > 60) {
    return {
      category: 'ABILITY',
      adjustmentType: 'SIMPLIFY',
      evidence: input.feedback || '行动耗时较长或用户反馈执行成本过高。',
      nextQuestion: '这一步是太大、太难，还是不知道从哪里开始？',
      proposedNextAction: '把下一步缩小到用户当下可承受的最小版本。',
    }
  }

  if (explicitCategory === 'PROMPT' || feedback.includes('忘') || feedback.includes('提醒') || feedback.includes('时间不对') || feedback.includes('太晚') || feedback.includes('太早') || feedback.includes('没准备') || feedback.includes('风险点') || feedback.includes('预案') || feedback.includes('替代') || feedback.includes('失控') || feedback.includes('默认选择')) {
    return {
      category: 'PROMPT',
      adjustmentType: 'RESCHEDULE',
      evidence: input.feedback || '用户反馈更接近提醒时机、风险点或触达问题。',
      nextQuestion: '提醒应该改到哪个时间点，才更接近你真的能行动的窗口？',
      proposedNextAction: '调整提醒时间和风险点预案，不增加提醒频率。',
    }
  }

  if (explicitCategory === 'MOTIVATION' || feedback === '0' || feedback === '不' || feedback.includes('不想') || feedback.includes('没意义') || feedback.includes('不重要') || feedback.includes('没动力') || feedback.includes('不搞') || feedback.includes('不弄') || feedback.includes('不干') || feedback.includes('不继续') || feedback.includes('算了') || feedback.includes('取消') || feedback.includes('停止') || feedback.includes('暂停') || feedback.includes('停了') || feedback.includes('放弃') || feedback.includes('别烦') || feedback.includes('烦') || feedback.includes('躺') || feedback.includes('明天再说') || feedback.includes('先放着')) {
    return {
      category: 'MOTIVATION',
      adjustmentType: 'REFRAME_GOAL',
      evidence: input.feedback || '用户反馈目标吸引力不足。',
      nextQuestion: '这个目标现在仍然是你真正想要的吗，还是它更像一个应该做但不想做的目标？',
      proposedNextAction: '重新审查目标动机，而不是继续催促。',
    }
  }

  if (explicitCategory === 'PATH' || feedback.includes('方向') || feedback.includes('路径') || feedback.includes('目标') || feedback.includes('不知道为什么') || feedback.includes('不知道') || feedback.includes('没想过') || feedback.includes('没想好') || feedback.includes('不确定')) {
    return {
      category: 'GOAL',
      adjustmentType: 'REFRAME_GOAL',
      evidence: input.feedback || '用户反馈目标或目的不清楚。',
      nextQuestion: '如果这个目标 7 天后真的推进了，你最希望看到的具体变化是什么？',
      proposedNextAction: '回到目标澄清，而不是继续拆任务。',
    }
  }

  if ((input.consecutiveMissCount || 0) >= 3) {
    return {
      category: 'PATH',
      adjustmentType: 'REBUILD_PATH',
      evidence: input.feedback || '用户连续多次未完成或部分完成，问题可能不只是行动难度。',
      nextQuestion: '这已经连续几次没有稳定发生了。你觉得是这一步没对准关键条件，还是这个目标本身还没被澄清？',
      proposedNextAction: '暂停继续加任务，先重新判断当前缺口和行动设计是否正确。',
    }
  }

  return {
    category: 'UNKNOWN',
    adjustmentType: 'SIMPLIFY',
    evidence: input.feedback || '信息不足，需要继续追问未完成原因。',
    nextQuestion: '今天没推进，更接近动作太大、提醒不合适，还是目标吸引力不足？',
    proposedNextAction: '先用一个诊断问题收集原因，再决定缩小、改提醒或重建路径。',
  }
}

function progressSignalFromResult(result) {
  if (result === 'DONE') return 1
  if (result === 'PARTIAL') return 0.5
  return null
}

function scoreConditionStatus(status) {
  if (status === 'SATISFIED') return 1
  if (status === 'PARTIAL') return 0.5
  return 0
}

function nextConditionStatus(currentStatus, signal) {
  if (signal === 1) return 'SATISFIED'
  if (signal === 0.5 && currentStatus !== 'SATISFIED') return 'PARTIAL'
  return currentStatus
}

function asStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []
}

async function applyControlLoopProgress(tx, action, result) {
  const signal = progressSignalFromResult(result)
  const condition = await tx.goalCondition.findFirst({
    where: { id: action.conditionId, userId: action.userId, goalId: action.goalId },
  })
  const nextStatus = condition ? nextConditionStatus(condition.status, signal) : null
  const updatedCondition = condition && nextStatus !== condition.status
    ? await tx.goalCondition.update({ where: { id: condition.id }, data: { status: nextStatus } })
    : condition

  const conditions = await tx.goalCondition.findMany({ where: { userId: action.userId, goalId: action.goalId } })
  const effectiveConditions = conditions.map((item) => item.id === updatedCondition?.id ? updatedCondition : item)
  const conditionProgress = effectiveConditions.length
    ? effectiveConditions.reduce((total, item) => total + scoreConditionStatus(item.status), 0) / effectiveConditions.length
    : 0

  const keyResults = signal === null ? [] : await tx.keyResult.findMany({
    where: { userId: action.userId, goalId: action.goalId },
  })
  const updatedKeyResults = []
  for (const keyResult of keyResults) {
    const currentProgress = typeof keyResult.progress === 'number' ? keyResult.progress : 0
    const nextProgress = Math.max(currentProgress, Math.min(1, conditionProgress))
    const nextKrStatus = nextProgress >= 1 ? 'ACHIEVED' : keyResult.status === 'ACHIEVED' ? 'ACHIEVED' : 'ACTIVE'
    if (nextProgress !== currentProgress || nextKrStatus !== keyResult.status) {
      updatedKeyResults.push(await tx.keyResult.update({
        where: { id: keyResult.id },
        data: { progress: nextProgress, status: nextKrStatus },
      }))
    }
  }

  let updatedStagePlan = null
  if (action.stagePlanId) {
    const stagePlan = await tx.stagePlan.findFirst({
      where: { id: action.stagePlanId, userId: action.userId, goalId: action.goalId },
    })
    if (stagePlan) {
      const linkedConditionIds = asStringArray(stagePlan.linkedConditionIds)
      const stageConditions = effectiveConditions.filter((item) => {
        return linkedConditionIds.length ? linkedConditionIds.includes(item.id) : item.id === action.conditionId
      })
      const hasProgress = stageConditions.some((item) => ['PARTIAL', 'SATISFIED'].includes(item.status))
      const isComplete = stageConditions.length > 0 && stageConditions.every((item) => item.status === 'SATISFIED')
      const nextStageStatus = isComplete ? 'COMPLETED' : hasProgress && stagePlan.status === 'DRAFT' ? 'ACTIVE' : stagePlan.status
      if (nextStageStatus !== stagePlan.status) {
        updatedStagePlan = await tx.stagePlan.update({
          where: { id: stagePlan.id },
          data: { status: nextStageStatus },
        })
      }
    }
  }

  return {
    condition: updatedCondition,
    keyResults: updatedKeyResults,
    stagePlan: updatedStagePlan,
    conditionProgress,
  }
}

function buildMetaCognitionLogLines(value) {
  const wrapper = asObject(value)
  const hypothesis = asObject(wrapper.hypothesis || value)
  const self = asObject(hypothesis.ai_self_reflection)
  const policyDelta = asObject(hypothesis.policy_delta)
  const claim = hypothesis.claim || hypothesis.hypothesis
  const userIntervention = hypothesis.decision_impact
  const aiReasoning = self.next_thinking_rule || self.reasoning_adjustment
  const increase = Array.isArray(policyDelta.increase) ? policyDelta.increase.join(', ') : ''
  const decrease = Array.isArray(policyDelta.decrease) ? policyDelta.decrease.join(', ') : ''
  const verification = hypothesis.verification_signal || self.verification_signal || policyDelta.verification_signal
  if (!claim && !userIntervention && !aiReasoning && !verification) return []
  return [
    '### System Reflection',
    '',
    claim ? `- 对用户的判断：${claim}` : undefined,
    userIntervention ? `- 下次怎么干预用户：${userIntervention}` : undefined,
    aiReasoning ? `- AI 下次怎么思考：${aiReasoning}` : undefined,
    increase ? `- AI 策略升权：${increase}` : undefined,
    decrease ? `- AI 策略降权：${decrease}` : undefined,
    verification ? `- 下次验证信号：${verification}` : undefined,
  ].filter(Boolean)
}

function buildControlLoopLogBlock(input) {
  const createdAt = input.createdAt || new Date()
  const time = `${pad(createdAt.getHours())}:${pad(createdAt.getMinutes())}`
  const metaLines = buildMetaCognitionLogLines(input.metaCognition)
  const isDone = input.result === 'DONE'
  return [
    `## Control Loop Check-in ${time}`,
    '',
    `- 回合来源：${input.episodeSource}`,
    `- 目标：${input.goalTitle}`,
    `- 行动：${input.actionTitle}`,
    input.linkedCondition ? `- 关联条件：${input.linkedCondition}` : undefined,
    input.doneWhen ? `- 完成标准：${input.doneWhen}` : undefined,
    input.minimumStep ? `- 最小启动：${input.minimumStep}` : undefined,
    `- 系统观察：围绕「${input.goalTitle}」收集今日行动反馈。`,
    `- 结果：${resultLabel(input.result)}`,
    input.userFeedback ? `- 用户反馈：${input.userFeedback}` : '- 用户反馈：',
    isDone
      ? '- 偏差判断：今日行动已完成，当前控制策略暂时有效。'
      : '- 偏差判断：今日反馈不是完成，需要判断是动机、能力、提示还是路径问题。',
    input.diagnosisQuestion ? `- 下一步调整：${input.diagnosisQuestion}` : '- 下一步调整：等待 Agent 根据反馈继续诊断或调整行动。',
    input.proposedNextAction ? `- 建议动作：${input.proposedNextAction}` : undefined,
    input.metaEvaluationSummary ? `- 元认知评估：${input.metaEvaluationSummary}` : undefined,
    metaLines.length ? '' : undefined,
    ...metaLines,
    '',
  ].filter(Boolean).join('\n')
}

function summarizeMetaEvaluations(evaluations = []) {
  if (!evaluations.length) return ''
  const counts = evaluations.reduce((acc, item) => {
    acc[item.evaluation_result] = (acc[item.evaluation_result] || 0) + 1
    return acc
  }, {})
  return Object.entries(counts).map(([key, value]) => `${key}:${value}`).join('；')
}

export async function submitControlLoopFeedback(prisma, userId, input = {}) {
  const action = input.action || (input.actionId
    ? await prisma.dailyAction.findFirst({ where: { id: input.actionId, userId }, include: { goal: true, condition: true } })
    : await prisma.dailyAction.findFirst({ where: { userId }, orderBy: { actionDate: 'desc' }, include: { goal: true, condition: true } }))
  if (!action) throw new Error('没有找到可提交的今日行动。')

  const result = normalizeControlLoopCheckinResult(input.result)
  const userFeedback = compact(input.userFeedback || input.feedback || '', 600)
  const episodeSource = input.source || 'unknown'
  const autoWriteCheckin = await readLogBooleanSetting(prisma, userId, 'auto_write_checkin', true)
  const activeMetaCognition = await loadMetaCognitionHypotheses(prisma, userId, { goalId: action.goalId })

  const output = await prisma.$transaction(async (tx) => {
    const checkin = await tx.checkin.create({
      data: {
        userId,
        goalId: action.goalId,
        actionId: action.id,
        result,
        reasonCategory: input.reasonCategory || undefined,
        userFeedback,
        adjustment: input.adjustment || undefined,
      },
    })
    const updatedAction = await tx.dailyAction.update({
      where: { id: action.id },
      data: { status: actionStatusFromCheckin(result) },
    })
    const progressUpdate = await applyControlLoopProgress(tx, action, result)

    let diagnosis = null
    if (result === 'NOT_DONE' || result === 'PARTIAL' || result === 'NO_RESPONSE') {
      const recentMisses = await tx.checkin.findMany({
        where: {
          userId,
          goalId: action.goalId,
          result: { in: ['NOT_DONE', 'PARTIAL', 'NO_RESPONSE'] },
        },
        orderBy: { createdAt: 'desc' },
        take: 3,
      })
      const inferred = inferControlLoopDiagnosis({
        feedback: userFeedback,
        reasonCategory: input.reasonCategory,
        consecutiveMissCount: recentMisses.length,
        estimatedMinutes: action.estimatedMinutes,
      })
      diagnosis = await tx.diagnosis.create({
        data: {
          userId,
          goalId: action.goalId,
          actionId: action.id,
          checkinId: checkin.id,
          category: inferred.category,
          evidence: inferred.evidence,
          adjustmentType: inferred.adjustmentType,
          nextQuestion: inferred.nextQuestion,
          proposedNextAction: inferred.proposedNextAction,
        },
      })
    }

    const controlLoopEpisode = {
      id: `cle-${Date.now()}`,
      source: episodeSource,
      trigger: input.trigger || 'feedback',
      status: 'updated',
      intervention_decision: input.interventionDecision || null,
      feedback: { result, userFeedback },
      checkin_id: checkin.id,
      diagnosis_id: diagnosis?.id || null,
      previous_meta_cognition_used: activeMetaCognition.slice(0, 5).map((item) => item.id).filter(Boolean),
      state_transition: {
        action_status: updatedAction.status,
        condition_status: progressUpdate.condition?.status || null,
        key_result_updates: progressUpdate.keyResults.length,
        stage_plan_status: progressUpdate.stagePlan?.status || null,
      },
    }

    const metaEvaluations = evaluateMetaCognitionHypotheses(activeMetaCognition, {
      checkin,
      diagnosis,
      interventionDecision: input.interventionDecision,
    })
    let evaluationWrite = { saved: false, evaluations: metaEvaluations, reason: diagnosis ? 'will_apply_with_new_hypothesis' : 'no_evaluations' }

    let metaCognition = null
    if (diagnosis) {
      const hypothesis = buildMetaCognitionHypothesis({
        userId,
        goal: action.goal,
        action,
        checkin,
        diagnosis,
        interventionDecision: input.interventionDecision,
        source: episodeSource,
      })
      metaCognition = await persistMetaCognitionHypothesis(tx, userId, hypothesis, {
        goalId: action.goalId,
        source: episodeSource,
        evaluations: metaEvaluations,
      })
    } else if (metaEvaluations.length) {
      evaluationWrite = await persistMetaCognitionEvaluations(tx, userId, metaEvaluations, { goalId: action.goalId, source: episodeSource })
    }

    let logEntry = null
    let markdownDocument = null
    if (autoWriteCheckin) {
      const logPath = buildControlLoopDailyLogPath(action.actionDate)
      const logTitle = logPath.split('/').pop() || logPath
      const logBlock = buildControlLoopLogBlock({
        episodeSource,
        goalTitle: action.goal.title,
        actionTitle: action.title,
        linkedCondition: action.condition?.title,
        result,
        doneWhen: action.doneWhen,
        minimumStep: action.minimumStep,
        userFeedback,
        diagnosisQuestion: diagnosis?.nextQuestion,
        proposedNextAction: diagnosis?.proposedNextAction,
        metaCognition,
        metaEvaluationSummary: summarizeMetaEvaluations(metaEvaluations),
        createdAt: new Date(),
      })

      const existingLog = await tx.logEntry.findUnique({ where: { userId_path: { userId, path: logPath } } })
      logEntry = await tx.logEntry.upsert({
        where: { userId_path: { userId, path: logPath } },
        update: {
          title: logTitle,
          content: existingLog ? `${existingLog.content}\n\n${logBlock}` : logBlock,
          linkedGoalIds: [action.goalId],
          linkedActionIds: [action.id],
        },
        create: {
          userId,
          periodType: 'DAY',
          title: logTitle,
          path: logPath,
          content: logBlock,
          linkedGoalIds: [action.goalId],
          linkedActionIds: [action.id],
        },
      })

      const frontmatter = {
        kind: 'checkin',
        goalTitle: action.goal.title,
        actionTitle: action.title,
        controlLoopEpisode,
        metaCognitionEvaluation: metaEvaluations,
        metaCognitionHypothesis: metaCognition?.saved ? metaCognition.hypothesis : null,
      }
      markdownDocument = await tx.markdownDocument.upsert({
        where: { userId_path: { userId, path: logPath } },
        update: {
          title: logTitle,
          content: logEntry.content,
          linkedGoalIds: [action.goalId],
          linkedActionIds: [action.id],
          source: 'AGENT',
          frontmatter,
        },
        create: {
          userId,
          type: 'DAY',
          title: logTitle,
          path: logPath,
          content: logEntry.content,
          linkedGoalIds: [action.goalId],
          linkedActionIds: [action.id],
          source: 'AGENT',
          frontmatter,
        },
      })

      await ensureLogPeriodRollups(tx, {
        userId,
        date: action.actionDate,
        sourcePath: logPath,
        sourceKind: 'control_loop_checkin',
        goalId: action.goalId,
        actionId: action.id,
        goalTitle: action.goal.title,
        actionTitle: action.title,
        resultLabel: resultLabel(result),
        conditionTitle: action.condition?.title,
        diagnosisQuestion: diagnosis?.nextQuestion,
      })
    }

    const finalEpisode = {
      ...controlLoopEpisode,
      status: metaCognition?.saved || evaluationWrite.saved ? 'learned' : autoWriteCheckin ? 'logged' : 'updated',
      log_document_id: markdownDocument?.id || null,
      meta_cognition_update_id: metaCognition?.hypothesis?.id || null,
      policy_delta: metaCognition?.hypothesis?.policy_delta || metaEvaluations[0]?.policy_delta || null,
      meta_cognition_evaluations: metaEvaluations,
    }

    return {
      action: updatedAction,
      checkin,
      diagnosis,
      metaCognition,
      metaCognitionEvaluations: metaEvaluations,
      metaCognitionEvaluationWrite: evaluationWrite,
      progressUpdate,
      logEntry,
      markdownDocument,
      autoWriteCheckin,
      controlLoopEpisode: finalEpisode,
    }
  })

  return { targetId: output.checkin.id, result: output }
}
