'use client'

import { useGoals } from '@/hooks/use-goals'

function conditionProgress(status?: string) {
  const normalized = String(status || '').toUpperCase()
  if (normalized === 'SATISFIED') return 1
  if (normalized === 'PARTIAL') return 0.5
  return 0
}

function stageProgress(stage: any) {
  const status = String(stage?.status || '').toUpperCase()
  if (status === 'COMPLETED') return 1
  if (status === 'ACTIVE' || status === 'ADJUSTED') return 0.5

  if (stage?.startDate && stage?.endDate) {
    const start = new Date(stage.startDate).getTime()
    const end = new Date(stage.endDate).getTime()
    const now = Date.now()
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      return Math.min(1, Math.max(0, (now - start) / (end - start)))
    }
  }

  return 0
}

export function GoalsView() {
  const goalsQuery = useGoals()
  const apiGoals = goalsQuery.data?.data || []
  const apiGoal = apiGoals.find((goal: any) => goal.isCurrentFocus) || apiGoals[0]

  const keyResults = apiGoal?.keyResults || []
  const conditions = apiGoal?.conditions || []
  const stages = apiGoal?.stagePlans || []
  const dailyActions = apiGoal?.dailyActions || []
  const reasoningCard = apiGoal?.reasoningCards?.[0]

  const title = apiGoal?.title || '还没有目标'
  const objective = apiGoal?.interpretedGoal || reasoningCard?.purposeSummary || '先和 Agent 说明你想推进的事情，系统会把它拆成目标、关键结果、条件和阶段。'
  const horizon = apiGoal?.horizonStart && apiGoal?.horizonEnd
    ? `${new Date(apiGoal.horizonStart).toLocaleDateString('zh-CN')} 至 ${new Date(apiGoal.horizonEnd).toLocaleDateString('zh-CN')}`
    : '等待目标周期'
  const currentGapCondition = conditions.find((condition: any) => condition.id === reasoningCard?.currentGapConditionId)
    || conditions.find((condition: any) => String(condition.status).toUpperCase() !== 'SATISFIED')
  const currentStage = stages.find((stage: any) => String(stage.status).toUpperCase() === 'ACTIVE') || stages[0]
  const currentAction = dailyActions.find((action: any) => String(action.status).toUpperCase() === 'PLANNED') || dailyActions[0]
  const currentGap = currentGapCondition?.title || reasoningCard?.recommendedFocus || '还没有推导出当前关键缺口。'
  const overallProgress = keyResults.length
    ? keyResults.reduce((sum: number, kr: any) => sum + (typeof kr.progress === 'number' ? kr.progress : 0), 0) / keyResults.length
    : 0
  const satisfiedConditions = conditions.filter((condition: any) => String(condition.status).toUpperCase() === 'SATISFIED').length
  const activeStageLabel = currentStage?.name || currentStage?.title || '等待阶段计划'
  const actionLabel = currentAction?.title || '等待今日行动'

  return (
    <div className="min-h-[calc(100vh-4rem)] space-y-6 p-6">
      <section className="rounded-[36px] border border-stone-200 bg-white p-8 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-400">Objective</p>
              <h1 className="mt-3 text-4xl font-semibold tracking-tight text-stone-950">{title}</h1>
            <p className="mt-4 text-lg leading-8 text-stone-600">{objective}</p>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-stone-400">这是只读状态图：系统只展示目标如何被拆成证明结果、关键条件、当前阶段和今日行动，不要求你在这里维护计划。</p>
          </div>
          <div className="grid w-full max-w-md gap-3">
            <div className="rounded-2xl bg-stone-950 px-5 py-4 text-white">
              <p className="text-xs uppercase tracking-[0.24em] text-stone-400">Horizon</p>
              <p className="mt-2 text-lg font-semibold">{horizon}</p>
            </div>
            <div className="rounded-2xl bg-stone-100 px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs uppercase tracking-[0.24em] text-stone-400">Overall</p>
                <p className="text-lg font-semibold text-stone-950">{Math.round(overallProgress * 100)}%</p>
              </div>
              <div className="mt-3 h-2 rounded-full bg-white">
                <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${Math.min(100, Math.max(0, overallProgress * 100))}%` }} />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-stone-200 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.2em] text-stone-400">Current Gap</p>
                <p className="mt-2 text-sm font-semibold leading-6 text-stone-900">{currentGap}</p>
              </div>
              <div className="rounded-2xl border border-stone-200 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.2em] text-stone-400">Today</p>
                <p className="mt-2 text-sm font-semibold leading-6 text-stone-900">{currentAction?.title || '等待今日行动'}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-[32px] border border-stone-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-400">System State</p>
            <h2 className="mt-2 text-2xl font-semibold text-stone-950">目标状态链路</h2>
          </div>
          <span className="rounded-full bg-stone-100 px-3 py-1 text-xs text-stone-500">目标 → KR → 条件 → 阶段 → 今日</span>
        </div>
        <div className="grid gap-3 lg:grid-cols-5">
          {[
            { label: '目标', value: title, tone: 'bg-stone-950 text-white' },
            { label: 'KR 证明', value: keyResults.length ? `${keyResults.length} 条 · ${Math.round(overallProgress * 100)}%` : '等待 KR', tone: 'bg-stone-100 text-stone-950' },
            { label: '关键条件', value: conditions.length ? `${satisfiedConditions}/${conditions.length} 已满足` : '等待条件', tone: 'bg-stone-100 text-stone-950' },
            { label: '当前阶段', value: activeStageLabel, tone: 'bg-stone-100 text-stone-950' },
            { label: '今日行动', value: actionLabel, tone: 'bg-emerald-100 text-stone-950' },
          ].map((item, index) => (
            <div key={item.label} className={`relative rounded-3xl p-4 ${item.tone}`}>
              {index > 0 && <span className="absolute -left-2 top-1/2 hidden h-px w-4 bg-stone-300 lg:block" />}
              <p className="text-xs font-semibold uppercase tracking-[0.18em] opacity-60">{item.label}</p>
              <p className="mt-3 line-clamp-3 text-sm font-semibold leading-6">{item.value}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 text-sm leading-6 text-stone-500">用户只需要看懂这条链：今天的行动为什么存在，以及它正在补齐哪个目标缺口。</p>
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="rounded-[32px] border border-stone-200 bg-white p-6 shadow-sm">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-2xl font-semibold text-stone-950">Key Results</h2>
            <span className="rounded-full bg-stone-100 px-3 py-1 text-xs text-stone-500">只读</span>
          </div>
          <div className="space-y-4">
            {keyResults.length ? keyResults.map((kr: any, index: number) => {
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
                    <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }} />
                  </div>
                </div>
              )
            }) : (
              <div className="rounded-3xl border border-dashed border-stone-200 p-6 text-sm leading-6 text-stone-500">
                还没有 KR。KR 只保留能证明目标达成的结果，不为了凑数量。
              </div>
            )}
          </div>
        </div>

        <div className="rounded-[32px] border border-stone-200 bg-white p-6 shadow-sm">
          <h2 className="text-2xl font-semibold text-stone-950">Conditions</h2>
          <p className="mt-2 text-sm leading-6 text-stone-500">当前缺口：{currentGap}</p>
          <div className="mt-5 space-y-3">
            {conditions.length ? conditions.map((condition: any) => {
              const progress = conditionProgress(condition.status)
              const isCurrentGap = condition.id === currentGapCondition?.id
              return (
              <div key={condition.id || condition.title} className={`rounded-2xl p-4 ${isCurrentGap ? 'bg-amber-50 ring-1 ring-amber-200' : 'bg-stone-50'}`}>
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-stone-900">{condition.title}</span>
                  <span className="rounded-full bg-white px-2.5 py-1 text-xs text-stone-500">{condition.status}</span>
                </div>
                <div className="mt-3 h-1.5 rounded-full bg-white">
                  <div className="h-1.5 rounded-full bg-stone-950" style={{ width: `${Math.round(progress * 100)}%` }} />
                </div>
                <p className="mt-2 text-xs text-stone-400">{condition.type}{isCurrentGap ? ' · 当前缺口' : ''}</p>
              </div>
              )
            }) : (
              <div className="rounded-2xl bg-stone-50 p-4 text-sm leading-6 text-stone-500">
                还没有必要条件。目标被拆清楚后，这里只显示真正影响推进的条件。
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-[32px] border border-stone-200 bg-white p-6 shadow-sm">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-2xl font-semibold text-stone-950">Cycle Plan</h2>
          <span className="text-sm text-stone-400">OKR + Gantt</span>
        </div>
        <div className="space-y-4">
          {stages.length ? stages.map((stage: any) => {
            const progress = stageProgress(stage)
            const isCurrentStage = stage.id === currentStage?.id
            return (
              <div key={stage.id || stage.name || stage.title} className={`grid gap-3 rounded-3xl p-3 md:grid-cols-[140px_1fr_110px] md:items-center ${isCurrentStage ? 'bg-stone-50' : ''}`}>
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
                    <div className="h-3 rounded-full bg-stone-950" style={{ width: `${Math.min(100, Math.max(progress * 100, progress > 0 ? 4 : 0))}%` }} />
                  </div>
                </div>
                <span className={`rounded-full px-3 py-1 text-center text-xs ${isCurrentStage ? 'bg-stone-950 text-white' : 'bg-stone-100 text-stone-500'}`}>{isCurrentStage ? 'current' : stage.status || 'read only'}</span>
              </div>
            )
          }) : (
            <div className="rounded-3xl border border-dashed border-stone-200 p-6 text-sm leading-6 text-stone-500">
              还没有周期计划。生成目标后，这里会用阶段条展示从长期目标到当前阶段的推进情况。
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
