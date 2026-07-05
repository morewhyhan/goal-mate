'use client'

import { useEffect, useState } from 'react'
import { useUpdateModel } from '@/hooks/use-models'
import { useDeleteAgentMemory, useDeleteWorkspaceData, useExportUserData, useGenerateQqBindingCode, useSettingsControlCenter, useTestModelConnection, useTestQqBotConnection, useUpdateQqBotConfig, useUpdateReminderRules, useUpdateSettings } from '@/hooks/use-settings'

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

type QqBotDraft = {
  appId: string
  token: string
  apiBase: string
  intents: string
  allowedContextIds: string
  enabled: boolean
}

type BehaviorDraft = {
  general: { locale: string; timezone: string; week_start: string }
  goals: { max_active_goals: number; review_cadence: string }
  logs: { vault_root: string; naming_pattern: string; auto_write_checkin: boolean; auto_write_review: boolean; preserve_user_edits: boolean }
  today: { generate_time: string; low_energy_mode: boolean; heatmap_scope: string }
  agent: { can_read_goals: boolean; can_read_logs: boolean; memory_enabled: boolean; require_confirm_goal_changes: boolean; require_confirm_setting_changes: boolean; require_confirm_external_actions: boolean }
  dataPrivacy: { redact_secrets: boolean; export_markdown: boolean; local_first_mode: boolean }
}

const reminderMeta = [
  { type: 'morning_planning', label: '早晨规划', purpose: '问清今天唯一下一步。' },
  { type: 'midday_check', label: '中午检查', purpose: '发现偏离时缩小动作。' },
  { type: 'evening_review', label: '晚上复盘', purpose: '记录完成情况和原因。' },
  { type: 'weekly_review', label: '周复盘', purpose: '调整下周推进策略。' },
]

const defaultReminderDrafts: ReminderDraft[] = [
  { reminderType: 'morning_planning', channel: 'qq', schedule: '08:30', timezone: 'Asia/Shanghai', maxPerDay: 1, quietHours: '23:00-07:30', enabled: true },
  { reminderType: 'midday_check', channel: 'qq', schedule: '12:30', timezone: 'Asia/Shanghai', maxPerDay: 1, quietHours: '23:00-07:30', enabled: true },
  { reminderType: 'evening_review', channel: 'qq', schedule: '21:30', timezone: 'Asia/Shanghai', maxPerDay: 1, quietHours: '23:00-07:30', enabled: true },
  { reminderType: 'weekly_review', channel: 'qq', schedule: 'SUN 21:00', timezone: 'Asia/Shanghai', maxPerDay: 1, quietHours: '23:00-07:30', enabled: true },
]

const defaultQqBotDraft: QqBotDraft = {
  appId: '',
  token: '',
  apiBase: 'https://api.sgroup.qq.com',
  intents: '33554432',
  allowedContextIds: '',
  enabled: true,
}

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
  if (normalized.includes('enabled') || normalized.includes('sent') || normalized.includes('executed') || normalized.includes('drafted') || normalized.includes('ok') || normalized.includes('configured') || normalized.includes('bound') || normalized.includes('responded')) return 'bg-emerald-100 text-emerald-800'
  if (normalized.includes('pending') || normalized.includes('approved')) return 'bg-amber-100 text-amber-800'
  if (normalized.includes('failed') || normalized.includes('error') || normalized.includes('missing')) return 'bg-red-100 text-red-800'
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

function ToggleRow({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (checked: boolean) => void }) {
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

function StatusPill({ ok, children }: { ok: boolean; children: any }) {
  return <span className={`rounded-full px-3 py-1 text-xs font-semibold ${ok ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>{children}</span>
}

function RuntimeStatusPill({ status }: { status: any }) {
  const ok = Boolean(status?.online || ['ok', 'connected', 'heartbeat', 'running', 'started'].includes(String(status?.status || '').toLowerCase()))
  return <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${ok ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{ok ? '在线' : '待确认'}</span>
}

export function SettingsView() {
  const controlCenter = useSettingsControlCenter()
  const updateSettings = useUpdateSettings()
  const updateModel = useUpdateModel()
  const updateReminderRules = useUpdateReminderRules()
  const updateQqBotConfig = useUpdateQqBotConfig()
  const generateQqBindingCode = useGenerateQqBindingCode()
  const testModel = useTestModelConnection()
  const testQqBot = useTestQqBotConnection()
  const exportUserData = useExportUserData()
  const deleteAgentMemory = useDeleteAgentMemory()
  const deleteWorkspaceData = useDeleteWorkspaceData()

  const data = controlCenter.data?.data
  const model = data?.model
  const qqBotConfig = data?.qqBotConfig
  const runtimeStatus = data?.runtimeStatus || {}
  const qqBindings = data?.qqBindings || []
  const toolActions = data?.toolActions || []
  const schedulerEvents = data?.schedulerEvents || []
  const deploymentConfig = data?.deploymentConfig
  const deploymentMissing = deploymentConfig?.missingKeys || []
  const deploymentRequired = deploymentConfig?.minimumRequired || []
  const runtimeWorkers = [
    { key: 'web', label: 'Web', status: runtimeStatus.web },
    { key: 'qq-worker', label: 'QQ Worker', status: runtimeStatus.qqWorker },
    { key: 'scheduler-worker', label: 'Scheduler', status: runtimeStatus.schedulerWorker },
  ]

  const [modelDraft, setModelDraft] = useState({ provider: 'B.AI', model: 'gpt-5-nano', reasoningModel: '', apiBase: 'https://api.b.ai', apiKey: '', temperature: '0.3' })
  const [qqBotDraft, setQqBotDraft] = useState<QqBotDraft>(defaultQqBotDraft)
  const [reminderDrafts, setReminderDrafts] = useState<ReminderDraft[]>(defaultReminderDrafts)
  const [behaviorDraft, setBehaviorDraft] = useState<BehaviorDraft>(defaultBehaviorDraft)

  useEffect(() => {
    if (!model) return
    setModelDraft({
      provider: model.provider || 'B.AI',
      model: model.model || 'gpt-5-nano',
      reasoningModel: model.reasoningModel || '',
      apiBase: model.apiBase || 'https://api.b.ai',
      apiKey: '',
      temperature: String(model.temperature ?? 0.3),
    })
  }, [model?.id, model?.provider, model?.model, model?.reasoningModel, model?.apiBase, model?.temperature])

  useEffect(() => {
    if (!qqBotConfig) return
    setQqBotDraft({
      appId: qqBotConfig.appId || '',
      token: '',
      apiBase: qqBotConfig.apiBase || 'https://api.sgroup.qq.com',
      intents: String(qqBotConfig.intents || '33554432'),
      allowedContextIds: Array.isArray(qqBotConfig.allowedContextIds) ? qqBotConfig.allowedContextIds.join(', ') : '',
      enabled: qqBotConfig.enabled !== false,
    })
  }, [qqBotConfig])

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
    updateReminderRules.mutate({ rules: reminderDrafts.map((rule) => ({ id: rule.id, reminderType: rule.reminderType, channel: rule.channel, schedule: rule.schedule, timezone: rule.timezone, maxPerDay: Number(rule.maxPerDay) || 1, quietHours: rule.quietHours, enabled: rule.enabled })) })
  }

  function saveQqBot() {
    const intents = Number(qqBotDraft.intents)
    updateQqBotConfig.mutate({
      appId: qqBotDraft.appId.trim(),
      token: qqBotDraft.token.trim() || undefined,
      apiBase: qqBotDraft.apiBase.trim() || 'https://api.sgroup.qq.com',
      intents: Number.isFinite(intents) ? intents : 33554432,
      allowedContextIds: qqBotDraft.allowedContextIds.trim(),
      enabled: qqBotDraft.enabled,
    })
  }

  async function copyQqBindingCommand(command: string) {
    if (!command) return
    try {
      await navigator.clipboard.writeText(command)
    } catch {
      window.prompt('复制这条绑定命令，然后发给 QQ 机器人：', command)
    }
  }

  function saveBehaviorSettings() {
    updateSettings.mutate({
      ...behaviorDraft,
      general: { locale: 'zh-CN', timezone: 'Asia/Shanghai', week_start: 'monday' },
      goals: { ...behaviorDraft.goals, max_active_goals: 1 },
      logs: { ...behaviorDraft.logs, vault_root: 'logs/', naming_pattern: 'YYYY/Q#/YYYY-MM/W##/YYYY-MM-DD.md', preserve_user_edits: true },
      today: { ...behaviorDraft.today, generate_time: '08:30' },
      dataPrivacy: { ...behaviorDraft.dataPrivacy, redact_secrets: true, local_first_mode: false },
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

  const modelOk = Boolean(model?.apiKeyConfigured)
  const qqOk = Boolean(qqBotConfig?.configured)
  const qqBound = qqBindings.some((binding: any) => binding.status === 'ENABLED')
  const qqBinding = qqBotConfig?.binding || {}
  const qqConnectionStatus = qqOk ? '已配置' : '未配置'
  const qqBindingStatus = qqBound ? '已绑定' : '待绑定'
  const activeReminderCount = reminderDrafts.filter((rule) => rule.enabled).length
  const reminderDeliveryReady = activeReminderCount > 0 && qqOk && qqBound
  const reminderStatus = activeReminderCount === 0
    ? '未开启'
    : !qqOk
      ? '待配置 QQ'
      : !qqBound
        ? '待绑定 QQ'
        : `${activeReminderCount}/4 可发送`
  const systemReady = modelOk && !deploymentMissing.length
  const modelTestResult = testModel.data?.data
  const modelTestMessage = testModel.isPending
    ? '正在连接 B.AI。'
    : modelTestResult?.message || ''

  return (
    <div className="min-h-[calc(100vh-4rem)] overflow-x-hidden bg-[#f4f1ea] p-4 text-stone-950 md:p-6">
      <div className="mx-auto max-w-[1180px] space-y-4">
        <header className="rounded-[28px] border border-stone-200 bg-[#fbfcf8] p-5 shadow-sm md:p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-400">Settings</p>
          <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-stone-950 md:text-4xl">系统控制台</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-stone-500">这里不是普通开关页。每一项配置都对应一项能力：思考、主动联系、追问节奏、上下文权限和数据安全。</p>
            </div>
            <div className="grid min-w-0 grid-cols-2 gap-2 rounded-[22px] border border-stone-200 bg-white p-3 sm:grid-cols-4">
              {[
                ['模型', modelOk ? '可思考' : '未配置', modelOk],
                ['QQ', `${qqConnectionStatus} · ${qqBindingStatus}`, qqOk && qqBound],
                ['提醒', reminderStatus, reminderDeliveryReady],
                ['部署', systemReady ? '关键项 OK' : `缺 ${deploymentMissing.length} 项`, systemReady],
              ].map(([label, value, ok]) => (
                <div key={String(label)} className="min-w-0 rounded-2xl bg-[#f7f4ec] p-3">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-stone-400">{label}</p>
                  <p className={`mt-1 truncate text-sm font-semibold ${ok ? 'text-emerald-800' : 'text-red-700'}`}>{value}</p>
                </div>
              ))}
            </div>
          </div>
        </header>

        <section className="grid gap-3 md:grid-cols-3">
          {[
            { title: '1. 配置模型', state: modelOk ? '已完成' : '必须先做', body: modelOk ? `当前模型：${model?.model || 'B.AI'}` : '没有模型密钥时，Agent 不能拆目标、诊断原因或生成下一步。', href: '#settings-model', ok: modelOk },
            { title: '2. 说明目标', state: '去 Agent', body: '模型可用后，去 Agent 说清楚结果、截止时间和当前情况。', href: '/dashboard/agent', ok: true },
            { title: '3. 接入主动提醒', state: qqOk && qqBound ? '已接入' : qqOk ? '待绑定' : '先配置', body: qqOk && qqBound ? 'QQ 可以用于早中晚追问和复盘。' : qqOk ? '生成绑定码，在 QQ 里发送后才能主动联系你。' : '先保存 App ID 和 Token；绑定状态会保持待绑定。', href: '#settings-qq', ok: qqOk && qqBound },
          ].map((item) => (
            <a key={item.title} href={item.href} className="rounded-[24px] border border-stone-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-lg font-semibold text-stone-950">{item.title}</h2>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${item.ok ? 'bg-emerald-100 text-emerald-800' : 'bg-stone-950 text-white'}`}>{item.state}</span>
              </div>
              <p className="mt-2 text-sm leading-6 text-stone-500">{item.body}</p>
            </a>
          ))}
        </section>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <section id="settings-model" className="scroll-mt-24 rounded-[28px] border border-stone-200 bg-white p-5 shadow-sm">
            <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-400">Required</p>
                <h2 className="mt-2 text-2xl font-semibold">模型配置</h2>
                <p className="mt-2 text-sm leading-6 text-stone-500">影响能力：Agent 是否能对话、拆目标、生成 Today、分析反馈。</p>
              </div>
              <StatusPill ok={modelOk}>{modelOk ? '已配置' : '缺 API Key'}</StatusPill>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="rounded-[20px] bg-[#f7f4ec] p-4"><span className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">Provider</span><input value={modelDraft.provider} onChange={(event) => setModelDraft((draft) => ({ ...draft, provider: event.target.value }))} className="mt-2 w-full bg-transparent text-base font-semibold outline-none" /></label>
              <label className="rounded-[20px] bg-[#f7f4ec] p-4"><span className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">Model</span><input value={modelDraft.model} onChange={(event) => setModelDraft((draft) => ({ ...draft, model: event.target.value }))} className="mt-2 w-full bg-transparent text-base font-semibold outline-none" /></label>
              <label className="rounded-[20px] bg-[#f7f4ec] p-4"><span className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">Reasoning Model</span><input value={modelDraft.reasoningModel} onChange={(event) => setModelDraft((draft) => ({ ...draft, reasoningModel: event.target.value }))} placeholder="可为空" className="mt-2 w-full bg-transparent text-base font-semibold outline-none" /></label>
              <label className="rounded-[20px] bg-[#f7f4ec] p-4"><span className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">Temperature</span><input value={modelDraft.temperature} onChange={(event) => setModelDraft((draft) => ({ ...draft, temperature: event.target.value }))} className="mt-2 w-full bg-transparent text-base font-semibold outline-none" /></label>
              <label className="rounded-[20px] bg-[#f7f4ec] p-4 md:col-span-2"><span className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">API Base</span><input value={modelDraft.apiBase} onChange={(event) => setModelDraft((draft) => ({ ...draft, apiBase: event.target.value }))} className="mt-2 w-full bg-transparent text-base font-semibold outline-none" /></label>
              <label className="rounded-[20px] bg-[#f7f4ec] p-4 md:col-span-2"><span className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">API Key</span><input type="password" value={modelDraft.apiKey} onChange={(event) => setModelDraft((draft) => ({ ...draft, apiKey: event.target.value }))} placeholder={modelOk ? '已配置，留空则保留原密钥' : '填入你自己的模型 API Key'} className="mt-2 w-full bg-transparent text-base font-semibold outline-none" /><span className="mt-2 block text-xs text-stone-500">按当前用户加密保存。切换账号后不会复用上一个账号的密钥。</span></label>
            </div>
            <div className="mt-5 flex flex-wrap gap-3"><button disabled={!model?.id || updateModel.isPending} onClick={saveModel} className="rounded-full bg-stone-950 px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45">保存模型</button><button disabled={testModel.isPending || !modelOk} onClick={() => testModel.mutate()} className="rounded-full bg-stone-100 px-5 py-3 text-sm font-semibold text-stone-700 disabled:cursor-not-allowed disabled:opacity-45">测试连接</button></div>
            {(testModel.isPending || modelTestResult) && (
              <div className={`mt-4 rounded-[20px] border p-4 text-sm leading-6 ${modelTestResult?.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : testModel.isPending ? 'border-stone-200 bg-stone-50 text-stone-600' : 'border-red-200 bg-red-50 text-red-900'}`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <strong>{modelTestResult?.ok ? '模型连接可用' : testModel.isPending ? '正在测试模型' : '模型连接不可用'}</strong>
                  <span className="rounded-full bg-white/70 px-2.5 py-1 text-xs font-semibold">{modelTestResult?.reason || (testModel.isPending ? 'testing' : 'unknown')}</span>
                </div>
                <p className="mt-2">{modelTestMessage}</p>
              </div>
            )}
          </section>

          <section id="settings-data" className="scroll-mt-24 rounded-[28px] border border-stone-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-400">Workspace</p>
            <h2 className="mt-2 text-2xl font-semibold">账号与数据</h2>
            <p className="mt-2 text-sm leading-6 text-stone-500">影响能力：当前账号的数据空间、导出、清空和 Agent 记忆边界。</p>
            <div className="mt-5 space-y-3 rounded-[22px] bg-[#f7f4ec] p-4 text-sm text-stone-600">
              <p><strong className="text-stone-950">隔离规则：</strong>目标、日志、行动、提醒、模型和 QQ 配置都按当前用户读取。</p>
              <p><strong className="text-stone-950">密钥规则：</strong>导出时脱敏，页面不回显明文。</p>
            </div>
            <div className="mt-5 grid gap-3"><button disabled={exportUserData.isPending} onClick={() => exportUserData.mutate()} className="w-full rounded-full bg-stone-950 px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45">导出当前账号数据</button><button disabled={deleteAgentMemory.isPending} onClick={handleDeleteAgentMemory} className="w-full rounded-full bg-stone-100 px-5 py-3 text-sm font-semibold text-stone-700 disabled:cursor-not-allowed disabled:opacity-45">清除 Agent 记忆</button><button disabled={deleteWorkspaceData.isPending} onClick={handleDeleteWorkspaceData} className="w-full rounded-full bg-red-50 px-5 py-3 text-sm font-semibold text-red-700 disabled:cursor-not-allowed disabled:opacity-45">清除工作区数据</button></div>
          </section>
        </div>

        <section id="settings-qq" className="scroll-mt-24 rounded-[28px] border border-stone-200 bg-white p-5 shadow-sm">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-400">Optional channel</p><h2 className="mt-2 text-2xl font-semibold">QQ 主动助手</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-stone-500">影响能力：AI 能不能在早中晚主动联系你、追问进度、推动复盘。不配置 QQ 也可以使用 Web。</p></div><StatusPill ok={qqOk && qqBound}>{qqConnectionStatus} · {qqBindingStatus}</StatusPill></div>
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            <label className="rounded-[20px] bg-[#f7f4ec] p-4"><span className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">App ID</span><input value={qqBotDraft.appId} onChange={(event) => setQqBotDraft((draft) => ({ ...draft, appId: event.target.value }))} placeholder="QQ 机器人 App ID" className="mt-2 w-full bg-transparent text-base font-semibold outline-none" /></label>
            <label className="rounded-[20px] bg-[#f7f4ec] p-4"><span className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">Token / Secret</span><input type="password" value={qqBotDraft.token} onChange={(event) => setQqBotDraft((draft) => ({ ...draft, token: event.target.value }))} placeholder={qqBotConfig?.tokenConfigured ? '已配置，留空则保留原 token' : '填入 QQ Bot Token'} className="mt-2 w-full bg-transparent text-base font-semibold outline-none" /><span className="mt-2 block text-xs text-stone-500">加密保存，不回显明文。</span></label>
            <label className="rounded-[20px] bg-[#f7f4ec] p-4"><span className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">API Base</span><input value={qqBotDraft.apiBase} onChange={(event) => setQqBotDraft((draft) => ({ ...draft, apiBase: event.target.value }))} className="mt-2 w-full bg-transparent text-base font-semibold outline-none" /></label>
            <label className="rounded-[20px] bg-[#f7f4ec] p-4"><span className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">Gateway Intents</span><input value={qqBotDraft.intents} onChange={(event) => setQqBotDraft((draft) => ({ ...draft, intents: event.target.value }))} className="mt-2 w-full bg-transparent text-base font-semibold outline-none" /></label>
            <label className="rounded-[20px] bg-[#f7f4ec] p-4 md:col-span-2"><span className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">允许会话</span><input value={qqBotDraft.allowedContextIds} onChange={(event) => setQqBotDraft((draft) => ({ ...draft, allowedContextIds: event.target.value }))} placeholder="高级限制，可留空；多个用逗号分隔" className="mt-2 w-full bg-transparent text-base font-semibold outline-none" /><span className="mt-2 block text-xs text-stone-500">留空表示不限制。用户归属不靠这里判断，只靠绑定码。</span></label>
            </div>
            <div className="rounded-[24px] border border-stone-200 bg-[#f7f4ec] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">Bind current account</p>
              <h3 className="mt-2 text-xl font-semibold text-stone-950">把 QQ 绑定到当前账号</h3>
              <p className="mt-2 text-sm leading-6 text-stone-500">{qqOk ? '生成一次性绑定码，然后在 QQ 里发给机器人。只有发出这条命令的 QQ 会话会绑定到当前登录账号。' : '先保存 App ID 和 Token，才能生成绑定码。'}</p>
              <div className="mt-4 rounded-2xl bg-white p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-400">QQ message</p>
                <p className="mt-2 break-all font-mono text-lg font-semibold text-stone-950">{qqBinding?.command || '绑定 GM-XXXXXX'}</p>
                <p className="mt-2 text-xs text-stone-500">{qqBinding?.active ? `有效期到 ${formatDate(qqBinding.expiresAt)}` : '当前没有有效绑定码。'}</p>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button disabled={!qqOk || generateQqBindingCode.isPending} onClick={() => generateQqBindingCode.mutate()} className="rounded-full bg-stone-950 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45">生成绑定码</button>
                <button disabled={!qqBinding?.command} onClick={() => copyQqBindingCommand(qqBinding.command)} className="rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-stone-700 disabled:cursor-not-allowed disabled:opacity-45">复制命令</button>
              </div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3"><label className="flex items-center gap-2 rounded-full bg-stone-100 px-4 py-2 text-sm font-semibold text-stone-700"><input type="checkbox" checked={qqBotDraft.enabled} onChange={(event) => setQqBotDraft((draft) => ({ ...draft, enabled: event.target.checked }))} className="h-4 w-4 accent-stone-950" />启用 QQ Bot</label><button disabled={updateQqBotConfig.isPending} onClick={saveQqBot} className="rounded-full bg-stone-950 px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45">保存 QQ</button><button disabled={testQqBot.isPending || !qqOk} onClick={() => testQqBot.mutate()} className="rounded-full bg-stone-100 px-5 py-3 text-sm font-semibold text-stone-700 disabled:cursor-not-allowed disabled:opacity-45">测试 QQ</button></div>
          <div className="mt-5 rounded-[22px] bg-[#f7f4ec] p-4"><p className="text-sm font-semibold text-stone-950">已绑定会话</p><div className="mt-3 grid gap-2 md:grid-cols-2">{qqBindings.length ? qqBindings.map((binding: any) => <div key={binding.id} className="rounded-2xl bg-white p-3"><p className="break-all text-sm font-semibold">{binding.contextType}:{binding.contextIdMasked || binding.contextId}</p><p className="mt-1 text-xs text-stone-500">{binding.status} · {formatDate(binding.updatedAt)}</p></div>) : <p className="text-sm text-stone-500">暂无绑定。先生成绑定码，再在 QQ 里发送绑定命令。</p>}</div></div>
        </section>

        <section id="settings-reminders" className="scroll-mt-24 rounded-[28px] border border-stone-200 bg-white p-5 shadow-sm">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-400">Rhythm</p><h2 className="mt-2 text-2xl font-semibold">主动推进节奏</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-stone-500">影响能力：AI 在什么时候问你问题。提醒规则只决定节奏；QQ 配置并绑定后，系统才真的能主动发给你。</p></div><div className="flex flex-wrap items-center gap-2"><StatusPill ok={reminderDeliveryReady}>{reminderStatus}</StatusPill><button disabled={updateReminderRules.isPending} onClick={saveReminderRules} className="rounded-full bg-stone-950 px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45">保存提醒</button></div></div>
          <div className="grid gap-3 lg:grid-cols-4">{reminderDrafts.map((rule, index) => { const meta = reminderMeta.find((item) => item.type === rule.reminderType); return <div key={rule.reminderType} className="rounded-[22px] bg-[#f7f4ec] p-4"><label className="flex items-start justify-between gap-3"><span><span className="block font-semibold">{meta?.label || rule.reminderType}</span><span className="mt-1 block text-xs leading-5 text-stone-500">{meta?.purpose}</span></span><input type="checkbox" checked={rule.enabled} onChange={(event) => updateReminder(index, { enabled: event.target.checked })} className="mt-1 h-5 w-5 accent-stone-950" /></label><div className="mt-4 grid gap-3"><label><span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-400">Schedule</span><input value={rule.schedule} onChange={(event) => updateReminder(index, { schedule: event.target.value })} className="mt-1 w-full rounded-2xl border border-stone-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-stone-900" /></label><label><span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-400">Max / Day</span><input type="number" min={1} max={8} value={rule.maxPerDay} onChange={(event) => updateReminder(index, { maxPerDay: Math.max(1, Number(event.target.value) || 1) })} className="mt-1 w-full rounded-2xl border border-stone-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-stone-900" /></label><label><span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-400">Quiet Hours</span><input value={rule.quietHours} onChange={(event) => updateReminder(index, { quietHours: event.target.value })} className="mt-1 w-full rounded-2xl border border-stone-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-stone-900" /></label></div></div> })}</div>
          <div className="mt-4 rounded-[22px] bg-stone-950 p-4 text-white"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">最近调度</p><div className="mt-3 grid gap-2 md:grid-cols-2 lg:grid-cols-4">{schedulerEvents.length ? schedulerEvents.slice(0, 4).map((event: any) => <div key={event.id} className="rounded-2xl bg-white/10 p-3"><p className="text-sm font-semibold">{ruleLabel(event.eventType)}</p><p className="mt-1 text-xs text-stone-300">{event.status} · {formatDate(event.createdAt)}</p></div>) : <p className="text-sm text-stone-300">暂无调度记录。</p>}</div></div>
        </section>

        <section id="settings-behavior" className="scroll-mt-24 rounded-[28px] border border-stone-200 bg-white p-5 shadow-sm">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-400">Behavior</p><h2 className="mt-2 text-2xl font-semibold">系统行为</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-stone-500">影响能力：Today 怎么显示、日志怎么写、Agent 能读什么、写入前是否确认。</p></div><button disabled={updateSettings.isPending} onClick={saveBehaviorSettings} className="rounded-full bg-stone-950 px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45">保存行为设置</button></div>
          <div className="grid gap-3 lg:grid-cols-3"><div className="rounded-[22px] bg-[#f7f4ec] p-4"><h3 className="font-semibold">Today</h3><div className="mt-4 grid gap-3"><label><span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-400">Heatmap</span><select value={behaviorDraft.today.heatmap_scope} onChange={(event) => setBehaviorDraft((draft) => ({ ...draft, today: { ...draft.today, heatmap_scope: event.target.value } }))} className="mt-1 w-full rounded-2xl border border-stone-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-stone-900"><option value="year">Year</option><option value="quarter">Quarter</option><option value="month">Month</option><option value="week">Week</option></select></label><ToggleRow label="低精力模式" description="Today 优先保留最小启动和替代动作。" checked={behaviorDraft.today.low_energy_mode} onChange={(checked) => setBehaviorDraft((draft) => ({ ...draft, today: { ...draft.today, low_energy_mode: checked } }))} /></div></div><div className="rounded-[22px] bg-[#f7f4ec] p-4"><h3 className="font-semibold">Logs</h3><div className="mt-4 grid gap-3"><ToggleRow label="自动写入 Check-in" description="完成/部分完成/没做追加到当日日志。" checked={behaviorDraft.logs.auto_write_checkin} onChange={(checked) => setBehaviorDraft((draft) => ({ ...draft, logs: { ...draft.logs, auto_write_checkin: checked } }))} /><ToggleRow label="自动写入复盘" description="日/周/月复盘沉淀到 Markdown。" checked={behaviorDraft.logs.auto_write_review} onChange={(checked) => setBehaviorDraft((draft) => ({ ...draft, logs: { ...draft.logs, auto_write_review: checked } }))} /></div></div><div className="rounded-[22px] bg-[#f7f4ec] p-4"><h3 className="font-semibold">Agent 权限</h3><div className="mt-4 grid gap-3"><ToggleRow label="读取 Goals" description="允许 Agent 基于目标结构回答。" checked={behaviorDraft.agent.can_read_goals} onChange={(checked) => setBehaviorDraft((draft) => ({ ...draft, agent: { ...draft.agent, can_read_goals: checked } }))} /><ToggleRow label="读取 Logs" description="允许 Agent 引用 Markdown 推进记录。" checked={behaviorDraft.agent.can_read_logs} onChange={(checked) => setBehaviorDraft((draft) => ({ ...draft, agent: { ...draft.agent, can_read_logs: checked } }))} /><ToggleRow label="改动前确认" description="目标、设置、外部动作写入前必须确认。" checked={behaviorDraft.agent.require_confirm_goal_changes && behaviorDraft.agent.require_confirm_setting_changes && behaviorDraft.agent.require_confirm_external_actions} onChange={(checked) => setBehaviorDraft((draft) => ({ ...draft, agent: { ...draft.agent, require_confirm_goal_changes: checked, require_confirm_setting_changes: checked, require_confirm_external_actions: checked } }))} /></div></div></div>
        </section>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <section id="settings-tools" className="scroll-mt-24 rounded-[28px] border border-stone-200 bg-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-400">Audit</p><h2 className="mt-2 text-2xl font-semibold">工具动作</h2><p className="mt-2 text-sm leading-6 text-stone-500">影响能力：知道 Agent 最近读了什么、准备写什么、哪些动作等待确认。</p><div className="mt-5 space-y-2">{toolActions.length ? toolActions.slice(0, 8).map((action: any) => <div key={action.id} className="grid min-w-0 gap-3 rounded-3xl bg-stone-50 p-4 md:grid-cols-[180px_minmax(0,1fr)_140px] md:items-center"><div className="min-w-0"><p className="font-semibold">{action.toolName}</p><p className="text-xs text-stone-500">{action.source} · {action.permission}</p></div><p className="min-w-0 truncate text-sm text-stone-600">{action.inputSummary}</p><div className="flex min-w-0 items-center justify-between gap-2 md:justify-end"><span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusClass(action.status)}`}>{action.status}</span><span className="text-xs text-stone-400">{formatDate(action.createdAt)}</span></div></div>) : <div className="rounded-3xl bg-stone-50 p-4 text-sm text-stone-500">暂无 Agent 工具动作。</div>}</div></section>
          <section id="settings-deployment" className="scroll-mt-24 rounded-[28px] border border-stone-200 bg-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-400">Deploy</p><h2 className="mt-2 text-2xl font-semibold">部署状态</h2><p className="mt-2 text-sm leading-6 text-stone-500">影响能力：服务器能不能长期运行、关闭电脑后能不能继续主动提醒。</p><div className="mt-5 grid gap-2">{runtimeWorkers.map((item) => <div key={item.key} className="rounded-2xl bg-stone-950 p-3 text-white"><div className="flex items-center justify-between gap-3"><p className="text-sm font-semibold">{item.label}</p><RuntimeStatusPill status={item.status} /></div><p className="mt-1 text-xs leading-5 text-stone-300">{item.status?.label || '还没有心跳记录。'} · {item.status?.evidence || 'no heartbeat'}</p></div>)}</div><div className="mt-5 grid gap-3">{deploymentRequired.length ? deploymentRequired.map((item: any) => <div key={item.key} className="rounded-2xl bg-[#f7f4ec] p-3"><div className="flex items-center justify-between gap-3"><p className="text-sm font-semibold text-stone-950">{item.label}</p><span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${item.configured ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>{item.configured ? 'OK' : '缺失'}</span></div><p className="mt-1 break-words text-xs text-stone-500">{item.secret ? '服务器环境变量保存，不在页面显示。' : (item.value || item.reason)}</p></div>) : <p className="rounded-2xl bg-stone-50 p-3 text-sm text-stone-500">暂无部署检查项。</p>}</div></section>
        </div>
      </div>
    </div>
  )
}
