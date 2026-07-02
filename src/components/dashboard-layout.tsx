'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Bot, CalendarCheck, FileText, Goal, Settings } from 'lucide-react'

const navItems = [
  { href: '/dashboard/today', icon: CalendarCheck, label: 'Today', helper: '下一步行动' },
  { href: '/dashboard/goals', icon: Goal, label: 'Goals', helper: '目标拆解' },
  { href: '/dashboard/logs', icon: FileText, label: 'Logs', helper: '推进记录' },
  { href: '/dashboard/agent', icon: Bot, label: 'Agent', helper: '对话控制' },
  { href: '/dashboard/settings', icon: Settings, label: 'Settings', helper: '系统配置' },
]

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <div className="min-h-screen bg-[#f4f1ea] text-stone-950">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-72 border-r border-stone-200 bg-[#fbfaf7]/95 px-5 py-6 shadow-sm backdrop-blur xl:block">
        <Link href="/dashboard/today" className="block rounded-[28px] bg-stone-950 p-5 text-white">
          <p className="text-xs font-semibold uppercase tracking-[0.32em] text-stone-400">Goal Mate</p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">AI 目标推进秘书</h1>
          <p className="mt-3 text-sm leading-6 text-stone-300">理解目标、倒推路径、每天推进。</p>
        </Link>

        <nav className="mt-8 space-y-2">
          {navItems.map((item) => {
            const active = pathname === item.href
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-2xl px-4 py-3 transition-colors ${active ? 'bg-white text-stone-950 shadow-sm' : 'text-stone-500 hover:bg-white/70 hover:text-stone-950'}`}
              >
                <Icon className="h-5 w-5" />
                <span className="flex-1">
                  <span className="block text-sm font-semibold">{item.label}</span>
                  <span className="block text-xs text-stone-400">{item.helper}</span>
                </span>
              </Link>
            )
          })}
        </nav>
      </aside>

      <header className="sticky top-0 z-30 border-b border-stone-200 bg-[#fbfaf7]/95 px-4 py-3 backdrop-blur xl:hidden">
        <div className="flex items-center justify-between">
          <Link href="/dashboard/today" className="font-semibold">Goal Mate</Link>
          <div className="flex gap-1 overflow-x-auto">
            {navItems.map((item) => (
              <Link key={item.href} href={item.href} className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-stone-600">
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      </header>

      <main className="xl:pl-72">{children}</main>
    </div>
  )
}
