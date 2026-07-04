'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { Bot, CalendarCheck, FileText, Goal, LogOut, Settings, UserRound } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'

import { client } from '@/lib/api-client'
import { useAuthSession, useSignOut } from '@/hooks/use-auth'
import { BrandLogo } from '@/components/brand-logo'

const navItems = [
  { href: '/dashboard/today', icon: CalendarCheck, label: 'Today', helper: '下一步行动' },
  { href: '/dashboard/goals', icon: Goal, label: 'Goals', helper: '目标拆解' },
  { href: '/dashboard/logs', icon: FileText, label: 'Logs', helper: '推进记录' },
  { href: '/dashboard/agent', icon: Bot, label: 'Agent', helper: '对话控制' },
  { href: '/dashboard/settings', icon: Settings, label: 'Settings', helper: '系统配置' },
]

type DashboardUser = {
  id?: string | null
  name?: string | null
  email?: string | null
}

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const queryClient = useQueryClient()
  const session = useAuthSession()
  const signOut = useSignOut()
  const [pendingHref, setPendingHref] = useState<string | null>(null)
  const [sessionProbe, setSessionProbe] = useState<{ done: boolean; user: DashboardUser | null }>({ done: false, user: null })
  const warmedRoutesRef = useRef(false)
  const lastUserIdRef = useRef<string | null>(null)

  const user = (session.data?.user || sessionProbe.user) as DashboardUser | null | undefined
  const isCheckingSession = session.isPending && !sessionProbe.done
  const isRoutePending = Boolean(pendingHref && pendingHref !== pathname)

  const prefetchDashboardData = (href: string) => {
    const staleTime = 5 * 60 * 1000
    const prefetch = (queryKey: unknown[], queryFn: () => Promise<any>) => {
      void queryClient.prefetchQuery({ queryKey, queryFn, staleTime })
    }

    if (href === '/dashboard/today') {
      prefetch(['today'], async () => (await client.api.today.$get()).json())
      prefetch(['settings'], async () => (await client.api.settings.$get()).json())
      return
    }

    if (href === '/dashboard/goals') {
      prefetch(['goals'], async () => (await client.api.goals.$get()).json())
      return
    }

    if (href === '/dashboard/logs') {
      prefetch(['logs', 'tree'], async () => {
        const tree: any = await (await client.api.logs.tree.$get()).json()
        const firstLogId = Array.isArray(tree?.data) ? tree.data[0]?.id : null
        if (firstLogId) {
          prefetch(['log', firstLogId], async () => (await client.api.logs[':id'].$get({ param: { id: firstLogId } })).json())
        }
        return tree
      })
      return
    }

    if (href === '/dashboard/agent') {
      prefetch(['agent', 'threads'], async () => {
        const threads: any = await (await client.api.agent.threads.$get()).json()
        const firstThreadId = Array.isArray(threads?.data) ? threads.data[0]?.id : null
        if (firstThreadId) {
          prefetch(['agent', 'messages', firstThreadId], async () => (await client.api.agent.threads[':id'].messages.$get({ param: { id: firstThreadId } })).json())
        }
        return threads
      })
      prefetch(['agent', 'tool-actions'], async () => (await client.api.agent.tools.actions.$get()).json())
      return
    }

    if (href === '/dashboard/settings') {
      prefetch(['settings-control-center'], async () => (await client.api.settings['control-center'].$get()).json())
    }
  }

  useEffect(() => {
    if (!isCheckingSession && !user) {
      router.replace('/login')
    }
  }, [isCheckingSession, router, user])

  useEffect(() => {
    if (!session.isPending) {
      setSessionProbe({ done: false, user: null })
      return
    }

    let cancelled = false
    const handle = window.setTimeout(() => {
      void fetch('/api/auth/get-session', {
        cache: 'no-store',
        credentials: 'include',
      })
        .then(async (response) => {
          if (!response.ok) return null
          return response.json()
        })
        .then((data) => {
          if (cancelled) return
          setSessionProbe({
            done: true,
            user: (data?.user || data?.data?.user || null) as DashboardUser | null,
          })
        })
        .catch(() => {
          if (cancelled) return
          setSessionProbe({ done: true, user: null })
        })
    }, 1200)

    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [pathname, session.isPending])

  useEffect(() => {
    if (isCheckingSession) return
    const currentUserId = user?.id || null
    if (lastUserIdRef.current && lastUserIdRef.current !== currentUserId) {
      queryClient.clear()
      warmedRoutesRef.current = false
    }
    lastUserIdRef.current = currentUserId
  }, [isCheckingSession, queryClient, user?.id])

  useEffect(() => {
    setPendingHref(null)
  }, [pathname])

  useEffect(() => {
    navItems.forEach((item) => router.prefetch(item.href))
  }, [router])

  useEffect(() => {
    if (!user || warmedRoutesRef.current || typeof window === 'undefined') return
    warmedRoutesRef.current = true

    type IdleWindow = Window & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number
      cancelIdleCallback?: (handle: number) => void
    }

    const idleWindow = window as IdleWindow
    const warmup = async () => {
      const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))
      for (const item of navItems) {
        if (item.href === pathname) continue
        router.prefetch(item.href)
        prefetchDashboardData(item.href)
        void window.fetch(item.href, {
          credentials: 'include',
          headers: { purpose: 'prefetch' },
        }).catch(() => undefined)
        await sleep(350)
      }
    }

    const handle = idleWindow.requestIdleCallback
      ? idleWindow.requestIdleCallback(() => void warmup(), { timeout: 3000 })
      : window.setTimeout(() => void warmup(), 2200)

    return () => {
      if (typeof idleWindow.cancelIdleCallback === 'function' && typeof idleWindow.requestIdleCallback === 'function') {
        idleWindow.cancelIdleCallback(handle)
      } else {
        window.clearTimeout(handle)
      }
    }
  }, [pathname, queryClient, router, user])

  const primeRoute = (href: string) => {
    if (href !== pathname) {
      router.prefetch(href)
      prefetchDashboardData(href)
    }
  }

  const markRoutePending = (href: string) => {
    if (href !== pathname) setPendingHref(href)
  }

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
          <Link href="/dashboard/today" className="flex items-center gap-3 rounded-[24px] border border-stone-200 bg-white p-4 text-stone-950 shadow-sm">
            <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-2xl border border-stone-200 bg-[#f4f1ea]">
              <BrandLogo className="h-full w-full" />
            </span>
            <span className="min-w-0">
              <span className="block text-lg font-semibold tracking-tight">Goal Mate</span>
              <span className="block truncate text-sm text-stone-500">AI 目标推进秘书</span>
            </span>
          </Link>

          <nav className="mt-8 space-y-2">
            {navItems.map((item) => {
              const active = pathname === item.href
              const pending = pendingHref === item.href && !active
              const Icon = item.icon
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch
                  onMouseEnter={() => primeRoute(item.href)}
                  onFocus={() => primeRoute(item.href)}
                  onClick={() => markRoutePending(item.href)}
                  className={`flex min-h-[64px] items-center gap-4 rounded-[22px] px-4 py-3 transition-[background-color,color,box-shadow,transform] duration-150 ${active ? 'bg-white text-stone-950 shadow-sm ring-1 ring-stone-100' : pending ? 'translate-x-0.5 bg-white/85 text-stone-800 shadow-sm' : 'text-stone-500 hover:translate-x-0.5 hover:bg-white/75 hover:text-stone-950'}`}
                >
                  <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-2xl ${active ? 'bg-stone-950 text-white' : 'bg-white text-stone-400 shadow-sm'}`}>
                    <Icon className="h-5 w-5" />
                  </span>
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
          <Link href="/dashboard/today" prefetch onMouseEnter={() => primeRoute('/dashboard/today')} onFocus={() => primeRoute('/dashboard/today')} onClick={() => markRoutePending('/dashboard/today')} className="flex items-center gap-2 font-semibold">
            <BrandLogo className="h-7 w-7 rounded-lg border border-stone-200" />
            Goal Mate
          </Link>
          <div className="flex gap-1 overflow-x-auto">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                prefetch
                onMouseEnter={() => primeRoute(item.href)}
                onFocus={() => primeRoute(item.href)}
                onClick={() => markRoutePending(item.href)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${pathname === item.href ? 'bg-stone-950 text-white' : 'bg-white text-stone-600'}`}
              >
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

      <main className="relative xl:pl-72" aria-busy={isRoutePending}>
        {isRoutePending ? (
          <div className="fixed left-0 right-0 top-0 z-50 h-[3px] overflow-hidden bg-stone-200/60 xl:left-72">
            <div className="goal-route-progress h-full w-1/2 rounded-r-full bg-stone-950" />
          </div>
        ) : null}
        <div key={pathname} className="goal-route-shell">
          {children}
        </div>
      </main>
    </div>
  )
}
