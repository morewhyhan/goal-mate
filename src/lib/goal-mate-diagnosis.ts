export type DiagnosisCategory = 'MOTIVATION' | 'ABILITY' | 'PROMPT' | 'PATH' | 'CONDITION' | 'GOAL' | 'UNKNOWN'
export type AdjustmentType = 'KEEP' | 'SIMPLIFY' | 'RESCHEDULE' | 'REFRAME_GOAL' | 'REBUILD_PATH' | 'PAUSE_GOAL'

export function inferDiagnosis(input: {
  feedback?: string
  consecutiveMissCount: number
  estimatedMinutes?: number
}) {
  const feedback = (input.feedback || '').toLowerCase()

  if (input.consecutiveMissCount >= 3) {
    return {
      category: 'PATH' as DiagnosisCategory,
      adjustmentType: 'REBUILD_PATH' as AdjustmentType,
      evidence: input.feedback || '用户连续多次未完成或部分完成，问题可能不只是行动难度。',
      nextQuestion: '这已经连续几次没有稳定发生了。你觉得是这一步没对准关键条件，还是这个目标本身还没被澄清？',
      proposedNextAction: '暂停继续加任务，先重新判断当前缺口和行动设计是否正确。',
    }
  }

  if (feedback.includes('太难') || feedback.includes('不会') || feedback.includes('累') || feedback.includes('没时间') || (input.estimatedMinutes || 0) > 60) {
    return {
      category: 'ABILITY' as DiagnosisCategory,
      adjustmentType: 'SIMPLIFY' as AdjustmentType,
      evidence: input.feedback || '行动耗时较长或用户反馈执行成本过高。',
      nextQuestion: '这一步是太大、太难，还是不知道从哪里开始？',
      proposedNextAction: '把下一步缩小到用户当下可承受的最小版本。',
    }
  }

  if (feedback.includes('忘') || feedback.includes('提醒') || feedback.includes('时间不对') || feedback.includes('太晚') || feedback.includes('太早')) {
    return {
      category: 'PROMPT' as DiagnosisCategory,
      adjustmentType: 'RESCHEDULE' as AdjustmentType,
      evidence: input.feedback || '用户反馈更接近提醒时机或触达问题。',
      nextQuestion: '提醒应该改到哪个时间点，才更接近你真的能行动的窗口？',
      proposedNextAction: '调整提醒时间和话术，不增加提醒频率。',
    }
  }

  if (feedback.includes('不想') || feedback.includes('没意义') || feedback.includes('不重要') || feedback.includes('没动力')) {
    return {
      category: 'MOTIVATION' as DiagnosisCategory,
      adjustmentType: 'REFRAME_GOAL' as AdjustmentType,
      evidence: input.feedback || '用户反馈目标吸引力不足。',
      nextQuestion: '这个目标现在仍然是你真正想要的吗，还是它更像一个应该做但不想做的目标？',
      proposedNextAction: '重新审查目标动机，而不是继续催促。',
    }
  }

  if (feedback.includes('方向') || feedback.includes('目标') || feedback.includes('不知道为什么') || feedback.includes('不确定')) {
    return {
      category: 'GOAL' as DiagnosisCategory,
      adjustmentType: 'REFRAME_GOAL' as AdjustmentType,
      evidence: input.feedback || '用户反馈目标或目的不清楚。',
      nextQuestion: '如果这个目标 7 天后真的推进了，你最希望看到的具体变化是什么？',
      proposedNextAction: '回到目标澄清，而不是继续拆任务。',
    }
  }

  return {
    category: 'UNKNOWN' as DiagnosisCategory,
    adjustmentType: 'SIMPLIFY' as AdjustmentType,
    evidence: input.feedback || '信息不足，需要继续追问未完成原因。',
    nextQuestion: '今天没推进，更接近动作太大、提醒不合适，还是目标吸引力不足？',
    proposedNextAction: '先用一个诊断问题收集原因，再决定缩小、改提醒或重建路径。',
  }
}
