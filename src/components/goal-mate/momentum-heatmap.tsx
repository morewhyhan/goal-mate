'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

const levels = ['#e6ebe0', '#cfe1d4', '#94bf9e', '#4f8f63', '#1f6138']

type MomentumEntry = {
  date: string
  count: number
  level: number
}

const rangeConfig = {
  year: {
    labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    foot: 'Yearly goal movement',
    count: 364,
  },
  quarter: {
    labels: ['Jul', 'Aug', 'Sep'],
    foot: 'Quarter goal movement',
    count: 91,
  },
  month: {
    labels: ['Week 1', 'Week 2', 'Week 3', 'Week 4', 'Week 5'],
    foot: 'Monthly goal movement',
    count: 35,
  },
  week: {
    labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    foot: 'Weekly goal movement',
    count: 7,
  },
}

function normalizeRange(value?: string): keyof typeof rangeConfig {
  const normalized = String(value || '').toLowerCase()
  if (normalized === 'quarter') return 'quarter'
  if (normalized === 'month') return 'month'
  if (normalized === 'week') return 'week'
  return 'year'
}

function dateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function buildCells(count: number, entries: MomentumEntry[]) {
  const byDate = new Map<string, { level: number; count: number }>()
  for (const entry of entries) {
    byDate.set(entry.date, {
      level: Math.max(0, Math.min(4, Math.round(entry.level || 0))),
      count: Math.max(0, Number(entry.count) || 0),
    })
  }
  const today = new Date()
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const start = new Date(end)
  start.setDate(end.getDate() - count + 1)
  let total = 0

  const cells = Array.from({ length: count }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    const entry = byDate.get(dateKey(date))
    if (entry) total += entry.count
    return entry?.level || 0
  })

  return { cells, total }
}

function rangeTitle(range: keyof typeof rangeConfig, total: number) {
  const now = new Date()
  if (range === 'year') return `${now.getFullYear()}: ${total} Contributions`
  if (range === 'quarter') return `Q${Math.floor(now.getMonth() / 3) + 1}: ${total} Contributions`
  if (range === 'month') return `${now.toLocaleString('en-US', { month: 'long' })}: ${total} Contributions`
  return `This week: ${total} Contributions`
}

export function MomentumHeatmap({ defaultScope = 'year', entries = [] }: { defaultScope?: string; entries?: MomentumEntry[] }) {
  const [range, setRange] = useState<keyof typeof rangeConfig>(() => normalizeRange(defaultScope))
  const viewportRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setRange(normalizeRange(defaultScope))
  }, [defaultScope])

  const config = rangeConfig[range]
  const momentum = useMemo(() => buildCells(config.count, entries), [config.count, entries])
  const cells = momentum.cells
  const total = momentum.total
  const columnCount = Math.ceil(config.count / 7)
  const heatmapWidth = columnCount * 9 + Math.max(0, columnCount - 1) * 3
  const scrollable = range === 'year'

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || !scrollable) return
    requestAnimationFrame(() => {
      viewport.scrollLeft = viewport.scrollWidth - viewport.clientWidth
    })
  }, [scrollable, cells.length])

  return (
    <section className="min-w-0 overflow-hidden rounded-[18px] border border-stone-200 bg-white p-[14px] shadow-sm">
      <div className="mb-3 flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="block text-[11px] font-semibold uppercase tracking-[0.28em] text-stone-400">Momentum</span>
          <h3 className="mt-1 truncate font-mono text-[13px] font-bold leading-none text-stone-700">{rangeTitle(range, total)}</h3>
        </div>
        <div className="flex shrink-0 rounded-full border border-stone-200 bg-[#f6f4ee] p-1">
          {(Object.keys(rangeConfig) as Array<keyof typeof rangeConfig>).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setRange(item)}
              className={`rounded-full px-2 py-1 text-[10px] font-semibold capitalize leading-none ${item === range ? 'bg-stone-950 text-white' : 'text-stone-500 hover:text-stone-950'}`}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      <div className="relative min-w-0">
        <div
          ref={viewportRef}
          className={`min-w-0 overflow-y-hidden pr-1 [&::-webkit-scrollbar]:hidden ${scrollable ? 'cursor-grab overflow-x-auto active:cursor-grabbing' : 'overflow-x-hidden'}`}
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          <div className="w-max" style={{ width: heatmapWidth }}>
            <div
              className="mb-[6px] grid gap-[2px] text-[10px] leading-none text-stone-400"
              style={{ gridTemplateColumns: `repeat(${config.labels.length}, 1fr)`, width: heatmapWidth }}
            >
              {config.labels.map((label) => <span key={label}>{label}</span>)}
            </div>

            <div
              aria-label="Momentum heatmap"
              className="grid grid-flow-col grid-rows-7 justify-start gap-[3px]"
              style={{ gridAutoColumns: '9px' }}
            >
              {cells.map((level, index) => (
                <span
                  key={index}
                  className="h-[9px] w-[9px] rounded-[2px]"
                  style={{ backgroundColor: levels[level] || levels[0] }}
                />
              ))}
            </div>
          </div>
        </div>
        {scrollable && <div className="pointer-events-none absolute inset-y-0 left-0 w-7 bg-gradient-to-r from-white via-white/85 to-transparent" />}
        {scrollable && <div className="pointer-events-none absolute inset-y-0 right-0 w-5 bg-gradient-to-l from-white/95 to-transparent" />}
      </div>

      <div className="mt-3 flex min-w-0 items-center justify-between gap-2 text-[10px] leading-none text-stone-400">
        <span className="min-w-0 truncate">{config.foot}</span>
        <span className="flex shrink-0 items-center gap-[5px]">
          Less
          {levels.map((color) => (
            <i key={color} className="h-[9px] w-[9px] rounded-[2px]" style={{ backgroundColor: color }} />
          ))}
          More
        </span>
      </div>
    </section>
  )
}
