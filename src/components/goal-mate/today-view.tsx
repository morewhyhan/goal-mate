'use client'

import { useSubmitCheckin, useToday } from '@/hooks/use-today'
import { useSettings } from '@/hooks/use-settings'
import { MomentumHeatmap } from './momentum-heatmap'

const feedbackOptions = [
  { label: '完成', value: 'done' },
  { label: '部分完成', value: 'partial' },
  { label: '没做', value: 'not_done' },
  { label: '改小', value: 'skipped' },
] as const

export function TodayView() {
  const today = useToday()
  const settings = useSettings()
  const submitCheckin = useSubmitCheckin()
  const apiData = today.data?.data
  const apiGoal = apiData?.goal
  const apiAction = apiData?.action
  const todaySettings = settings.data?.data?.today || {}
  const lowEnergyMode = todaySettings.low_energy_mode !== false
  const heatmapScope = typeof todaySettings.heatmap_scope === 'string' ? todaySettings.heatmap_scope : 'year'

  const action = apiAction
    ? {
        id: apiAction.id,
        title: apiAction.title,
        linkedCondition: apiAction.condition?.title || '这个行动暂未绑定具体条件。',
        doneWhen: apiAction.doneWhen,
        minimumStep: apiAction.minimumStep,
        fallbackAction: apiAction.fallbackAction,
        estimatedMinutes: apiAction.estimatedMinutes,
        checkinQuestion: apiAction.checkinQuestion || '完成后告诉 Agent：做完了、部分完成，或没做。',
      }
    : null

  const goalTitle = apiGoal?.title || '还没有当前目标'
  const horizon = apiGoal?.horizonStart && apiGoal?.horizonEnd
    ? `${new Date(apiGoal.horizonStart).toLocaleDateString('zh-CN')} 至 ${new Date(apiGoal.horizonEnd).toLocaleDateString('zh-CN')}`
    : '等待目标周期'

  const handleFeedback = (result: (typeof feedbackOptions)[number]['value']) => {
    if (!action?.id) return
    submitCheckin.mutate({ actionId: action.id, result })
  }

  return (
    <div className="grid min-h-[calc(100vh-4rem)] gap-6 p-6 xl:grid-cols-[minmax(0,1fr)_430px]">
      <main className="rounded-[36px] bg-stone-950 p-8 text-white shadow-xl">
        <div className="flex flex-wrap items-center gap-3 text-sm text-stone-300">
          <span className="rounded-full bg-white/10 px-3 py-1">Current focus</span>
          <span>{horizon}</span>
          {today.isLoading && <span className="rounded-full bg-white/10 px-3 py-1">加载中</span>}
          {lowEnergyMode && <span className="rounded-full bg-emerald-300 px-3 py-1 text-stone-950">低精力模式</span>}
        </div>

        <div className="mt-12 max-w-4xl">
          <p className="text-sm uppercase tracking-[0.28em] text-emerald-300">Today</p>
          <h1 className="mt-4 text-5xl font-semibold leading-tight md:text-7xl">
            {action?.title || '还没有下一步行动'}
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-stone-300">
            {action?.linkedCondition || '先在 Agent 里说清楚你的当前目标，系统会生成今天只需要推进的一步。'}
          </p>
        </div>

        <div className={`mt-12 grid gap-4 ${lowEnergyMode ? 'lg:grid-cols-3' : 'lg:grid-cols-2'}`}>
          <div className="rounded-3xl bg-white p-5 text-stone-950">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">Done when</p>
            <p className="mt-3 text-lg font-medium leading-7">{action?.doneWhen || '等待 Agent 明确完成标准。'}</p>
          </div>
          <div className="rounded-3xl bg-white/10 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">Minimum</p>
            <p className="mt-3 text-lg font-medium leading-7">{action?.minimumStep || '没有精力时，系统会给出更小版本。'}</p>
          </div>
          {lowEnergyMode && <div className="rounded-3xl bg-white/10 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">Fallback</p>
            <p className="mt-3 text-lg font-medium leading-7">{action?.fallbackAction || '当前还没有备用动作。'}</p>
          </div>}
        </div>

        <div className="mt-10 flex flex-wrap gap-3">
          {feedbackOptions.map((item, index) => (
            <button
              key={item.value}
              disabled={!action?.id || submitCheckin.isPending}
              onClick={() => handleFeedback(item.value)}
              className={`rounded-full px-5 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-45 ${index === 0 ? 'bg-emerald-300 text-stone-950' : 'bg-white/10 text-white hover:bg-white/15'}`}
            >
              {item.label}
            </button>
          ))}
        </div>
        {!action?.id && <p className="mt-4 text-sm text-stone-400">当前没有可反馈的真实行动。先让 Agent 帮你生成 Today。</p>}
      </main>

      <aside className="flex flex-col gap-6">
        <section className="rounded-[28px] border border-stone-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-400">Why this step</p>
          <h2 className="mt-2 text-2xl font-semibold text-stone-950">补齐当前关键缺口</h2>
          <p className="mt-4 leading-7 text-stone-600">
            {apiGoal?.reasoningCards?.[0]?.recommendedFocus || '有目标和日志之后，这里只解释为什么今天先做这一步。'}
          </p>
          <p className="mt-4 rounded-2xl bg-stone-100 p-4 text-sm leading-6 text-stone-700">
            {action?.checkinQuestion || '没有今日行动时不需要打卡。'}
          </p>
          <p className="mt-4 text-xs text-stone-400">目标：{goalTitle}</p>
        </section>
        <MomentumHeatmap defaultScope={heatmapScope} />
      </aside>
    </div>
  )
}
