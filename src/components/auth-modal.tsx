'use client'

import { useState } from 'react'
import { Mail, Lock, Sparkles } from 'lucide-react'
import { useSignIn, useSignUp } from '@/hooks/use-auth'
import { toast } from 'sonner'

type AuthMode = 'login' | 'register'

interface AuthModalProps {
  isOpen: boolean
  onClose: () => void
  onAuthSuccess?: () => void
}

export function AuthModal({ isOpen, onClose, onAuthSuccess }: AuthModalProps) {
  const [mode, setMode] = useState<AuthMode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [name, setName] = useState('')

  const signIn = useSignIn()
  const signUp = useSignUp()

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (mode === 'register' && password !== confirmPassword) {
      toast.error('密码不匹配')
      return
    }

    if (mode === 'login') {
      signIn.mutate({ email, password })
    } else {
      signUp.mutate({ email, password, name })
    }
  }

  const isLoading = signIn.isPending || signUp.isPending

  const switchMode = (newMode: AuthMode) => {
    setMode(newMode)
    setEmail('')
    setPassword('')
    setConfirmPassword('')
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      onClick={onClose}
    >
      {/* 背景 */}
      <div className="absolute inset-0 bg-black/50 transition-opacity animate-in fade-in-0 duration-200" />

      {/* 弹窗内容 */}
      <div
        className="relative bg-card rounded-[2rem] shadow-[0_20px_60px_rgba(0,0,0,0.3)] w-full max-w-xl overflow-hidden animate-in fade-in-0 zoom-in-95 duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 背景装饰 */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
        <div className="absolute bottom-0 left-0 w-48 h-48 bg-primary/5 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2" />

        {/* 顶部装饰 */}
        <div className="relative overflow-hidden">
          <div className="h-2 bg-gradient-to-r from-primary via-accent to-primary" />
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-[shimmer_2s_infinite]" />
        </div>

        {/* 表单 */}
        <div className="relative px-10 py-8">
          {/* Logo */}
          <div className="flex items-center justify-center gap-2 mb-6">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center">
              <Sparkles className="w-4.5 h-4.5 text-white" />
            </div>
            <span className="text-lg font-semibold">Goal Mate</span>
          </div>

          {/* 选项卡 */}
          <div className="flex mb-6 p-1 bg-muted/60 rounded-xl backdrop-blur-sm">
            <button
              onClick={() => switchMode('login')}
              className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${
                mode === 'login'
                  ? 'bg-card text-foreground shadow-md'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              登录
            </button>
            <button
              onClick={() => switchMode('register')}
              className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${
                mode === 'register'
                  ? 'bg-card text-foreground shadow-md'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              注册
            </button>
          </div>

          <h2 className="text-xl font-semibold mb-1.5 text-center">
            {mode === 'login' ? '欢迎回来' : '创建账户'}
          </h2>
          <p className="text-sm text-muted-foreground mb-6 text-center">
            {mode === 'login' ? '登录后继续推进目标' : '创建 Goal Mate 账户'}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium flex items-center gap-2">
                  <Sparkles className="w-3.5 h-3.5 text-muted-foreground" />
                  用户名
                </label>
                <input
                  type="text"
                  placeholder="你的用户名"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="w-full px-4 py-2.5 bg-muted/50 rounded-lg outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 border-2 border-transparent transition-all text-sm"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-sm font-medium flex items-center gap-2">
                <Mail className="w-3.5 h-3.5 text-muted-foreground" />
                邮箱
              </label>
              <input
                type="email"
                placeholder="your@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full px-4 py-2.5 bg-muted/50 rounded-lg outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 border-2 border-transparent transition-all text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium flex items-center gap-2">
                <Lock className="w-3.5 h-3.5 text-muted-foreground" />
                密码
              </label>
              <input
                type="password"
                placeholder="•••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="w-full px-4 py-2.5 bg-muted/50 rounded-lg outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 border-2 border-transparent transition-all text-sm"
              />
            </div>

            {mode === 'register' && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium flex items-center gap-2">
                  <Lock className="w-3.5 h-3.5 text-muted-foreground" />
                  确认密码
                </label>
                <input
                  type="password"
                  placeholder="•••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={6}
                  className="w-full px-4 py-2.5 bg-muted/50 rounded-lg outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 border-2 border-transparent transition-all text-sm"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 bg-gradient-to-r from-primary to-accent text-white rounded-lg hover:opacity-90 transition-all font-medium shadow-lg shadow-primary/25 disabled:opacity-50 disabled:cursor-not-allowed mt-2 flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  处理中...
                </>
              ) : (
                <>
                  {mode === 'login' ? '登录' : '创建账户'}
                  <Sparkles className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
