'use client'

import { useEffect, useState } from 'react'
import { useUpdateModel } from '@/hooks/use-models'
import { useDeleteAgentMemory, useDeleteWorkspaceData, useExportUserData, useSettingsControlCenter, useTestModelConnection, useUpdateReminderRules, useUpdateSettings } from '@/hooks/use-settings'

type ReminderDraft = {
  id?: string
  reminderType: string
  channel: string
  schedule: string
  timezone: string
  maxPerDay: number
  quietHours: string
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
  { reminderType: 'morning_planning', channel: 'qq', schedule: '08:30', timezone: 'Asia/Shanghai', maxPerDay: 1, quietHours: '23:00-07:30', enabled: true },
  { reminderType: 'midday_check', channel: 'qq', schedule: '12:30', timezone: 'Asia/Shanghai', maxPerDay: 1, quietHours: '23:00-07:30', enabled: true },
  { reminderType: 'evening_review', channel: 'qq', schedule: '21:30', timezone: 'Asia/Shanghai', maxPerDay: 1, quietHours: '23:00-07:30', enabled: true },
  { reminderType: 'weekly_review', channel: 'qq', schedule: 'SUN 21:00', timezone: 'Asia/Shanghai', maxPerDay: 1, quietHours: '23:00-07:30', enabled: true },
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

function quietHoursText(value: any, fallback = '23:00-07:30') {
  if (typeof value === 'string' && value.trim()) return value
  if (value && typeof value === 'object' && typeof value.range === 'string' && value.range.trim()) return value.range
  return fallback
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
  const deleteAgentMemory = useDeleteAgentMemory()
  const deleteWorkspaceData = useDeleteWorkspaceData()

  const data = controlCenter.data?.data
  const model = data?.model
  const runtimeStatus = data?.runtimeStatus || {}
  const qqBindings = data?.qqBindings || []
  const toolActions = data?.toolActions || []
  const schedulerEvents = data?.schedulerEvents || []
  const deploymentConfig = data?.deploymentConfig
  const deploymentRequired = deploymentConfig?.minimumRequired || []
  const deploymentMissing = deploymentConfig?.missingKeys || []

  const [modelDraft, setModelDraft] = useState({
    provider: 'DeepSeek',
    model: 'deepseek-v4-flash',
    reasoningModel: '',
    apiBase: 'https://api.deepseek.com',
    apiKey: '',
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
      apiKey: '',
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
        quietHours: quietHoursText(rule?.quietHours, fallback.quietHours),
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
      apiKey: modelDraft.apiKey.trim() || undefined,
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
        quietHours: rule.quietHours,
        enabled: rule.enabled,
      })),
    })
  }

  function saveBehaviorSettings() {
    updateSettings.mutate({
      ...behaviorDraft,
      general: {
        locale: 'zh-CN',
        timezone: 'Asia/Shanghai',
        week_start: 'monday',
      },
      goals: {
        ...behaviorDraft.goals,
        max_active_goals: 1,
      },
      logs: {
        ...behaviorDraft.logs,
        vault_root: 'logs/',
        naming_pattern: 'YYYY/Q#/YYYY-MM/W##/YYYY-MM-DD.md',
        preserve_user_edits: true,
      },
      today: {
        ...behaviorDraft.today,
        generate_time: '08:30',
      },
      dataPrivacy: {
        ...behaviorDraft.dataPrivacy,
        redact_secrets: true,
        local_first_mode: false,
      },
    })
  }

  function handleDeleteAgentMemory() {
    if (!window.confirm('确认清除 Agent 对话记忆？这会删除对话历史和消息，但保留工具审计记录。')) return
    deleteAgentMemory.mutate()
  }

  function handleDeleteWorkspaceData() {
    const confirmation = window.prompt('这会清除目标、日志、Agent 对话、提醒、绑定、模型配置和设置，但保留登录账号。输入 DELETE 确认。')
    if (confirmation !== 'DELETE') return
    deleteWorkspaceData.mutate()
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
                设置页是系统控制参数，不是普通开关集合。这里决定 Agent 用什么模型思考、什么时候主动找你、能读取什么上下文、反馈如何写入日志，以及数据如何导出或清除。
              </p>
            </div>
            <div className="grid min-w-0 grid-cols-2 gap-2 rounded-3xl bg-stone-950 p-3 text-white sm:grid-cols-4">
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
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-[0.18em] text-stone-400">Deploy</p>
                <p className="mt-1 text-sm font-semibold">{deploymentMissing.length ? `缺 ${deploymentMissing.length} 项` : '可部署'}</p>
              </div>
            </div>
          </div>
        </header>

        <section className="rounded-[32px] border border-stone-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-400">Control Parameters</p>
          <div className="mt-4 grid gap-3 md:grid-cols-5">
            {[
              { label: '模型', value: '决定 Agent 怎么理解目标和诊断偏差' },
              { label: '提醒', value: '决定控制信号何时触达用户' },
              { label: '权限', value: '决定 Agent 能观察哪些状态' },
              { label: '日志', value: '决定反馈如何沉淀为证据' },
              { label: '数据', value: '决定记忆、导出和隐私边界' },
            ].map((item, index) => (
              <div key={item.label} className="relative rounded-3xl bg-stone-50 p-4">
                {index > 0 && <span className="absolute -left-2 top-1/2 hidden h-px w-4 bg-stone-300 md:block" />}
                <p className="text-sm font-semibold text-stone-950">{item.label}</p>
                <p className="mt-2 text-xs leading-5 text-stone-500">{item.value}</p>
              </div>
            ))}
          </div>
        </section>

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
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-400">Deployment</p>
              <h2 className="mt-2 text-2xl font-semibold">服务器部署</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-500">
                目标是少填参数：服务器只放密钥和访问地址，模型细节、提醒节奏、权限和日志策略都在这个页面配置。
              </p>
            </div>
            <span className={`rounded-full px-4 py-2 text-sm font-semibold ${deploymentMissing.length ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
              {deploymentMissing.length ? `缺 ${deploymentMissing.length} 项` : '必填项已齐'}
            </span>
          </div>

          <div className="mt-5 grid gap-3 lg:grid-cols-5">
            <div className="lg:col-span-5">
              <p className="text-sm font-semibold text-stone-950">服务器必填项</p>
            </div>
            {deploymentRequired.map((item: any) => (
              <div key={item.key} className="rounded-3xl bg-stone-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-400">{item.key}</p>
                    <p className="mt-2 text-sm font-semibold text-stone-950">{item.label}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${item.configured ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
                    {item.configured ? 'OK' : '缺失'}
                  </span>
                </div>
                <p className="mt-3 break-words text-xs leading-5 text-stone-500">{item.secret ? '服务器 .env 保存，不在页面显示明文。' : (item.value || item.reason)}</p>
              </div>
            ))}
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="rounded-3xl border border-stone-100 p-4">
              <p className="text-sm font-semibold text-stone-950">页面可配置</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {(deploymentConfig?.uiManaged || []).map((item: string) => (
                  <span key={item} className="rounded-full bg-stone-100 px-3 py-1.5 text-xs font-semibold text-stone-600">{item}</span>
                ))}
              </div>
            </div>
            <div className="rounded-3xl bg-stone-950 p-4 text-white">
              <p className="text-sm font-semibold">默认项不用管</p>
              <p className="mt-2 text-xs leading-5 text-stone-300">
                端口、Host、DeepSeek Base、默认模型、QQ API Base、Gateway intents、Scheduler tick 和时区已有默认值；模型 API Key 在本页按用户配置。
              </p>
            </div>
          </div>
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
              <p className="mt-1 text-xs leading-5 text-stone-500">v0.1 固定中文、中国时区和周一开始，避免出现未完整生效的区域设置。</p>
              <div className="mt-4 grid gap-3">
                <div className="rounded-2xl bg-stone-50 px-3 py-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-400">Locale</span>
                  <p className="mt-1 text-sm font-semibold text-stone-900">zh-CN</p>
                </div>
                <div className="rounded-2xl bg-stone-50 px-3 py-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-400">Timezone</span>
                  <p className="mt-1 text-sm font-semibold text-stone-900">Asia/Shanghai</p>
                </div>
                <div className="rounded-2xl bg-stone-50 px-3 py-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-400">Week Start</span>
                  <p className="mt-1 text-sm font-semibold text-stone-900">Monday</p>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-stone-100 p-4">
              <h3 className="font-semibold text-stone-950">Goals / Today</h3>
              <p className="mt-1 text-xs leading-5 text-stone-500">控制目标系统的焦点、复盘频率和 Today 的当前控制输出。</p>
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
                  <input value={reminderDrafts.find((rule) => rule.reminderType === 'morning_planning')?.schedule || behaviorDraft.today.generate_time} disabled className="mt-1 w-full rounded-2xl border border-stone-200 bg-stone-100 px-3 py-2 text-sm font-semibold text-stone-500 outline-none" />
                  <span className="mt-2 block text-xs leading-5 text-stone-500">真实触发时间由下方 Reminders 的“早晨规划”控制，这里只展示当前生效时间。</span>
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
              <p className="mt-1 text-xs leading-5 text-stone-500">控制反馈证据如何写入 Markdown，并保证系统能追溯观察、偏差和调整。</p>
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
                <div className="rounded-2xl bg-stone-50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-stone-900">保护手写内容</span>
                      <span className="mt-1 block text-xs leading-5 text-stone-500">安全边界，始终开启；自动写入只能追加系统内容，不能覆盖用户自由记录。</span>
                    </span>
                    <input type="checkbox" checked readOnly disabled className="mt-1 h-5 w-5 shrink-0 accent-stone-950 disabled:opacity-70" />
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-stone-100 p-4 xl:col-span-2">
              <h3 className="font-semibold text-stone-950">Agent</h3>
              <p className="mt-1 text-xs leading-5 text-stone-500">控制 Agent 的观察范围和执行边界：能读什么、能记什么、改动前是否必须确认。</p>
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
                <div className="rounded-2xl bg-stone-50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-stone-900">导出时隐藏密钥</span>
                      <span className="mt-1 block text-xs leading-5 text-stone-500">安全边界，始终开启；导出模型配置时不会包含明文 API Key。</span>
                    </span>
                    <input type="checkbox" checked readOnly disabled className="mt-1 h-5 w-5 shrink-0 accent-stone-950 disabled:opacity-70" />
                  </div>
                </div>
                <ToggleRow label="导出 Markdown" description="导出目标、日志和 Agent 沉淀的 Markdown 文档。" checked={behaviorDraft.dataPrivacy.export_markdown} onChange={(checked) => setBehaviorDraft((draft) => ({ ...draft, dataPrivacy: { ...draft.dataPrivacy, export_markdown: checked } }))} />
                <div className="flex items-start justify-between gap-3 rounded-3xl border border-stone-200 bg-stone-50 p-4">
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-stone-900">本地优先模式</span>
                    <span className="mt-1 block text-xs leading-5 text-stone-500">后续自部署/本地优先版本再启用；当前 Web v0.1 不保存不会改变运行方式的假开关。</span>
                  </span>
                  <span className="shrink-0 rounded-full bg-stone-200 px-3 py-1 text-xs font-semibold text-stone-600">后续版本</span>
                </div>
                <div className="flex items-start justify-between gap-3 rounded-3xl border border-stone-200 bg-stone-50 p-4">
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-stone-900">自动备份位置</span>
                    <span className="mt-1 block text-xs leading-5 text-stone-500">当前 Web v0.1 用导出数据完成备份；文件系统备份位置属于后续自部署能力，不保存假路径。</span>
                  </span>
                  <span className="shrink-0 rounded-full bg-stone-200 px-3 py-1 text-xs font-semibold text-stone-600">使用导出</span>
                </div>
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
                <p className="mt-2 text-sm leading-6 text-stone-500">模型是控制器的大脑；每个用户使用自己的模型密钥，目标澄清、条件倒推、诊断和复盘都走当前账户的默认模型。</p>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${model?.apiKeyConfigured ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
                {model?.apiKeyConfigured ? '用户 API Key 已配置' : '缺少用户 API Key'}
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
              </label>
              <label className="rounded-3xl bg-stone-50 p-4 md:col-span-2">
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">API Key</span>
                <input type="password" value={modelDraft.apiKey} onChange={(event) => setModelDraft((draft) => ({ ...draft, apiKey: event.target.value }))} placeholder={model?.apiKeyConfigured ? '已配置，留空则保留原密钥' : '填入你自己的模型 API Key'} className="mt-2 w-full min-w-0 bg-transparent text-base font-semibold outline-none" />
                <span className="mt-2 block text-xs text-stone-500">密钥按当前用户保存，服务端加密存储；页面、导出和 Agent 工具读取都只返回脱敏状态。</span>
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
              <p className="mt-2 text-sm leading-6 text-stone-500">提醒是控制信号，不是普通闹钟。早中晚和周复盘会触发 Agent 在合适时间问一个关键问题。</p>
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
                    <label>
                      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-400">Quiet Hours</span>
                      <input value={rule.quietHours} onChange={(event) => updateReminder(index, { quietHours: event.target.value })} className="mt-1 w-full rounded-2xl border border-stone-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-stone-900" />
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
            <div className="mt-5 grid gap-3">
              <button
                disabled={exportUserData.isPending}
                onClick={() => exportUserData.mutate()}
                className="w-full rounded-full bg-stone-950 px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45"
              >
                导出数据
              </button>
              <button
                disabled={deleteAgentMemory.isPending}
                onClick={handleDeleteAgentMemory}
                className="w-full rounded-full bg-stone-100 px-5 py-3 text-sm font-semibold text-stone-700 disabled:cursor-not-allowed disabled:opacity-45"
              >
                清除 Agent 记忆
              </button>
              <button
                disabled={deleteWorkspaceData.isPending}
                onClick={handleDeleteWorkspaceData}
                className="w-full rounded-full bg-red-50 px-5 py-3 text-sm font-semibold text-red-700 disabled:cursor-not-allowed disabled:opacity-45"
              >
                清除工作区数据
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
