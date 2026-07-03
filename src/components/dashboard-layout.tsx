'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { Bot, CalendarCheck, FileText, Goal, LogOut, Settings, UserRound } from 'lucide-react'

import { useAuthSession, useSignOut } from '@/hooks/use-auth'

const navItems = [
  { href: '/dashboard/today', icon: CalendarCheck, label: 'Today', helper: '下一步行动' },
  { href: '/dashboard/goals', icon: Goal, label: 'Goals', helper: '目标拆解' },
  { href: '/dashboard/logs', icon: FileText, label: 'Logs', helper: '推进记录' },
  { href: '/dashboard/agent', icon: Bot, label: 'Agent', helper: '对话控制' },
  { href: '/dashboard/settings', icon: Settings, label: 'Settings', helper: '系统配置' },
]

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const session = useAuthSession()
  const signOut = useSignOut()

  const user = session.data?.user
  const isCheckingSession = session.isPending

  useEffect(() => {
    if (!isCheckingSession && !user) {
      router.replace('/login')
    }
  }, [isCheckingSession, router, user])

  if (isCheckingSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f4f1ea] px-6 text-stone-600">
        <div className="rounded-[2rem] border border-stone-200 bg-white px-6 py-5 shadow-sm">
          正在确认登录状态...
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f4f1ea] px-6 text-stone-600">
        <div className="rounded-[2rem] border border-stone-200 bg-white px-6 py-5 shadow-sm">
          正在前往登录页...
        </div>
      </div>
    )
  }

  const displayName = user.name || user.email || 'Goal Mate User'
  const displayEmail = user.email || '已登录'

  return (
    <div className="min-h-screen bg-[#f4f1ea] text-stone-950">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-72 border-r border-stone-200 bg-[#fbfaf7]/95 px-5 py-6 shadow-sm backdrop-blur xl:flex xl:flex-col">
        <div>
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
        </div>

        <div className="mt-auto rounded-[24px] border border-stone-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-stone-950 text-white">
              <UserRound className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-stone-950">{displayName}</p>
              <p className="truncate text-xs text-stone-500">{displayEmail}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => signOut.mutate()}
            disabled={signOut.isPending}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-stone-100 px-4 py-2.5 text-sm font-semibold text-stone-700 transition hover:bg-stone-200 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <LogOut className="h-4 w-4" />
            {signOut.isPending ? '正在退出...' : '退出登录'}
          </button>
        </div>
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
          <button
            type="button"
            onClick={() => signOut.mutate()}
            className="rounded-full bg-stone-950 p-2 text-white"
            aria-label="退出登录"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      <main className="xl:pl-72">{children}</main>
    </div>
  )
}
