'use client'

import { useState } from 'react'
import { useGenerateTodayAction, useSubmitCheckin, useToday } from '@/hooks/use-today'
import { useSettings, useSettingsControlCenter } from '@/hooks/use-settings'
import { MomentumHeatmap } from './momentum-heatmap'

const feedbackOptions = [
  { label: '完成', value: 'done', result: 'done' },
  { label: '部分完成', value: 'partial', result: 'partial' },
  { label: '没做', value: 'not_done', result: 'not_done' },
  { label: '改小', value: 'make_smaller', result: 'not_done' },
] as const

const reasonSuggestions = ['动作太大', '今天没时间', '不知道怎么开始', '现在不想做', '提醒时机不对', '方向可能不对']

export function TodayView() {
  const today = useToday()
  const settings = useSettings()
  const controlCenter = useSettingsControlCenter()
  const submitCheckin = useSubmitCheckin()
  const generateTodayAction = useGenerateTodayAction()
  const [feedbackIntent, setFeedbackIntent] = useState<(typeof feedbackOptions)[number] | null>(null)
  const [feedbackText, setFeedbackText] = useState('')
  const [feedbackError, setFeedbackError] = useState('')
  const apiData = today.data?.data
  const apiGoal = apiData?.goal
  const apiAction = apiData?.action
  const todaySettings = settings.data?.data?.today || {}
  const controlData = controlCenter.data?.data
  const modelConfigured = Boolean(controlData?.model?.apiKeyConfigured)
  const heatmapScope = typeof todaySettings.heatmap_scope === 'string' ? todaySettings.heatmap_scope : 'year'
  const actionLocked = Boolean(apiData?.todayLocked || (apiAction && apiAction.status !== 'PLANNED'))

  const action = apiAction
    ? {
        id: apiAction.id,
        actionDate: apiAction.actionDate,
        title: apiAction.title,
        linkedCondition: apiAction.condition?.title || '这个行动暂未绑定具体条件。',
        doneWhen: apiAction.doneWhen,
        minimumStep: apiAction.minimumStep,
        fallbackAction: apiAction.fallbackAction,
        estimatedMinutes: apiAction.estimatedMinutes,
        checkinQuestion: apiAction.checkinQuestion || '完成后告诉 Agent：做完了、部分完成，或没做。',
      }
    : null

  const anchorDate = action?.actionDate
    ? new Date(action.actionDate).toLocaleDateString('zh-CN')
    : new Date().toLocaleDateString('zh-CN')

  const primaryLine = action
    ? action.title
    : apiGoal
      ? '让 Agent 生成今天唯一要做的下一步。'
      : '先告诉 Agent 你想达到什么结果。'

  const guideLine = action
    ? action.doneWhen
    : apiGoal
      ? `当前目标是“${apiGoal.title}”。现在只缺今天可执行、可反馈的一步。`
      : 'Today 不展示假任务。你只需要说明结果、截止时间和当前情况。'

  const completionText = action?.doneWhen || (apiGoal ? '生成今日行动后，这里会显示做到什么样算完成。' : '先说明目标，系统再给出完成标准。')
  const minimumText = action?.minimumStep || (apiGoal ? '生成今日行动后，这里会显示低精力时的最小版本。' : '先不用自己拆计划。')
  const fallbackText = action?.fallbackAction || (apiGoal ? '生成今日行动后，这里会显示做不动时的替代动作。' : '没有目标时，不需要预案。')

  const handleFeedback = (option: (typeof feedbackOptions)[number]) => {
    if (!action?.id) return
    setFeedbackError('')
    if (option.value === 'done') {
      setFeedbackIntent(null)
      setFeedbackText('')
      submitCheckin.mutate({ actionId: action.id, result: 'done' })
      return
    }
    setFeedbackIntent(option)
    setFeedbackText('')
  }

  const submitFeedbackWithReason = () => {
    if (!action?.id || !feedbackIntent) return
    const reason = feedbackText.trim()
    if (!reason) {
      setFeedbackError('补一句实际情况，AI 才能据此调整下一步。')
      return
    }
    const userFeedback = feedbackIntent.value === 'make_smaller'
      ? `当前行动太大，请把下一步改小。${reason}`
      : reason
    submitCheckin.mutate(
      { actionId: action.id, result: feedbackIntent.result, userFeedback },
      {
        onSuccess: () => {
          setFeedbackIntent(null)
          setFeedbackText('')
          setFeedbackError('')
        },
      },
    )
  }

  const feedbackResult = submitCheckin.data?.data
  const diagnosis = feedbackResult?.diagnosis
  const proposedNextAction = diagnosis?.proposedNextAction
  const reminderAdjustment = feedbackResult?.reminderAdjustment
  const nextCommitmentCandidate = feedbackResult?.nextCommitment
    || feedbackResult?.controlLoopEpisode?.next_commitment
  const returnedNextCommitment = nextCommitmentCandidate
    && (nextCommitmentCandidate.persisted === true || nextCommitmentCandidate.id)
    ? nextCommitmentCandidate
    : null

  const quadrants = [
    {
      label: '重要且紧急',
      urgency: '紧急',
      importance: '重要',
      badge: action ? '先做' : apiGoal ? '生成' : '开始',
      badgeClass: 'bg-emerald-100 text-emerald-800',
      title: action?.title || (apiGoal ? '生成今日行动' : modelConfigured ? '告诉 Agent 目标' : '配置模型'),
      body: action?.doneWhen || (apiGoal ? '把当前目标压缩成今天唯一能反馈的一步。' : modelConfigured ? '说清楚你想达到的结果、截止时间和当前状态。' : '配置模型后，Agent 才能拆解目标。'),
      meta: action?.estimatedMinutes ? `${action.estimatedMinutes} min` : '下一步',
      primary: true,
    },
    {
      label: '重要不紧急',
      urgency: '不紧急',
      importance: '重要',
      badge: '保持',
      badgeClass: 'bg-sky-100 text-sky-800',
      title: '维持关键条件',
      body: action?.linkedCondition || (apiGoal?.title || '等待目标结构生成。'),
      meta: '稳定积累',
      primary: false,
    },
    {
      label: '不重要但紧急',
      urgency: '紧急',
      importance: '不重要',
      badge: '确认',
      badgeClass: 'bg-amber-100 text-amber-800',
      title: '只执行预案',
      body: fallbackText,
      meta: '不重做计划',
      primary: false,
    },
    {
      label: '不重要不紧急',
      urgency: '不紧急',
      importance: '不重要',
      badge: '不碰',
      badgeClass: 'bg-red-100 text-red-800',
      title: '排除干扰',
      body: '不加新任务，不刷信息流，不用重新规划逃避当前行动。',
      meta: '避免失控',
      primary: false,
    },
  ]

  if (today.isLoading) {
    return (
      <div className="min-h-[calc(100vh-4rem)] overflow-x-hidden bg-[#f4f1ea] px-4 py-4 text-stone-950 md:px-5 md:py-5">
        <div className="mx-auto max-w-[1180px]">
          <div className="rounded-[22px] border border-stone-200 bg-white p-6 text-sm text-stone-500 shadow-sm">
            正在加载今天的下一步。
          </div>
        </div>
      </div>
    )
  }

  if (today.isError) {
    return (
      <div className="min-h-[calc(100vh-4rem)] bg-[#f4f1ea] px-4 py-4 text-stone-950 md:px-5 md:py-5">
        <div className="mx-auto max-w-[1180px] rounded-[22px] border border-red-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-red-600">Today 暂时不可用</p>
          <h1 className="mt-3 text-2xl font-semibold">暂时无法读取今天的任务。</h1>
          <p className="mt-2 text-sm leading-6 text-stone-600">{today.error.message}</p>
          <button onClick={() => today.refetch()} className="mt-4 rounded-full bg-stone-950 px-4 py-2 text-xs font-semibold text-white">重新读取</button>
        </div>
      </div>
    )
  }

  if (!apiGoal && !action) {
    return (
      <div className="min-h-[calc(100vh-4rem)] overflow-x-hidden bg-[#f4f1ea] px-4 py-4 text-stone-950 md:px-5 md:py-5">
        <div className="mx-auto w-full max-w-[1180px]">
          <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1.05fr)_340px]">
            <main className="min-w-0 space-y-4">
              <section className="overflow-hidden rounded-[24px] border border-stone-900 bg-stone-950 p-5 text-white shadow-sm md:p-6">
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-white/60">Today · 空工作区</p>
                <h1 className="mt-3 max-w-4xl text-3xl font-semibold leading-tight tracking-tight md:text-4xl">
                  还没有今日行动。
                </h1>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-white/72">
                  这不是任务列表。先让 Agent 知道你想达到什么结果，系统才会生成目标结构、必要条件和今天唯一下一步。
                </p>
                <div className="mt-5 flex flex-wrap gap-2">
                  <a href={modelConfigured ? '/dashboard/agent' : '/dashboard/settings#settings-model'} className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-stone-950">
                    {modelConfigured ? '告诉 Agent 目标' : '先配置模型'}
                  </a>
                  <a href="/dashboard/agent" className="rounded-full bg-white/10 px-4 py-2 text-xs font-semibold text-white hover:bg-white/15">打开 Agent</a>
                </div>
              </section>

              <section className="relative overflow-hidden rounded-[24px] border border-stone-200 bg-[#fbfcf8] p-3 shadow-sm">
                <div className="mb-2 hidden grid-cols-[58px_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2 px-1 md:grid">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-400">重要性</div>
                  <div className="rounded-full bg-[#e6ecdd] px-3 py-1.5 text-center text-xs font-semibold text-stone-800">紧急</div>
                  <div className="rounded-full bg-stone-100 px-3 py-1.5 text-center text-xs font-semibold text-stone-600">不紧急</div>
                </div>
                <div className="grid gap-2 md:grid-cols-[58px_minmax(0,1fr)_minmax(0,1fr)]">
                  <div className="hidden items-center justify-center rounded-[16px] bg-[#e6ecdd] text-xs font-semibold text-stone-800 md:flex">重要</div>
                  {[
                    ['重要且紧急', '暂无今日行动', '生成真实行动后，这里显示今天唯一要先做的事。', '等待'],
                    ['重要不紧急', '暂无长期推进', '目标结构生成后，这里显示需要稳定推进的条件。', '等待'],
                  ].map(([label, title, body, badge]) => (
                    <article key={label} className="relative z-10 min-w-0 rounded-[18px] border border-dashed border-stone-300 bg-white/72 p-3.5 shadow-sm">
                      <div className="flex items-center justify-between gap-3">
                        <p className="truncate text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">{label}</p>
                        <span className="shrink-0 rounded-full bg-stone-100 px-2.5 py-1 text-xs font-semibold text-stone-500">{badge}</span>
                      </div>
                      <h3 className="mt-4 text-base font-semibold leading-6 text-stone-950">{title}</h3>
                      <p className="mt-2 line-clamp-2 min-h-[40px] text-sm leading-5 text-stone-500">{body}</p>
                    </article>
                  ))}

                  <div className="hidden items-center justify-center rounded-[16px] bg-stone-100 text-xs font-semibold text-stone-600 md:flex">不重要</div>
                  {[
                    ['不重要但紧急', '暂无待排除事项', '有真实行动后，这里显示只需要确认或兜底的干扰。', '空'],
                    ['不重要不紧急', '暂无低价值事项', '没有真实目标前，不展示任何伪任务。', '空'],
                  ].map(([label, title, body, badge]) => (
                    <article key={label} className="relative z-10 min-w-0 rounded-[18px] border border-dashed border-stone-300 bg-white/72 p-3.5 shadow-sm">
                      <div className="flex items-center justify-between gap-3">
                        <p className="truncate text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">{label}</p>
                        <span className="shrink-0 rounded-full bg-stone-100 px-2.5 py-1 text-xs font-semibold text-stone-500">{badge}</span>
                      </div>
                      <h3 className="mt-4 text-base font-semibold leading-6 text-stone-950">{title}</h3>
                      <p className="mt-2 line-clamp-2 min-h-[40px] text-sm leading-5 text-stone-500">{body}</p>
                    </article>
                  ))}
                </div>
                <p className="mt-2 hidden text-right text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-400 md:block">紧急性</p>
              </section>
            </main>

            <aside className="grid min-w-0 content-start gap-[14px]">
              <section className="min-w-0 overflow-hidden rounded-[18px] border border-stone-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-400">当前状态</p>
                <h2 className="mt-1 text-xl font-semibold text-stone-950">{anchorDate}</h2>
                {[
                  ['目标', '暂无'],
                  ['今日行动', '暂无'],
                  ['执行反馈', '暂无'],
                  ['数据来源', '当前账号'],
                ].map(([label, value]) => (
                  <div key={label} className="mt-2.5 flex min-w-0 items-center justify-between gap-3 border-t border-stone-200 pt-2.5">
                    <strong className="shrink-0 text-sm text-stone-950">{label}</strong>
                    <span className="min-w-0 truncate rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold text-stone-500">{value}</span>
                  </div>
                ))}
              </section>
              <MomentumHeatmap defaultScope={heatmapScope} entries={[]} />
            </aside>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] overflow-x-hidden bg-[#f4f1ea] px-4 py-4 text-stone-950 md:px-5 md:py-5">
      <div className="mx-auto w-full max-w-[1180px]">
        <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1.05fr)_340px]">
          <main className="min-w-0 space-y-4">
            <section className="overflow-hidden rounded-[24px] border border-stone-900 bg-stone-950 p-5 text-white shadow-sm md:p-6">
              <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-white/60">今天只看下一步</p>
                  <h1 className="mt-3 max-w-4xl text-3xl font-semibold leading-tight tracking-tight md:text-4xl">
                    {primaryLine}
                  </h1>
                  <p className="mt-3 max-w-3xl text-sm leading-6 text-white/72">{guideLine}</p>
                </div>

                <div className="flex shrink-0 flex-wrap gap-2 lg:justify-end">
                  {action ? (
                    feedbackOptions.map((option, index) => (
                      <button
                        key={option.value}
                        disabled={!action.id || actionLocked || submitCheckin.isPending}
                        onClick={() => handleFeedback(option)}
                        className={`rounded-full px-4 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-45 ${index === 0 ? 'bg-white text-stone-950' : 'bg-white/10 text-white hover:bg-white/15'}`}
                      >
                        {option.label}
                      </button>
                    ))
                  ) : apiGoal ? (
                    <button disabled={generateTodayAction.isPending} onClick={() => generateTodayAction.mutate()} className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-stone-950 disabled:cursor-not-allowed disabled:opacity-45">
                      {generateTodayAction.isPending ? '生成中' : '生成今日行动'}
                    </button>
                  ) : (
                    <a href={modelConfigured ? '/dashboard/agent' : '/dashboard/settings#settings-model'} className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-stone-950">
                      {modelConfigured ? '告诉 Agent 目标' : '配置模型'}
                    </a>
                  )}
                </div>
              </div>

              <div className="mt-4 rounded-[18px] border border-white/10 bg-white/10 px-4 py-3 text-sm leading-6 text-white/75">
                这里是执行看板，不需要你维护结构。完成、没做、想改小或需要暂停时，直接回到“助手”用自然语言说；快捷按钮只是同一反馈闭环的补充入口。
              </div>

              <div className="mt-5 grid gap-2 text-sm leading-5 text-white/74 md:grid-cols-3">
                {[
                  ['完成标准', completionText],
                  ['最小启动', minimumText],
                  ['风险预案', fallbackText],
                ].map(([label, value]) => (
                  <p key={label} className="min-w-0 truncate rounded-full border border-white/10 bg-white/10 px-3 py-2">
                    <strong className="mr-2 text-white/45">{label}</strong>
                    {value}
                  </p>
                ))}
              </div>
            </section>

            {feedbackIntent && action && !actionLocked ? (
              <section className="rounded-[24px] border border-amber-200 bg-amber-50 p-5 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-700">{feedbackIntent.label} · 补一句实际情况</p>
                <h2 className="mt-2 text-xl font-semibold text-stone-950">
                  {feedbackIntent.value === 'partial'
                    ? '做到哪一步，剩下卡在哪里？'
                    : feedbackIntent.value === 'make_smaller'
                      ? '是什么让这一步显得太大？'
                      : '今天为什么没有开始？'}
                </h2>
                <div className="mt-3 flex flex-wrap gap-2">
                  {reasonSuggestions.map((reason) => (
                    <button
                      key={reason}
                      type="button"
                      onClick={() => {
                        setFeedbackText(reason)
                        setFeedbackError('')
                      }}
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ${feedbackText === reason ? 'bg-stone-950 text-white ring-stone-950' : 'bg-white text-stone-600 ring-amber-200'}`}
                    >
                      {reason}
                    </button>
                  ))}
                </div>
                <textarea
                  value={feedbackText}
                  onChange={(event) => {
                    setFeedbackText(event.target.value)
                    setFeedbackError('')
                  }}
                  placeholder="也可以直接说实际发生了什么，不用整理措辞。"
                  className="mt-3 min-h-[88px] w-full resize-y rounded-[18px] border border-amber-200 bg-white px-4 py-3 text-sm leading-6 text-stone-800 outline-none focus:border-amber-400"
                />
                {feedbackError ? <p className="mt-2 text-xs font-medium text-red-700">{feedbackError}</p> : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button disabled={submitCheckin.isPending} onClick={submitFeedbackWithReason} className="rounded-full bg-stone-950 px-4 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45">
                    {submitCheckin.isPending ? '正在调整' : '提交并让 AI 调整'}
                  </button>
                  <button
                    disabled={submitCheckin.isPending}
                    onClick={() => {
                      setFeedbackIntent(null)
                      setFeedbackText('')
                      setFeedbackError('')
                    }}
                    className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-stone-600 ring-1 ring-amber-200 disabled:opacity-45"
                  >
                    取消
                  </button>
                </div>
              </section>
            ) : null}

            {feedbackResult ? (
              <section className="rounded-[24px] border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">反馈已进入目标档案</p>
                <h2 className="mt-2 text-xl font-semibold text-stone-950">
                  {returnedNextCommitment ? '下一步已按这次反馈写入' : diagnosis ? '反馈已记录，还需要确认下一步' : '这一步已经完成，进度已同步'}
                </h2>
                {diagnosis ? (
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <div className="rounded-[18px] bg-white p-4 ring-1 ring-emerald-100">
                      <p className="text-xs font-semibold text-stone-400">系统判断</p>
                      <p className="mt-2 text-sm leading-6 text-stone-700">{diagnosis.evidence || '这次没有完成，需要根据你的反馈调整执行方式。'}</p>
                    </div>
                    <div className="rounded-[18px] bg-white p-4 ring-1 ring-emerald-100">
                      <p className="text-xs font-semibold text-stone-400">{returnedNextCommitment ? '已经写入的调整' : '诊断建议（尚未写入）'}</p>
                      <p className="mt-2 text-sm leading-6 text-stone-700">
                        {returnedNextCommitment?.title || proposedNextAction || '这次没有形成可写入的调整。'}
                      </p>
                    </div>
                    {diagnosis.nextQuestion ? (
                      <div className="rounded-[18px] bg-white p-4 ring-1 ring-emerald-100 md:col-span-2">
                        <p className="text-xs font-semibold text-stone-400">下一次需要确认</p>
                        <p className="mt-2 text-sm leading-6 text-stone-700">{diagnosis.nextQuestion}</p>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <p className="mt-3 text-sm leading-6 text-stone-600">系统已更新行动与目标进度。你可以回到同一个 Agent 入口，让它基于最新事实给出下一步。</p>
                )}
                {returnedNextCommitment ? (
                  <div className="mt-3 rounded-[18px] bg-stone-950 p-4 text-white">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/50">下一承诺</p>
                    <p className="mt-2 text-sm leading-6 text-white/80">{returnedNextCommitment.title}</p>
                    {returnedNextCommitment.minimumStep || returnedNextCommitment.minimum_step ? (
                      <p className="mt-1 text-xs leading-5 text-white/60">
                        先从这里开始：{returnedNextCommitment.minimumStep || returnedNextCommitment.minimum_step}
                      </p>
                    ) : null}
                    {reminderAdjustment?.applied ? (
                      <p className="mt-1 text-xs leading-5 text-white/60">
                        提醒候选时机已从 {reminderAdjustment.previousSchedule} 调到 {reminderAdjustment.newSchedule}，频率没有增加。
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </section>
            ) : null}

            <section className="relative overflow-hidden rounded-[24px] border border-stone-200 bg-[#fbfcf8] p-3 shadow-sm">
              <div className="mb-2 hidden grid-cols-[58px_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2 px-1 md:grid">
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-400">重要性</div>
                <div className="rounded-full bg-[#e6ecdd] px-3 py-1.5 text-center text-xs font-semibold text-stone-800">紧急</div>
                <div className="rounded-full bg-stone-100 px-3 py-1.5 text-center text-xs font-semibold text-stone-600">不紧急</div>
              </div>
              <div className="grid gap-2 md:grid-cols-[58px_minmax(0,1fr)_minmax(0,1fr)]">
                <div className="hidden items-center justify-center rounded-[16px] bg-[#e6ecdd] text-xs font-semibold text-stone-800 md:flex">
                  重要
                </div>
                {quadrants.slice(0, 2).map((item) => (
                  <article key={item.label} className={`relative z-10 min-w-0 rounded-[18px] border p-3.5 shadow-sm ${item.primary ? 'border-[#bccab5] bg-white ring-2 ring-[#dfe8d9]/70' : 'border-stone-200 bg-white'}`}>
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">{item.label}</p>
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${item.badgeClass}`}>{item.badge}</span>
                    </div>
                    <h3 className="mt-4 text-base font-semibold leading-6 text-stone-950">{item.title}</h3>
                    <p className="mt-2 line-clamp-2 min-h-[40px] text-sm leading-5 text-stone-500">{item.body}</p>
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <span className="rounded-full bg-stone-100 px-2.5 py-1 text-xs font-semibold text-stone-500">{item.meta}</span>
                      {item.primary && action && !actionLocked && (
                        <button disabled={submitCheckin.isPending} onClick={() => handleFeedback(feedbackOptions[0])} className="rounded-full bg-[#dfe8d9] px-3 py-1.5 text-xs font-semibold text-stone-900 disabled:opacity-45">
                          标记完成
                        </button>
                      )}
                    </div>
                  </article>
                ))}

                <div className="hidden items-center justify-center rounded-[16px] bg-stone-100 text-xs font-semibold text-stone-600 md:flex">
                  不重要
                </div>
                {quadrants.slice(2, 4).map((item) => (
                  <article key={item.label} className={`relative z-10 min-w-0 rounded-[18px] border p-3.5 shadow-sm ${item.primary ? 'border-[#bccab5] bg-white ring-2 ring-[#dfe8d9]/70' : 'border-stone-200 bg-white'}`}>
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">{item.label}</p>
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${item.badgeClass}`}>{item.badge}</span>
                    </div>
                    <h3 className="mt-4 text-base font-semibold leading-6 text-stone-950">{item.title}</h3>
                    <p className="mt-2 line-clamp-2 min-h-[40px] text-sm leading-5 text-stone-500">{item.body}</p>
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <span className="rounded-full bg-stone-100 px-2.5 py-1 text-xs font-semibold text-stone-500">{item.meta}</span>
                    </div>
                  </article>
                ))}
              </div>
              <p className="mt-2 hidden text-right text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-400 md:block">紧急性</p>
            </section>
          </main>

          <aside className="grid min-w-0 content-start gap-[14px]">
            <section className="min-w-0 overflow-hidden rounded-[18px] border border-stone-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-400">今天的锚点</p>
              <h2 className="mt-1 text-xl font-semibold text-stone-950">{anchorDate}</h2>
              {[
                ['当前目标', apiGoal?.title || '等待目标'],
                ['核心行动', action?.title || '等待今日行动'],
                ['最小版本', minimumText],
                ['风险预案', fallbackText],
              ].map(([label, value]) => (
                <div key={label} className="mt-2.5 flex min-w-0 items-center justify-between gap-3 border-t border-stone-200 pt-2.5">
                  <strong className="shrink-0 text-sm text-stone-950">{label}</strong>
                  <span className="min-w-0 truncate rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold text-stone-500">{value}</span>
                </div>
              ))}
            </section>
            <MomentumHeatmap defaultScope={heatmapScope} entries={apiData?.momentum || []} />
          </aside>
        </div>
      </div>
    </div>
  )
}
