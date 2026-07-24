'use client'

import { useState } from 'react'
import { useGoals } from '@/hooks/use-goals'
import { useSettingsControlCenter } from '@/hooks/use-settings'

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
  const controlCenter = useSettingsControlCenter()
  const apiGoals = goalsQuery.data?.data || []
  const [activeView, setActiveView] = useState<'okr' | 'gantt'>('okr')
  const apiGoal = apiGoals.find((goal: any) => goal.isCurrentFocus) || apiGoals[0]
  const modelConfigured = Boolean(controlCenter.data?.data?.model?.apiKeyConfigured)

  if (goalsQuery.isLoading) {
    return (
      <div className="min-h-[calc(100vh-4rem)] space-y-5 bg-[#f4f1ea] p-5 md:p-8">
        <section className="rounded-[24px] border border-stone-200 bg-[#fbfcf8] p-5 shadow-sm md:p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-400">Goals</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-stone-950">正在读取目标结构</h1>
          <p className="mt-2 text-sm leading-6 text-stone-500">正在加载 Objective、KR、必要条件、阶段和每日行动。</p>
        </section>
      </div>
    )
  }

  if (goalsQuery.isError) {
    return (
      <div className="min-h-[calc(100vh-4rem)] bg-[#f4f1ea] p-5 md:p-8">
        <section className="rounded-[24px] border border-red-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-red-500">目标读取失败</p>
          <h1 className="mt-2 text-2xl font-semibold text-stone-950">暂时无法读取目标状态。</h1>
          <p className="mt-2 text-sm leading-6 text-stone-600">{goalsQuery.error?.message || '暂时无法读取目标状态，请稍后重试。'}</p>
          <button onClick={() => goalsQuery.refetch()} className="mt-5 rounded-full bg-stone-950 px-4 py-2 text-sm font-semibold text-white">重新读取</button>
        </section>
      </div>
    )
  }

  if (!apiGoals.length) {
    return (
      <div className="min-h-[calc(100vh-4rem)] space-y-5 bg-[#f4f1ea] p-5 md:p-8">
        <section className="rounded-[24px] border border-stone-200 bg-[#fbfcf8] p-5 shadow-sm md:p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-400">Goals</p>
                <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-stone-500">首次启动</span>
              </div>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-stone-950">{modelConfigured ? '还没有目标结构' : '先让 Agent 具备思考能力'}</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-500">
                {modelConfigured
                  ? '目标页是只读仪表盘。这里不会让用户手动管理计划；等 Agent 根据你的结果输入生成目标后，这里会显示 Objective、KR、必要条件、阶段和每日推进。'
                  : '目标页不会让用户手填 OKR。先去 Settings 配置模型密钥，再告诉 Agent 你想达到的结果。'}
              </p>
            </div>
            <div className="flex rounded-full border border-stone-200 bg-white p-1 text-sm font-semibold text-stone-500">
              <button onClick={() => setActiveView('okr')} className={`rounded-full px-4 py-2 ${activeView === 'okr' ? 'bg-stone-950 text-white' : 'hover:text-stone-950'}`}>目标结构</button>
              <button onClick={() => setActiveView('gantt')} className={`rounded-full px-4 py-2 ${activeView === 'gantt' ? 'bg-stone-950 text-white' : 'hover:text-stone-950'}`}>推进时间线</button>
            </div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="rounded-[24px] border border-dashed border-stone-300 bg-white p-8 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-400">{activeView === 'okr' ? '目标结构' : '推进时间线'}</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-stone-950">这里等待真实目标生成。</h2>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-stone-500">
              当前没有任何目标，所以不渲染假的 KR、阶段或甘特条。{modelConfigured ? '下一步只需要去 Agent 说清楚你想达到的结果。' : '下一步先配置模型密钥，然后再让 Agent 生成目标结构。'}
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <a href={modelConfigured ? '/dashboard/agent' : '/dashboard/settings#settings-model'} className="rounded-full bg-stone-950 px-4 py-2 text-xs font-semibold text-white">{modelConfigured ? '去 Agent 说明目标' : '先配置模型'}</a>
              <a href={modelConfigured ? '/dashboard/settings#settings-model' : '/dashboard/agent'} className="rounded-full bg-stone-100 px-4 py-2 text-xs font-semibold text-stone-700">{modelConfigured ? '查看模型配置' : '打开 Agent'}</a>
            </div>
          </div>

          <aside className="rounded-[24px] border border-stone-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-400">生成后会看到</p>
            <div className="mt-4 space-y-3">
              {[
                ['想达到的结果', 'AI 对你最终目的的当前理解。'],
                ['完成证据', '能证明结果真正达成的指标。'],
                ['必要条件', '结果成立前必须补齐的条件。'],
                ['推进阶段', '当前处于哪一步，下一阶段是什么。'],
                ['当前行动', '真正落到今天的下一步。'],
              ].map(([label, body]) => (
                <div key={label} className="rounded-2xl bg-stone-50 p-3">
                  <p className="text-sm font-semibold text-stone-950">{label}</p>
                  <p className="mt-1 text-xs leading-5 text-stone-500">{body}</p>
                </div>
              ))}
            </div>
          </aside>
        </section>
      </div>
    )
  }

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
  const overallProgress = keyResults.length
    ? keyResults.reduce((sum: number, kr: any) => sum + (typeof kr.progress === 'number' ? kr.progress : 0), 0) / keyResults.length
    : 0
  const activeStageLabel = currentStage?.name || currentStage?.title || '等待阶段计划'
  const actionLabel = currentAction?.title || '等待今日行动'
  const timelineStart = apiGoal?.horizonStart ? new Date(apiGoal.horizonStart) : null
  const timelineEnd = apiGoal?.horizonEnd ? new Date(apiGoal.horizonEnd) : null
  const timelineColumns = timelineStart && timelineEnd && timelineEnd.getTime() > timelineStart.getTime()
    ? Array.from({ length: 5 }, (_, index) => {
        const time = timelineStart.getTime() + ((timelineEnd.getTime() - timelineStart.getTime()) * index) / 4
        const date = new Date(time)
        return `${date.getMonth() + 1}/${date.getDate()}`
      })
    : ['Start', '25%', '50%', '75%', 'Done']
  const timelineStartMs = timelineStart?.getTime() || 0
  const timelineEndMs = timelineEnd?.getTime() || 0
  const timelineDuration = timelineEndMs > timelineStartMs ? timelineEndMs - timelineStartMs : 1
  function spanStyle(startValue?: string, endValue?: string, fallbackProgress = 0) {
    if (startValue && endValue && timelineStartMs && timelineEndMs) {
      const start = new Date(startValue).getTime()
      const end = new Date(endValue).getTime()
      if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
        const left = Math.max(0, Math.min(94, ((start - timelineStartMs) / timelineDuration) * 100))
        const right = Math.max(left + 3, Math.min(100, ((end - timelineStartMs) / timelineDuration) * 100))
        return { left: `${left}%`, width: `${Math.max(3, right - left)}%` }
      }
    }
    return { left: '0%', width: `${Math.max(6, Math.min(100, fallbackProgress * 100))}%` }
  }
  function stageForCondition(conditionId?: string) {
    return stages.find((stage: any) => Array.isArray(stage.linkedConditionIds) && stage.linkedConditionIds.includes(conditionId))
  }
  const ganttRows = [
    {
      key: 'objective',
      level: 1,
      title,
      subtitle: objective,
      progress: overallProgress,
      startDate: apiGoal?.horizonStart,
      endDate: apiGoal?.horizonEnd,
      status: `${Math.round(overallProgress * 100)}%`,
      tone: 'bg-stone-950',
    },
    ...stages.map((stage: any, index: number) => {
      const progress = stageProgress(stage)
      return {
        key: stage.id || `stage-${index}`,
        level: 2,
        title: stage.title || stage.name || `阶段 ${index + 1}`,
        subtitle: stage.stageGoal || stage.focus || '阶段目标待生成',
        progress,
        startDate: stage.startDate,
        endDate: stage.endDate,
        status: stage.status || `${Math.round(progress * 100)}%`,
        tone: ['bg-emerald-600', 'bg-sky-600', 'bg-violet-600', 'bg-amber-600'][index % 4],
      }
    }),
    ...conditions.map((condition: any) => {
      const progress = conditionProgress(condition.status)
      const isCurrentGap = condition.id === currentGapCondition?.id
      const stage = stageForCondition(condition.id)
      return {
        key: condition.id || condition.title,
        level: 3,
        title: condition.title,
        subtitle: `${condition.type || 'condition'}${isCurrentGap ? ' · 当前缺口' : ''}`,
        progress,
        startDate: stage?.startDate || apiGoal?.horizonStart,
        endDate: stage?.endDate || apiGoal?.horizonEnd,
        status: condition.status || 'MISSING',
        tone: isCurrentGap ? 'bg-amber-500' : 'bg-stone-400',
      }
    }),
    ...dailyActions.slice(0, 8).map((dailyAction: any, index: number) => ({
      key: dailyAction.id || `action-${index}`,
      level: 4,
      title: `${dailyAction.actionDate ? new Date(dailyAction.actionDate).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) : 'Today'} · ${dailyAction.title}`,
      subtitle: dailyAction.doneWhen || '每日行动是周期推进落到当天的执行点。',
      progress: String(dailyAction.status || '').toUpperCase() === 'DONE' ? 1 : 0.22,
      startDate: dailyAction.actionDate,
      endDate: dailyAction.actionDate,
      status: dailyAction.status || 'PLANNED',
      tone: dailyAction.id === currentAction?.id ? 'bg-emerald-600' : 'bg-stone-500',
    })),
  ]

  return (
    <div className="min-h-[calc(100vh-4rem)] space-y-5 bg-[#f4f1ea] p-5 md:p-8">
      <section className="rounded-[24px] border border-stone-200 bg-[#fbfcf8] p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-400">Goals</p>
              <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-stone-500">{horizon}</span>
            </div>
            <h1 className="mt-2 truncate text-2xl font-semibold tracking-tight text-stone-950">{title}</h1>
            <p className="mt-1 line-clamp-1 text-sm leading-6 text-stone-500">{objective}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {(apiGoals.length ? apiGoals : [{ id: 'empty', title: '还没有目标' }]).map((goal: any) => (
                <span key={goal.id || goal.title} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${goal.id === apiGoal?.id ? 'bg-stone-950 text-white' : 'border border-stone-200 bg-white text-stone-500'}`}>
                  {goal.title}
                </span>
              ))}
            </div>
          </div>
          <div className="grid w-full max-w-sm gap-3">
            <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs uppercase tracking-[0.24em] text-stone-400">Overall</p>
                <p className="text-lg font-semibold text-stone-950">{Math.round(overallProgress * 100)}%</p>
              </div>
              <div className="mt-3 h-2 rounded-full bg-white">
                <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${Math.min(100, Math.max(0, overallProgress * 100))}%` }} />
              </div>
            </div>
            <div className="flex rounded-full border border-stone-200 bg-white p-1 text-sm font-semibold text-stone-500">
              <button onClick={() => setActiveView('okr')} className={`flex-1 rounded-full px-4 py-2 ${activeView === 'okr' ? 'bg-stone-950 text-white' : 'hover:text-stone-950'}`}>目标结构</button>
              <button onClick={() => setActiveView('gantt')} className={`flex-1 rounded-full px-4 py-2 ${activeView === 'gantt' ? 'bg-stone-950 text-white' : 'hover:text-stone-950'}`}>推进时间线</button>
            </div>
          </div>
        </div>
      </section>

      {activeView === 'okr' ? (
        <section className="overflow-hidden rounded-[22px] border border-stone-200 bg-white shadow-sm">
          <div className="grid bg-[#fbfcf8] text-xs font-bold uppercase tracking-[0.18em] text-stone-400 lg:grid-cols-[1.05fr_1fr_1.3fr_150px]">
            <div className="border-b border-r border-stone-200 p-4">想达到的结果</div>
            <div className="border-b border-r border-stone-200 p-4">完成证据</div>
            <div className="border-b border-r border-stone-200 p-4">必要条件</div>
            <div className="border-b border-stone-200 p-4">当前进展</div>
          </div>
          <div className="grid lg:grid-cols-[1.05fr_1fr_1.3fr_150px]">
            <div className="border-b border-r border-stone-200 p-5 lg:border-b-0">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">当前目的</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-stone-950">{title}</h2>
              <p className="mt-3 text-sm leading-6 text-stone-500">{objective}</p>
              <p className="mt-4 rounded-full bg-stone-100 px-3 py-1.5 text-xs font-semibold text-stone-500">{horizon}</p>
            </div>

            <div className="border-b border-r border-stone-200 p-5 lg:border-b-0">
              <div className="grid gap-3">
                {keyResults.length ? keyResults.map((kr: any, index: number) => {
                  const progress = typeof kr.progress === 'number' ? kr.progress : 0
                  return (
                    <div key={kr.id || kr.title} className="rounded-2xl bg-stone-50 p-3">
                      <p className="text-xs font-bold text-stone-400">完成证据 {index + 1}</p>
                      <h3 className="mt-1 text-sm font-semibold leading-5 text-stone-950">{kr.title}</h3>
                      <p className="mt-1 text-xs leading-5 text-stone-500">{[kr.currentValue, kr.targetValue].filter(Boolean).join(' → ') || kr.whyNecessary || '等待证据'}</p>
                      <div className="mt-2 h-1.5 rounded-full bg-white">
                        <div className="h-1.5 rounded-full bg-emerald-500" style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }} />
                      </div>
                    </div>
                  )
                }) : (
                  <div className="rounded-2xl border border-dashed border-stone-200 p-4 text-sm leading-6 text-stone-500">还没有完成证据。这里只保留能证明目标真正达成的结果。</div>
                )}
              </div>
            </div>

            <div className="border-b border-r border-stone-200 p-5 lg:border-b-0">
              <div className="grid gap-3">
                {conditions.length ? conditions.map((condition: any) => {
                  const progress = conditionProgress(condition.status)
                  const isCurrentGap = condition.id === currentGapCondition?.id
                  return (
                    <div key={condition.id || condition.title} className={`rounded-2xl p-3 ${isCurrentGap ? 'bg-amber-50 ring-1 ring-amber-200' : 'bg-stone-50'}`}>
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="text-sm font-semibold leading-5 text-stone-950">{condition.title}</h3>
                        <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-stone-500">{condition.status}</span>
                      </div>
                      <p className="mt-1 text-xs text-stone-400">{condition.type}{isCurrentGap ? ' · 当前缺口' : ''}</p>
                      <div className="mt-2 h-1.5 rounded-full bg-white">
                        <div className="h-1.5 rounded-full bg-stone-950" style={{ width: `${Math.round(progress * 100)}%` }} />
                      </div>
                    </div>
                  )
                }) : (
                  <div className="rounded-2xl bg-stone-50 p-4 text-sm leading-6 text-stone-500">还没有必要条件。目标拆清楚后，这里只显示真正影响推进的条件。</div>
                )}
              </div>
            </div>

            <div className="p-5">
              <div className="grid h-full content-center gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-stone-400">整体进展</p>
                  <p className="mt-1 text-3xl font-semibold text-stone-950">{Math.round(overallProgress * 100)}%</p>
                </div>
                <div className="h-2 rounded-full bg-stone-100">
                  <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${Math.min(100, Math.max(0, overallProgress * 100))}%` }} />
                </div>
              </div>
            </div>
          </div>
        </section>
      ) : (
        <section className="overflow-hidden rounded-[22px] border border-stone-200 bg-white shadow-sm">
          <div className="min-w-[920px]">
            <div className="grid grid-cols-[320px_minmax(0,1fr)_96px] bg-[#fbfcf8] text-xs font-bold uppercase tracking-[0.18em] text-stone-400">
              <div className="border-b border-r border-stone-200 p-4">推进结构</div>
              <div className="grid grid-cols-5 border-b border-r border-stone-200">
                {timelineColumns.map((label) => <div key={label} className="border-r border-stone-200 p-4 last:border-r-0">{label}</div>)}
              </div>
              <div className="border-b border-stone-200 p-4">状态</div>
            </div>

            {ganttRows.map((row) => {
              const progress = Math.min(1, Math.max(0, row.progress))
              return (
                <div key={row.key} className="grid grid-cols-[320px_minmax(0,1fr)_96px]">
                  <div className="border-b border-r border-stone-200 bg-white p-4">
                    <div className="grid gap-1" style={{ paddingLeft: (row.level - 1) * 22 }}>
                      <p className="text-sm font-semibold leading-5 text-stone-950">{row.title}</p>
                      <p className="line-clamp-2 text-xs leading-5 text-stone-500">{row.subtitle}</p>
                    </div>
                  </div>
                  <div className="relative min-h-[64px] border-b border-r border-stone-200">
                    <div className="absolute inset-0 grid grid-cols-5">
                      {timelineColumns.map((label) => <div key={`${row.key}-${label}`} className="border-r border-stone-100 last:border-r-0" />)}
                    </div>
                    <div className={`absolute top-1/2 flex h-6 -translate-y-1/2 items-center justify-between gap-2 rounded-full px-3 text-xs font-bold text-white shadow-sm ${row.tone}`} style={spanStyle(row.startDate, row.endDate, progress)}>
                      <span className="truncate">{row.level === 1 ? 'Objective' : row.level === 2 ? 'Stage' : row.level === 3 ? 'Condition' : 'Day'}</span>
                      <small className="opacity-75">{Math.round(progress * 100)}%</small>
                    </div>
                  </div>
                  <div className="grid place-items-center border-b border-stone-200 p-3 text-center text-xs font-bold text-stone-500">
                    {row.status}
                  </div>
                </div>
              )
            })}
          </div>
          <div className="border-t border-stone-200 bg-[#fbfcf8] p-4 text-sm text-stone-500">
            当前阶段：{activeStageLabel}。这里仅用于查看推进结构和周期状态，调整请直接告诉 Agent。
          </div>
        </section>
      )}
    </div>
  )
}
