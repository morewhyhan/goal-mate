'use client'

import { FormEvent, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, Lock, Mail, Sparkles, UserRound } from 'lucide-react'

import { useAuthSession, useSignIn, useSignUp } from '@/hooks/use-auth'

type AuthMode = 'login' | 'register'

export default function LoginPage() {
  const router = useRouter()
  const session = useAuthSession()
  const signIn = useSignIn()
  const signUp = useSignUp()

  const [mode, setMode] = useState<AuthMode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')

  const user = session.data?.user
  const isLoading = signIn.isPending || signUp.isPending

  useEffect(() => {
    if (user) {
      router.replace('/dashboard/today')
    }
  }, [router, user])

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (mode === 'login') {
      signIn.mutate({ email, password })
      return
    }

    signUp.mutate({ email, password, name })
  }

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode)
    setPassword('')
  }

  return (
    <main className="min-h-screen bg-[#f4f1ea] px-5 py-8 text-stone-950">
      <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-6xl overflow-hidden rounded-[2rem] border border-stone-200 bg-[#fbfaf7] shadow-[0_28px_80px_rgba(28,25,23,0.12)] lg:grid-cols-[1.05fr_0.95fr]">
        <section className="relative hidden border-r border-stone-200 bg-stone-950 p-10 text-white lg:flex lg:flex-col lg:justify-between">
          <div className="absolute inset-0 opacity-70 [background:radial-gradient(circle_at_18%_18%,rgba(245,158,11,0.28),transparent_28%),radial-gradient(circle_at_86%_22%,rgba(34,197,94,0.18),transparent_25%),linear-gradient(135deg,#1c1917,#0c0a09)]" />
          <div className="relative">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm text-stone-200">
              <Sparkles className="h-4 w-4" />
              Goal Mate
            </div>
            <h1 className="mt-12 max-w-xl text-5xl font-semibold leading-[1.05] tracking-tight">
              只说你想达到什么，剩下让 AI 推进。
            </h1>
            <p className="mt-6 max-w-md text-base leading-7 text-stone-300">
              登录后进入你的目标、日志、Agent 记忆和提醒配置。这里不是打卡工具，是你的个人目标推进工作区。
            </p>
          </div>
          <div className="relative grid grid-cols-3 gap-3 text-sm text-stone-300">
            <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
              <strong className="block text-white">输入结果</strong>
              <span className="mt-2 block">你说想要什么</span>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
              <strong className="block text-white">每日反馈</strong>
              <span className="mt-2 block">你说做得怎样</span>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
              <strong className="block text-white">下一步</strong>
              <span className="mt-2 block">AI 告诉你现在做什么</span>
            </div>
          </div>
        </section>

        <section className="flex items-center justify-center p-6 sm:p-10">
          <div className="w-full max-w-md">
            <div className="mb-10 lg:hidden">
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-stone-500">Goal Mate</p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight">进入你的目标推进工作区</h1>
            </div>

            <div className="mb-7 inline-flex rounded-full border border-stone-200 bg-white p-1 shadow-sm">
              <button
                type="button"
                onClick={() => switchMode('login')}
                className={`rounded-full px-5 py-2 text-sm font-semibold transition ${mode === 'login' ? 'bg-stone-950 text-white' : 'text-stone-500 hover:text-stone-950'}`}
              >
                登录
              </button>
              <button
                type="button"
                onClick={() => switchMode('register')}
                className={`rounded-full px-5 py-2 text-sm font-semibold transition ${mode === 'register' ? 'bg-stone-950 text-white' : 'text-stone-500 hover:text-stone-950'}`}
              >
                注册
              </button>
            </div>

            <h2 className="text-3xl font-semibold tracking-tight">
              {mode === 'login' ? '继续推进目标' : '创建 Goal Mate 账户'}
            </h2>
            <p className="mt-3 text-sm leading-6 text-stone-500">
              {mode === 'login'
                ? '登录后直接进入 Today，看到当前唯一下一步。'
                : '注册后会进入你的个人工作区，目标、日志和 Agent 记忆都会归属这个账户。'}
            </p>

            <form onSubmit={handleSubmit} className="mt-8 space-y-4">
              {mode === 'register' && (
                <label className="block">
                  <span className="mb-2 flex items-center gap-2 text-sm font-semibold text-stone-700">
                    <UserRound className="h-4 w-4 text-stone-400" />
                    昵称
                  </span>
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    required
                    className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-stone-950 focus:ring-4 focus:ring-stone-200"
                    placeholder="你的名字"
                  />
                </label>
              )}

              <label className="block">
                <span className="mb-2 flex items-center gap-2 text-sm font-semibold text-stone-700">
                  <Mail className="h-4 w-4 text-stone-400" />
                  邮箱
                </span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-stone-950 focus:ring-4 focus:ring-stone-200"
                  placeholder="you@example.com"
                />
              </label>

              <label className="block">
                <span className="mb-2 flex items-center gap-2 text-sm font-semibold text-stone-700">
                  <Lock className="h-4 w-4 text-stone-400" />
                  密码
                </span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  minLength={6}
                  className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-stone-950 focus:ring-4 focus:ring-stone-200"
                  placeholder="至少 6 位"
                />
              </label>

              <button
                type="submit"
                disabled={isLoading}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl bg-stone-950 px-5 py-3.5 text-sm font-semibold text-white shadow-lg shadow-stone-950/15 transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isLoading ? '处理中...' : mode === 'login' ? '登录并进入 Today' : '创建账户并进入 Today'}
                <ArrowRight className="h-4 w-4" />
              </button>
            </form>

            <p className="mt-6 rounded-2xl bg-white px-4 py-3 text-xs leading-5 text-stone-500">
              v0.1 仅开放邮箱密码登录。第三方登录、手机号登录和找回密码后续再接入，不在这里放假入口。
            </p>
          </div>
        </section>
      </div>
    </main>
  )
}
