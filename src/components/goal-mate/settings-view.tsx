'use client'

import { useEffect, useState } from 'react'
import { useUpdateModel } from '@/hooks/use-models'
import { useExportUserData, useSettingsControlCenter, useTestModelConnection, useUpdateReminderRules, useUpdateSettings } from '@/hooks/use-settings'

type ReminderDraft = {
  id?: string
  reminderType: string
  channel: string
  schedule: string
  timezone: string
  maxPerDay: number
  enabled: boolean
}

type BehaviorDraft = {
  general: {
    locale: string
    timezone: string
    week_start: string
  }
  goals: {
    max_active_goals: number
    review_cadence: string
  }
  logs: {
    vault_root: string
    naming_pattern: string
    auto_write_checkin: boolean
    auto_write_review: boolean
    preserve_user_edits: boolean
  }
  today: {
    generate_time: string
    low_energy_mode: boolean
    heatmap_scope: string
  }
  agent: {
    can_read_goals: boolean
    can_read_logs: boolean
    memory_enabled: boolean
    require_confirm_goal_changes: boolean
    require_confirm_setting_changes: boolean
    require_confirm_external_actions: boolean
  }
  dataPrivacy: {
    redact_secrets: boolean
    export_markdown: boolean
    local_first_mode: boolean
  }
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

const defaultBehaviorDraft: BehaviorDraft = {
  general: { locale: 'zh-CN', timezone: 'Asia/Shanghai', week_start: 'monday' },
  goals: { max_active_goals: 1, review_cadence: 'weekly' },
  logs: {
    vault_root: 'logs/',
    naming_pattern: 'YYYY/Q#/YYYY-MM/W##/YYYY-MM-DD.md',
    auto_write_checkin: true,
    auto_write_review: true,
    preserve_user_edits: true,
  },
  today: { generate_time: '08:30', low_energy_mode: true, heatmap_scope: 'year' },
  agent: {
    can_read_goals: true,
    can_read_logs: true,
    memory_enabled: true,
    require_confirm_goal_changes: true,
    require_confirm_setting_changes: true,
    require_confirm_external_actions: true,
  },
  dataPrivacy: { redact_secrets: true, export_markdown: true, local_first_mode: false },
}

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

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex items-start justify-between gap-3 rounded-2xl bg-stone-50 p-3">
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-stone-900">{label}</span>
        <span className="mt-1 block text-xs leading-5 text-stone-500">{description}</span>
      </span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-stone-950" />
    </label>
  )
}

export function SettingsView() {
  const controlCenter = useSettingsControlCenter()
  const updateSettings = useUpdateSettings()
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
  const [behaviorDraft, setBehaviorDraft] = useState<BehaviorDraft>(defaultBehaviorDraft)

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

  useEffect(() => {
    const settings = data?.settings
    if (!settings) return
    setBehaviorDraft({
      general: { ...defaultBehaviorDraft.general, ...(settings.general || {}) },
      goals: { ...defaultBehaviorDraft.goals, ...(settings.goals || {}) },
      logs: { ...defaultBehaviorDraft.logs, ...(settings.logs || {}) },
      today: { ...defaultBehaviorDraft.today, ...(settings.today || {}) },
      agent: { ...defaultBehaviorDraft.agent, ...(settings.agent || {}) },
      dataPrivacy: { ...defaultBehaviorDraft.dataPrivacy, ...(settings.dataPrivacy || {}) },
    })
  }, [data?.settings])

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

  function saveBehaviorSettings() {
    updateSettings.mutate({
      ...behaviorDraft,
      goals: {
        ...behaviorDraft.goals,
        max_active_goals: 1,
      },
      logs: {
        ...behaviorDraft.logs,
        vault_root: 'logs/',
        naming_pattern: 'YYYY/Q#/YYYY-MM/W##/YYYY-MM-DD.md',
      },
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

        <section className="rounded-[36px] border border-stone-200 bg-white p-6 shadow-sm">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-400">Behavior</p>
              <h2 className="mt-2 text-2xl font-semibold">系统行为</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-500">
                这些设置决定系统怎么拆目标、写日志、生成 Today、读取上下文和导出数据。不是装饰项，保存后会写入用户设置。
              </p>
            </div>
            <button disabled={updateSettings.isPending} onClick={saveBehaviorSettings} className="rounded-full bg-stone-950 px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45">
              保存行为设置
            </button>
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <div className="rounded-3xl border border-stone-100 p-4">
              <h3 className="font-semibold text-stone-950">General</h3>
              <p className="mt-1 text-xs leading-5 text-stone-500">影响日期、周起点和默认显示语言。</p>
              <div className="mt-4 grid gap-3">
                <label>
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-400">Locale</span>
                  <input value={behaviorDraft.general.locale} onChange={(event) => setBehaviorDraft((draft) => ({ ...draft, general: { ...draft.general, locale: event.target.value } }))} className="mt-1 w-full rounded-2xl border border-stone-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-stone-900" />
                </label>
                <label>
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-400">Timezone</span>
                  <input value={behaviorDraft.general.timezone} onChange={(event) => setBehaviorDraft((draft) => ({ ...draft, general: { ...draft.general, timezone: event.target.value } }))} className="mt-1 w-full rounded-2xl border border-stone-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-stone-900" />
                </label>
                <label>
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-400">Week Start</span>
                  <select value={behaviorDraft.general.week_start} onChange={(event) => setBehaviorDraft((draft) => ({ ...draft, general: { ...draft.general, week_start: event.target.value } }))} className="mt-1 w-full rounded-2xl border border-stone-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-stone-900">
                    <option value="monday">Monday</option>
                    <option value="sunday">Sunday</option>
                  </select>
                </label>
              </div>
            </div>

            <div className="rounded-3xl border border-stone-100 p-4">
              <h3 className="font-semibold text-stone-950">Goals / Today</h3>
              <p className="mt-1 text-xs leading-5 text-stone-500">决定目标上限、复盘节奏和今日行动生成方式。</p>
              <div className="mt-4 grid gap-3">
                <label>
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-400">Active Goals</span>
                  <input type="number" min={1} max={1} value={1} disabled className="mt-1 w-full rounded-2xl border border-stone-200 bg-stone-100 px-3 py-2 text-sm font-semibold text-stone-500 outline-none" />
                  <span className="mt-2 block text-xs leading-5 text-stone-500">v0.1 固定单主目标，避免多个当前焦点互相抢 Today。</span>
                </label>
                <label>
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-400">Review Cadence</span>
                  <select value={behaviorDraft.goals.review_cadence} onChange={(event) => setBehaviorDraft((draft) => ({ ...draft, goals: { ...draft.goals, review_cadence: event.target.value } }))} className="mt-1 w-full rounded-2xl border border-stone-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-stone-900">
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </label>
                <label>
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-400">Today Generate Time</span>
                  <input value={behaviorDraft.today.generate_time} onChange={(event) => setBehaviorDraft((draft) => ({ ...draft, today: { ...draft.today, generate_time: event.target.value } }))} className="mt-1 w-full rounded-2xl border border-stone-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-stone-900" />
                </label>
                <label>
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-400">Heatmap Scope</span>
                  <select value={behaviorDraft.today.heatmap_scope} onChange={(event) => setBehaviorDraft((draft) => ({ ...draft, today: { ...draft.today, heatmap_scope: event.target.value } }))} className="mt-1 w-full rounded-2xl border border-stone-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-stone-900">
                    <option value="year">Year</option>
                    <option value="quarter">Quarter</option>
                    <option value="month">Month</option>
                    <option value="week">Week</option>
                  </select>
                </label>
                <ToggleRow label="低精力模式" description="开启后 Today 优先保留最小启动和替代动作。" checked={behaviorDraft.today.low_energy_mode} onChange={(checked) => setBehaviorDraft((draft) => ({ ...draft, today: { ...draft.today, low_energy_mode: checked } }))} />
              </div>
            </div>

            <div className="rounded-3xl border border-stone-100 p-4">
              <h3 className="font-semibold text-stone-950">Logs</h3>
              <p className="mt-1 text-xs leading-5 text-stone-500">决定 Markdown 根目录、命名规则和自动写入边界。</p>
              <div className="mt-4 grid gap-3">
                <label>
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-400">Vault Root</span>
                  <input value="logs/" disabled className="mt-1 w-full rounded-2xl border border-stone-200 bg-stone-100 px-3 py-2 text-sm font-semibold text-stone-500 outline-none" />
                  <span className="mt-2 block text-xs leading-5 text-stone-500">v0.1 固定写入内置 Markdown vault，保证 Agent、Today、Review 和 Logs 文件树一致。</span>
                </label>
                <label>
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-400">Naming Pattern</span>
                  <input value="YYYY/Q#/YYYY-MM/W##/YYYY-MM-DD.md" disabled className="mt-1 w-full rounded-2xl border border-stone-200 bg-stone-100 px-3 py-2 text-sm font-semibold text-stone-500 outline-none" />
                  <span className="mt-2 block text-xs leading-5 text-stone-500">当前所有日志写入入口共用这套层级，后续支持外部 vault 时再开放。</span>
                </label>
                <ToggleRow label="自动写入 Check-in" description="完成/部分完成/没做会追加到当日日志。" checked={behaviorDraft.logs.auto_write_checkin} onChange={(checked) => setBehaviorDraft((draft) => ({ ...draft, logs: { ...draft.logs, auto_write_checkin: checked } }))} />
                <ToggleRow label="自动写入复盘" description="日/周/月复盘会沉淀到对应周期 Markdown。" checked={behaviorDraft.logs.auto_write_review} onChange={(checked) => setBehaviorDraft((draft) => ({ ...draft, logs: { ...draft.logs, auto_write_review: checked } }))} />
                <ToggleRow label="保护手写内容" description="自动写入只追加或替换系统区块，不能覆盖用户自由记录。" checked={behaviorDraft.logs.preserve_user_edits} onChange={(checked) => setBehaviorDraft((draft) => ({ ...draft, logs: { ...draft.logs, preserve_user_edits: checked } }))} />
              </div>
            </div>

            <div className="rounded-3xl border border-stone-100 p-4 xl:col-span-2">
              <h3 className="font-semibold text-stone-950">Agent</h3>
              <p className="mt-1 text-xs leading-5 text-stone-500">决定 Agent 能读取什么，以及哪些修改必须确认。</p>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <ToggleRow label="读取 Goals" description="关闭后 Agent 不应基于目标结构回答。" checked={behaviorDraft.agent.can_read_goals} onChange={(checked) => setBehaviorDraft((draft) => ({ ...draft, agent: { ...draft.agent, can_read_goals: checked } }))} />
                <ToggleRow label="读取 Logs" description="关闭后 Agent 不应引用 Markdown 日志内容。" checked={behaviorDraft.agent.can_read_logs} onChange={(checked) => setBehaviorDraft((draft) => ({ ...draft, agent: { ...draft.agent, can_read_logs: checked } }))} />
                <ToggleRow label="保留对话记忆" description="用于同一主题的持续规划、诊断和复盘。" checked={behaviorDraft.agent.memory_enabled} onChange={(checked) => setBehaviorDraft((draft) => ({ ...draft, agent: { ...draft.agent, memory_enabled: checked } }))} />
                <ToggleRow label="目标修改需确认" description="Agent 切换主目标或激活目标前必须等待确认。" checked={behaviorDraft.agent.require_confirm_goal_changes} onChange={(checked) => setBehaviorDraft((draft) => ({ ...draft, agent: { ...draft.agent, require_confirm_goal_changes: checked } }))} />
                <ToggleRow label="设置修改需确认" description="Agent 修改模型、提醒或系统行为前必须等待确认。" checked={behaviorDraft.agent.require_confirm_setting_changes} onChange={(checked) => setBehaviorDraft((draft) => ({ ...draft, agent: { ...draft.agent, require_confirm_setting_changes: checked } }))} />
                <ToggleRow label="外部动作强确认" description="向 QQ 等外部通道发送或调整计划时必须确认。" checked={behaviorDraft.agent.require_confirm_external_actions} onChange={(checked) => setBehaviorDraft((draft) => ({ ...draft, agent: { ...draft.agent, require_confirm_external_actions: checked } }))} />
              </div>
            </div>

            <div className="rounded-3xl border border-stone-100 p-4">
              <h3 className="font-semibold text-stone-950">Data & Privacy</h3>
              <p className="mt-1 text-xs leading-5 text-stone-500">决定导出和隐私边界。</p>
              <div className="mt-4 grid gap-3">
                <ToggleRow label="导出时隐藏密钥" description="导出模型配置时不包含明文 API Key。" checked={behaviorDraft.dataPrivacy.redact_secrets} onChange={(checked) => setBehaviorDraft((draft) => ({ ...draft, dataPrivacy: { ...draft.dataPrivacy, redact_secrets: checked } }))} />
                <ToggleRow label="导出 Markdown" description="导出目标、日志和 Agent 沉淀的 Markdown 文档。" checked={behaviorDraft.dataPrivacy.export_markdown} onChange={(checked) => setBehaviorDraft((draft) => ({ ...draft, dataPrivacy: { ...draft.dataPrivacy, export_markdown: checked } }))} />
                <ToggleRow label="本地优先模式" description="预留给后续自部署/本地优先数据策略；当前只保存偏好。" checked={behaviorDraft.dataPrivacy.local_first_mode} onChange={(checked) => setBehaviorDraft((draft) => ({ ...draft, dataPrivacy: { ...draft.dataPrivacy, local_first_mode: checked } }))} />
              </div>
            </div>
          </div>
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
