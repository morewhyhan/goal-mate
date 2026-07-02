import { heatmapWeeks } from '@/lib/goal-mate-demo-data'

const levels = ['bg-stone-200', 'bg-emerald-100', 'bg-emerald-300', 'bg-emerald-500', 'bg-emerald-700']
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function MomentumHeatmap() {
  return (
    <section className="rounded-[28px] border border-stone-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-400">Momentum</p>
          <h2 className="mt-1 text-xl font-semibold text-stone-950">年度推进热力图</h2>
        </div>
        <div className="flex rounded-full bg-stone-100 p-1 text-xs text-stone-500">
          {['Year', 'Quarter', 'Month', 'Week'].map((item, index) => (
            <span key={item} className={`rounded-full px-3 py-1 ${index === 0 ? 'bg-stone-950 text-white' : ''}`}>
              {item}
            </span>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto pb-2">
        <div className="min-w-[720px]">
          <div className="mb-2 grid grid-cols-12 text-[10px] text-stone-400">
            {months.map((month) => (
              <span key={month}>{month}</span>
            ))}
          </div>
          <div className="flex gap-[3px]">
            {heatmapWeeks.map((week, weekIndex) => (
              <div key={weekIndex} className="grid grid-rows-7 gap-[3px]">
                {week.map((value, dayIndex) => (
                  <span
                    key={`${weekIndex}-${dayIndex}`}
                    title={`week ${weekIndex + 1}, day ${dayIndex + 1}`}
                    className={`block h-[9px] w-[9px] rounded-[2px] ${levels[value]}`}
                  />
                ))}
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-end gap-2 text-[11px] text-stone-400">
            <span>Less</span>
            {[0, 1, 2, 3, 4].map((level) => (
              <span key={level} className={`h-[9px] w-[9px] rounded-[2px] ${levels[level]}`} />
            ))}
            <span>More</span>
          </div>
        </div>
      </div>
    </section>
  )
}
