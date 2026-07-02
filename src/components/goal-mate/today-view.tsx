'use client'

import { demoGoal } from '@/lib/goal-mate-demo-data'
import { useSubmitCheckin, useToday } from '@/hooks/use-today'
import { MomentumHeatmap } from './momentum-heatmap'

const feedbackOptions = [
  { label: '完成', value: 'done' },
  { label: '部分完成', value: 'partial' },
  { label: '没做', value: 'not_done' },
  { label: '改小', value: 'skipped' },
] as const

export function TodayView() {
  const today = useToday()
  const submitCheckin = useSubmitCheckin()
  const apiData = today.data?.data
  const apiGoal = apiData?.goal
  const apiAction = apiData?.action

  const action = apiAction
    ? {
        id: apiAction.id,
        title: apiAction.title,
        linkedCondition: apiAction.condition?.title || demoGoal.todayAction.linkedCondition,
        doneWhen: apiAction.doneWhen,
        minimumStep: apiAction.minimumStep,
        fallbackAction: apiAction.fallbackAction,
        estimatedMinutes: apiAction.estimatedMinutes,
        checkinQuestion: apiAction.checkinQuestion || demoGoal.todayAction.checkinQuestion,
      }
    : { ...demoGoal.todayAction, id: '' }

  const goalTitle = apiGoal?.title || demoGoal.title
  const horizon = apiGoal?.horizonStart && apiGoal?.horizonEnd
    ? `${new Date(apiGoal.horizonStart).toLocaleDateString('zh-CN')} 至 ${new Date(apiGoal.horizonEnd).toLocaleDateString('zh-CN')}`
    : demoGoal.horizon

  const handleFeedback = (result: (typeof feedbackOptions)[number]['value']) => {
    if (!action.id) return
    submitCheckin.mutate({ actionId: action.id, result })
  }

  return (
    <div className="grid min-h-[calc(100vh-4rem)] gap-6 p-6 xl:grid-cols-[minmax(0,1fr)_430px]">
      <main className="rounded-[36px] bg-stone-950 p-8 text-white shadow-xl">
        <div className="flex flex-wrap items-center gap-3 text-sm text-stone-300">
          <span className="rounded-full bg-white/10 px-3 py-1">Current focus</span>
          <span>{horizon}</span>
          {today.isLoading && <span className="rounded-full bg-white/10 px-3 py-1">加载中</span>}
        </div>

        <div className="mt-12 max-w-4xl">
          <p className="text-sm uppercase tracking-[0.28em] text-emerald-300">Today</p>
          <h1 className="mt-4 text-5xl font-semibold leading-tight md:text-7xl">{action.title}</h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-stone-300">{action.linkedCondition}</p>
        </div>

        <div className="mt-12 grid gap-4 lg:grid-cols-3">
          <div className="rounded-3xl bg-white p-5 text-stone-950">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">Done when</p>
            <p className="mt-3 text-lg font-medium leading-7">{action.doneWhen}</p>
          </div>
          <div className="rounded-3xl bg-white/10 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">Minimum</p>
            <p className="mt-3 text-lg font-medium leading-7">{action.minimumStep}</p>
          </div>
          <div className="rounded-3xl bg-white/10 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">Fallback</p>
            <p className="mt-3 text-lg font-medium leading-7">{action.fallbackAction}</p>
          </div>
        </div>

        <div className="mt-10 flex flex-wrap gap-3">
          {feedbackOptions.map((item, index) => (
            <button
              key={item.value}
              disabled={!action.id || submitCheckin.isPending}
              onClick={() => handleFeedback(item.value)}
              className={`rounded-full px-5 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-45 ${index === 0 ? 'bg-emerald-300 text-stone-950' : 'bg-white/10 text-white hover:bg-white/15'}`}
            >
              {item.label}
            </button>
          ))}
        </div>
        {!action.id && <p className="mt-4 text-sm text-stone-400">当前显示 demo 数据；seed 和登录后反馈会写入真实日志。</p>}
      </main>

      <aside className="flex flex-col gap-6">
        <section className="rounded-[28px] border border-stone-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-400">Why this step</p>
          <h2 className="mt-2 text-2xl font-semibold text-stone-950">补齐当前关键缺口</h2>
          <p className="mt-4 leading-7 text-stone-600">{apiGoal?.reasoningCards?.[0]?.recommendedFocus || demoGoal.currentGap}</p>
          <p className="mt-4 rounded-2xl bg-stone-100 p-4 text-sm leading-6 text-stone-700">{action.checkinQuestion}</p>
          <p className="mt-4 text-xs text-stone-400">目标：{goalTitle}</p>
        </section>
        <MomentumHeatmap />
      </aside>
    </div>
  )
}
