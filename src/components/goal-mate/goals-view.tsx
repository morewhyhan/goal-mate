'use client'

import { demoGoal } from '@/lib/goal-mate-demo-data'
import { useGoals } from '@/hooks/use-goals'

export function GoalsView() {
  const goalsQuery = useGoals()
  const apiGoals = goalsQuery.data?.data || []
  const apiGoal = apiGoals.find((goal: any) => goal.isCurrentFocus) || apiGoals[0]

  const keyResults = apiGoal?.keyResults?.length ? apiGoal.keyResults : demoGoal.keyResults
  const conditions = apiGoal?.conditions?.length ? apiGoal.conditions : demoGoal.conditions
  const stages = apiGoal?.stagePlans?.length ? apiGoal.stagePlans : demoGoal.stages
  const reasoningCard = apiGoal?.reasoningCards?.[0]

  const title = apiGoal?.title || demoGoal.title
  const objective = apiGoal?.interpretedGoal || reasoningCard?.purposeSummary || demoGoal.objective
  const horizon = apiGoal?.horizonStart && apiGoal?.horizonEnd
    ? `${new Date(apiGoal.horizonStart).toLocaleDateString('zh-CN')} 至 ${new Date(apiGoal.horizonEnd).toLocaleDateString('zh-CN')}`
    : demoGoal.horizon
  const currentGap = reasoningCard?.recommendedFocus || demoGoal.currentGap

  return (
    <div className="min-h-[calc(100vh-4rem)] space-y-6 p-6">
      <section className="rounded-[36px] border border-stone-200 bg-white p-8 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-400">Objective</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight text-stone-950">{title}</h1>
            <p className="mt-4 text-lg leading-8 text-stone-600">{objective}</p>
          </div>
          <div className="rounded-2xl bg-stone-950 px-5 py-4 text-white">
            <p className="text-xs uppercase tracking-[0.24em] text-stone-400">Horizon</p>
            <p className="mt-2 text-lg font-semibold">{horizon}</p>
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="rounded-[32px] border border-stone-200 bg-white p-6 shadow-sm">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-2xl font-semibold text-stone-950">Key Results</h2>
            <span className="rounded-full bg-stone-100 px-3 py-1 text-xs text-stone-500">只读</span>
          </div>
          <div className="space-y-4">
            {keyResults.map((kr: any, index: number) => {
              const progress = typeof kr.progress === 'number' ? kr.progress : 0
              return (
                <div key={kr.id || kr.title} className="rounded-3xl border border-stone-100 p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold text-stone-400">KR {index + 1}</p>
                      <h3 className="mt-1 text-lg font-semibold text-stone-950">{kr.title}</h3>
                      <p className="mt-2 text-sm text-stone-500">{kr.current || kr.currentValue || kr.whyNecessary}</p>
                    </div>
                    <span className="text-lg font-semibold text-stone-950">{Math.round(progress * 100)}%</span>
                  </div>
                  <div className="mt-4 h-2 rounded-full bg-stone-100">
                    <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${progress * 100}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="rounded-[32px] border border-stone-200 bg-white p-6 shadow-sm">
          <h2 className="text-2xl font-semibold text-stone-950">Conditions</h2>
          <p className="mt-2 text-sm leading-6 text-stone-500">当前缺口：{currentGap}</p>
          <div className="mt-5 space-y-3">
            {conditions.map((condition: any) => (
              <div key={condition.id || condition.title} className="rounded-2xl bg-stone-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-stone-900">{condition.title}</span>
                  <span className="rounded-full bg-white px-2.5 py-1 text-xs text-stone-500">{condition.status}</span>
                </div>
                <p className="mt-2 text-xs text-stone-400">{condition.type}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-[32px] border border-stone-200 bg-white p-6 shadow-sm">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-2xl font-semibold text-stone-950">Cycle Plan</h2>
          <span className="text-sm text-stone-400">OKR + Gantt</span>
        </div>
        <div className="space-y-4">
          {stages.map((stage: any) => {
            const progress = typeof stage.progress === 'number' ? stage.progress : 0
            return (
              <div key={stage.id || stage.name || stage.title} className="grid gap-3 md:grid-cols-[140px_1fr_90px] md:items-center">
                <div>
                  <p className="font-semibold text-stone-950">{stage.name || stage.title}</p>
                  <p className="text-xs text-stone-400">{stage.start || (stage.startDate ? new Date(stage.startDate).toLocaleDateString('zh-CN') : '')} - {stage.end || (stage.endDate ? new Date(stage.endDate).toLocaleDateString('zh-CN') : '')}</p>
                </div>
                <div>
                  <div className="mb-2 flex justify-between text-sm text-stone-500">
                    <span>{stage.focus || stage.stageGoal}</span>
                    <span>{Math.round(progress * 100)}%</span>
                  </div>
                  <div className="h-5 rounded-full bg-stone-100 p-1">
                    <div className="h-3 rounded-full bg-stone-950" style={{ width: `${Math.max(progress * 100, 4)}%` }} />
                  </div>
                </div>
                <span className="rounded-full bg-stone-100 px-3 py-1 text-center text-xs text-stone-500">read only</span>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}
