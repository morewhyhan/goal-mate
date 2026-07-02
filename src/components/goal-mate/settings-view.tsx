'use client'

import { useEffect, useState } from 'react'
import { useUpdateModel } from '@/hooks/use-models'
import { useExportUserData, useSettingsControlCenter, useTestModelConnection, useUpdateReminderRules } from '@/hooks/use-settings'

type ReminderDraft = {
  id?: string
  reminderType: string
  channel: string
  schedule: string
  timezone: string
  maxPerDay: number
  enabled: boolean
}

const reminderMeta = [
  { type: 'morning_planning', label: '早晨规划', purpose: '确认今天只推进哪一步。' },
  { type: 'midday_check', label: '中午检查', purpose: '判断是否偏离，是否需要缩小动作。' },
  { type: 'evening_review', label: '晚上复盘', purpose: '记录完成情况和未完成原因。' },
  { type: 'weekly_review', label: '周复盘', purpose: '总结本周推进了哪个条件。' },
]

const defaultReminderDrafts: ReminderDraft[] = [
  { reminderType: 'morning_planning', channel: 'qq', schedule: '08:30', timezone: 'Asia/Shanghai', maxPerDay: 1, enabled: true },
  { reminderType: 'midday_check', channel: 'qq', schedule: '12:30', timezone: 'Asia/Shanghai', maxPerDay: 1, enabled: true },
  { reminderType: 'evening_review', channel: 'qq', schedule: '21:30', timezone: 'Asia/Shanghai', maxPerDay: 1, enabled: true },
  { reminderType: 'weekly_review', channel: 'qq', schedule: 'SUN 21:00', timezone: 'Asia/Shanghai', maxPerDay: 1, enabled: true },
]

function statusClass(status?: string) {
  const normalized = String(status || '').toLowerCase()
  if (normalized.includes('enabled') || normalized.includes('sent') || normalized.includes('executed') || normalized.includes('drafted') || normalized.includes('ok') || normalized.includes('configured') || normalized.includes('bound') || normalized.includes('responded')) {
    return 'bg-emerald-100 text-emerald-800'
  }
  if (normalized.includes('pending') || normalized.includes('approved')) return 'bg-amber-100 text-amber-800'
  if (normalized.includes('failed') || normalized.includes('error')) return 'bg-red-100 text-red-800'
  return 'bg-stone-100 text-stone-700'
}

function formatDate(value?: string) {
  if (!value) return '暂无'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '暂无'
  return date.toLocaleString('zh-CN', { hour12: false })
}

function ruleLabel(type: string) {
  return reminderMeta.find((item) => item.type === type)?.label || type
}

export function SettingsView() {
  const controlCenter = useSettingsControlCenter()
  const updateModel = useUpdateModel()
  const updateReminderRules = useUpdateReminderRules()
  const testModel = useTestModelConnection()
  const exportUserData = useExportUserData()

  const data = controlCenter.data?.data
  const model = data?.model
  const runtimeStatus = data?.runtimeStatus || {}
  const qqBindings = data?.qqBindings || []
  const toolActions = data?.toolActions || []
  const schedulerEvents = data?.schedulerEvents || []

  const [modelDraft, setModelDraft] = useState({
    provider: 'DeepSeek',
    model: 'deepseek-v4-flash',
    reasoningModel: '',
    apiBase: 'https://api.deepseek.com',
    temperature: '0.3',
  })
  const [reminderDrafts, setReminderDrafts] = useState<ReminderDraft[]>(defaultReminderDrafts)

  useEffect(() => {
    if (!model) return
    setModelDraft({
      provider: model.provider || 'DeepSeek',
      model: model.model || 'deepseek-v4-flash',
      reasoningModel: model.reasoningModel || '',
      apiBase: model.apiBase || 'https://api.deepseek.com',
      temperature: String(model.temperature ?? 0.3),
    })
  }, [model?.id, model?.provider, model?.model, model?.reasoningModel, model?.apiBase, model?.temperature])

  useEffect(() => {
    const rules = data?.reminderRules || []
    if (!rules.length) return
    setReminderDrafts(defaultReminderDrafts.map((fallback) => {
      const rule = rules.find((item: any) => item.reminderType === fallback.reminderType && item.channel === fallback.channel)
      return {
        id: rule?.id,
        reminderType: fallback.reminderType,
        channel: rule?.channel || fallback.channel,
        schedule: rule?.schedule || fallback.schedule,
        timezone: rule?.timezone || fallback.timezone,
        maxPerDay: rule?.maxPerDay || fallback.maxPerDay,
        enabled: typeof rule?.enabled === 'boolean' ? rule.enabled : fallback.enabled,
      }
    }))
  }, [data?.reminderRules])

  function saveModel() {
    if (!model?.id) return
    const temperature = Number(modelDraft.temperature)
    updateModel.mutate({
      id: model.id,
      provider: modelDraft.provider,
      model: modelDraft.model,
      reasoningModel: modelDraft.reasoningModel || undefined,
      apiBase: modelDraft.apiBase,
      usage: 'CHAT',
      isDefault: true,
      temperature: Number.isFinite(temperature) ? temperature : 0.3,
    })
  }

  function saveReminderRules() {
    updateReminderRules.mutate({
      rules: reminderDrafts.map((rule) => ({
        id: rule.id,
        reminderType: rule.reminderType,
        channel: rule.channel,
        schedule: rule.schedule,
        timezone: rule.timezone,
        maxPerDay: Number(rule.maxPerDay) || 1,
        enabled: rule.enabled,
      })),
    })
  }

  function updateReminder(index: number, patch: Partial<ReminderDraft>) {
    setReminderDrafts((drafts) => drafts.map((draft, currentIndex) => currentIndex === index ? { ...draft, ...patch } : draft))
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] overflow-x-hidden bg-[#f4f1ea] p-5 text-stone-950 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-[36px] border border-stone-200 bg-white p-6 shadow-sm md:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-400">Settings</p>
          <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-end">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-stone-950 md:text-4xl">让 Agent 稳定工作</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-stone-500">
                这里配置 Agent 能不能工作：模型、提醒、QQ 通道、工具权限和数据导出。
              </p>
            </div>
            <div className="grid min-w-0 grid-cols-3 gap-2 rounded-3xl bg-stone-950 p-3 text-white">
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-[0.18em] text-stone-400">Model</p>
                <p className="mt-1 truncate text-sm font-semibold">{model?.model || '未配置'}</p>
              </div>
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-[0.18em] text-stone-400">QQ</p>
                <p className="mt-1 text-sm font-semibold">{qqBindings.length ? '已绑定' : '未绑定'}</p>
              </div>
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-[0.18em] text-stone-400">Tools</p>
                <p className="mt-1 text-sm font-semibold">{toolActions.length} 条记录</p>
              </div>
            </div>
          </div>
        </header>

        <section className="grid gap-3 md:grid-cols-5">
          {Object.entries(runtimeStatus).map(([key, item]: [string, any]) => (
            <div key={key} className="min-w-0 rounded-[28px] border border-stone-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">{key}</p>
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusClass(item?.status)}`}>{item?.status || 'unknown'}</span>
              </div>
              <p className="mt-3 text-sm font-semibold text-stone-900">{item?.label || '暂无状态'}</p>
              <p className="mt-1 break-words text-xs text-stone-500">{item?.evidence || 'no evidence'}</p>
            </div>
          ))}
        </section>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
          <section className="rounded-[36px] border border-stone-200 bg-white p-6 shadow-sm">
            <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-400">Model</p>
                <h2 className="mt-2 text-2xl font-semibold">模型配置</h2>
                <p className="mt-2 text-sm leading-6 text-stone-500">Agent 的所有推理、规划、复盘都走这个默认模型。</p>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${model?.apiKeyConfigured ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
                {model?.apiKeyConfigured ? 'API Key 已配置' : '缺少 API Key'}
              </span>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="rounded-3xl bg-stone-50 p-4">
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">Provider</span>
                <input value={modelDraft.provider} onChange={(event) => setModelDraft((draft) => ({ ...draft, provider: event.target.value }))} className="mt-2 w-full min-w-0 bg-transparent text-base font-semibold outline-none" />
              </label>
              <label className="rounded-3xl bg-stone-50 p-4">
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">Chat Model</span>
                <input value={modelDraft.model} onChange={(event) => setModelDraft((draft) => ({ ...draft, model: event.target.value }))} className="mt-2 w-full min-w-0 bg-transparent text-base font-semibold outline-none" />
              </label>
              <label className="rounded-3xl bg-stone-50 p-4">
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">Reasoning Model</span>
                <input value={modelDraft.reasoningModel} onChange={(event) => setModelDraft((draft) => ({ ...draft, reasoningModel: event.target.value }))} placeholder="可为空" className="mt-2 w-full min-w-0 bg-transparent text-base font-semibold outline-none" />
              </label>
              <label className="rounded-3xl bg-stone-50 p-4">
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">Temperature</span>
                <input value={modelDraft.temperature} onChange={(event) => setModelDraft((draft) => ({ ...draft, temperature: event.target.value }))} className="mt-2 w-full min-w-0 bg-transparent text-base font-semibold outline-none" />
              </label>
              <label className="rounded-3xl bg-stone-50 p-4 md:col-span-2">
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">API Base</span>
                <input value={modelDraft.apiBase} onChange={(event) => setModelDraft((draft) => ({ ...draft, apiBase: event.target.value }))} className="mt-2 w-full min-w-0 bg-transparent text-base font-semibold outline-none" />
                <span className="mt-2 block text-xs text-stone-500">API Key 只从服务器 `.env` 读取，页面不显示、不保存明文密钥。</span>
              </label>
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <button disabled={!model?.id || updateModel.isPending} onClick={saveModel} className="rounded-full bg-stone-950 px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45">保存模型</button>
              <button disabled={testModel.isPending} onClick={() => testModel.mutate()} className="rounded-full bg-stone-100 px-5 py-3 text-sm font-semibold text-stone-700 disabled:cursor-not-allowed disabled:opacity-45">测试连接</button>
            </div>
          </section>

          <section className="rounded-[36px] border border-stone-200 bg-white p-6 shadow-sm">
            <div className="mb-5">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-400">QQ</p>
              <h2 className="mt-2 text-2xl font-semibold">消息通道</h2>
              <p className="mt-2 text-sm leading-6 text-stone-500">QQ 是当前第一版的主动推进入口；绑定来自 worker 收到的真实会话。</p>
            </div>
            <div className="space-y-3">
              {qqBindings.length ? qqBindings.map((binding: any) => (
                <div key={binding.id} className="rounded-3xl bg-stone-50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="min-w-0 break-all font-semibold">{binding.contextType}:{binding.contextIdMasked || binding.contextId}</p>
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusClass(binding.status)}`}>{binding.status}</span>
                  </div>
                  <p className="mt-2 text-xs text-stone-500">最近更新：{formatDate(binding.updatedAt)}</p>
                </div>
              )) : (
                <div className="rounded-3xl bg-stone-50 p-4">
                  <p className="font-semibold">还没有 QQ 绑定</p>
                  <p className="mt-2 text-sm leading-6 text-stone-500">启动 `pnpm worker:qq` 后，给机器人发一条消息，系统会自动绑定当前默认用户。</p>
                </div>
              )}
            </div>
          </section>
        </div>

        <section className="rounded-[36px] border border-stone-200 bg-white p-6 shadow-sm">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-400">Reminders</p>
              <h2 className="mt-2 text-2xl font-semibold">主动推进节奏</h2>
              <p className="mt-2 text-sm leading-6 text-stone-500">早中晚和周复盘不是普通闹钟，而是 Scheduler 触发 Agent 去问一个关键问题。</p>
            </div>
            <button disabled={updateReminderRules.isPending} onClick={saveReminderRules} className="rounded-full bg-stone-950 px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45">保存提醒</button>
          </div>
          <div className="grid gap-3 lg:grid-cols-4">
            {reminderDrafts.map((rule, index) => {
              const meta = reminderMeta.find((item) => item.type === rule.reminderType)
              return (
                <div key={rule.reminderType} className="rounded-3xl bg-stone-50 p-4">
                  <label className="flex items-start justify-between gap-3">
                    <span>
                      <span className="block font-semibold">{meta?.label || rule.reminderType}</span>
                      <span className="mt-1 block text-xs leading-5 text-stone-500">{meta?.purpose}</span>
                    </span>
                    <input type="checkbox" checked={rule.enabled} onChange={(event) => updateReminder(index, { enabled: event.target.checked })} className="mt-1 h-5 w-5 accent-stone-950" />
                  </label>
                  <div className="mt-4 grid gap-3">
                    <label>
                      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-400">Schedule</span>
                      <input value={rule.schedule} onChange={(event) => updateReminder(index, { schedule: event.target.value })} className="mt-1 w-full rounded-2xl border border-stone-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-stone-900" />
                    </label>
                    <label>
                      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-400">Max / Day</span>
                      <input type="number" min={1} max={8} value={rule.maxPerDay} onChange={(event) => updateReminder(index, { maxPerDay: Math.max(1, Number(event.target.value) || 1) })} className="mt-1 w-full rounded-2xl border border-stone-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-stone-900" />
                    </label>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="mt-5 rounded-3xl bg-stone-950 p-4 text-white">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">最近调度</p>
            <div className="mt-3 grid gap-2 md:grid-cols-2 lg:grid-cols-4">
              {schedulerEvents.length ? schedulerEvents.slice(0, 4).map((event: any) => (
                <div key={event.id} className="rounded-2xl bg-white/10 p-3">
                  <p className="text-sm font-semibold">{ruleLabel(event.eventType)}</p>
                  <p className="mt-1 text-xs text-stone-300">{event.status} · {formatDate(event.createdAt)}</p>
                </div>
              )) : <p className="text-sm text-stone-300">暂无调度记录。</p>}
            </div>
          </div>
        </section>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          <section className="rounded-[36px] border border-stone-200 bg-white p-6 shadow-sm">
            <div className="mb-5">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-400">Agent Tools</p>
              <h2 className="mt-2 text-2xl font-semibold">工具权限与审计</h2>
              <p className="mt-2 text-sm leading-6 text-stone-500">Agent 能读、能生成草稿；真正写系统数据时必须确认。这里看最近发生了什么。</p>
            </div>
            <div className="mb-4 grid gap-3 md:grid-cols-4">
              {Object.entries(data?.permissionPolicy || {}).map(([key, value]) => (
                <div key={key} className="rounded-3xl bg-stone-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">{key}</p>
                  <p className="mt-2 text-sm font-semibold">{String(value)}</p>
                </div>
              ))}
            </div>
            <div className="space-y-2">
              {toolActions.length ? toolActions.map((action: any) => (
                <div key={action.id} className="grid min-w-0 gap-3 rounded-3xl bg-stone-50 p-4 md:grid-cols-[180px_minmax(0,1fr)_140px] md:items-center">
                  <div className="min-w-0">
                    <p className="font-semibold">{action.toolName}</p>
                    <p className="text-xs text-stone-500">{action.source} · {action.permission}</p>
                  </div>
                  <p className="min-w-0 truncate text-sm text-stone-600">{action.inputSummary}</p>
                  <div className="flex min-w-0 items-center justify-between gap-2 md:justify-end">
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusClass(action.status)}`}>{action.status}</span>
                    <span className="text-xs text-stone-400">{formatDate(action.createdAt)}</span>
                  </div>
                </div>
              )) : (
                <div className="rounded-3xl bg-stone-50 p-4 text-sm text-stone-500">暂无 Agent 工具动作。</div>
              )}
            </div>
          </section>

          <section className="rounded-[36px] border border-stone-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-400">Data</p>
            <h2 className="mt-2 text-2xl font-semibold">数据与隐私</h2>
            <p className="mt-2 text-sm leading-6 text-stone-500">
              导出目标、日志、Agent 对话、提醒、调度、工具审计和设置。密钥不会以明文导出。
            </p>
            <button
              disabled={exportUserData.isPending}
              onClick={() => exportUserData.mutate()}
              className="mt-5 w-full rounded-full bg-stone-950 px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45"
            >
              导出数据
            </button>
          </section>
        </div>
      </div>
    </div>
  )
}
