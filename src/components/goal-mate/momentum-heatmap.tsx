'use client'

import { useEffect, useMemo, useState } from 'react'

const levels = ['bg-stone-200', 'bg-emerald-100', 'bg-emerald-300', 'bg-emerald-500', 'bg-emerald-700']
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const scopes = [
  { label: 'Year', weeks: 53 },
  { label: 'Quarter', weeks: 13 },
  { label: 'Month', weeks: 5 },
  { label: 'Week', weeks: 1 },
]

function normalizeScope(value?: string) {
  const normalized = String(value || '').toLowerCase()
  if (normalized === 'quarter') return 'Quarter'
  if (normalized === 'month') return 'Month'
  if (normalized === 'week') return 'Week'
  return 'Year'
}

type MomentumEntry = {
  date: string
  count: number
  level: number
}

function dateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function buildWeeks(count: number, entries: MomentumEntry[]) {
  const byDate = new Map(entries.map((entry) => [entry.date, Math.max(0, Math.min(4, Math.round(entry.level || 0)))]))
  const today = new Date()
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const start = new Date(end)
  start.setDate(end.getDate() - count * 7 + 1)
  start.setDate(start.getDate() - start.getDay())

  return Array.from({ length: count }, (_, weekIndex) => {
    return Array.from({ length: 7 }, (_, dayIndex) => {
      const date = new Date(start)
      date.setDate(start.getDate() + weekIndex * 7 + dayIndex)
      if (date > end) return 0
      return byDate.get(dateKey(date)) || 0
    })
  })
}

function scopeTitle(scope: string) {
  if (scope === 'Quarter') return '季度推进热力图'
  if (scope === 'Month') return '月度推进热力图'
  if (scope === 'Week') return '本周推进热力图'
  return '年度推进热力图'
}

export function MomentumHeatmap({ defaultScope = 'year', entries = [] }: { defaultScope?: string; entries?: MomentumEntry[] }) {
  const [scope, setScope] = useState(() => normalizeScope(defaultScope))

  useEffect(() => {
    setScope(normalizeScope(defaultScope))
  }, [defaultScope])

  const selectedScope = scopes.find((item) => item.label === scope) || scopes[0]
  const heatmapWeeks = useMemo(() => buildWeeks(selectedScope.weeks, entries), [entries, selectedScope.weeks])
  const activeDays = heatmapWeeks.flat().filter((value) => value > 0).length
  const cellSize = scope === 'Year' ? 'h-[5px] w-[5px]' : scope === 'Quarter' ? 'h-[8px] w-[8px]' : 'h-[11px] w-[11px]'
  const weekGap = scope === 'Year' ? 'gap-[2px]' : 'gap-[3px]'

  return (
    <section className="rounded-[28px] border border-stone-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-400">Momentum</p>
          <h2 className="mt-1 text-xl font-semibold text-stone-950">{scopeTitle(scope)}</h2>
          <p className="mt-1 text-xs text-stone-500">{activeDays} active days · 来自真实 Check-in</p>
        </div>
        <div className="flex rounded-full bg-stone-100 p-1 text-xs text-stone-500">
          {scopes.map((item) => (
            <button
              key={item.label}
              onClick={() => setScope(item.label)}
              className={`rounded-full px-3 py-1 ${item.label === scope ? 'bg-stone-950 text-white' : 'hover:text-stone-900'}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div className="max-w-full overflow-hidden pb-1">
        <div className="w-full">
          {scope === 'Year' && (
            <div className="mb-2 grid grid-cols-12 text-[10px] text-stone-400">
              {months.map((month) => (
                <span key={month}>{month}</span>
              ))}
            </div>
          )}
          <div className={`flex max-w-full ${weekGap}`}>
            {heatmapWeeks.map((week, weekIndex) => (
              <div key={weekIndex} className={`grid grid-rows-7 ${weekGap}`}>
                {week.map((value, dayIndex) => (
                  <span
                    key={`${weekIndex}-${dayIndex}`}
                    title={`week ${weekIndex + 1}, day ${dayIndex + 1}`}
                    className={`block rounded-[1px] ${cellSize} ${levels[value]}`}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
