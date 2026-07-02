'use client'

import { settingsGroups } from '@/lib/goal-mate-demo-data'
import { useModels } from '@/hooks/use-models'
import { useExportUserData, useSettings, useTestModelConnection } from '@/hooks/use-settings'

function settingValue(source: any, group: string, key: string, fallback: string) {
  const map: Record<string, string> = {
    Logs: 'logs',
    Agent: 'agent',
    Notifications: 'notifications',
  }
  const section = source?.[map[group]]
  if (!section) return fallback
  const normalizedKey = key.toLowerCase().replaceAll(' ', '_')
  return section[normalizedKey] ?? fallback
}

export function SettingsView() {
  const settingsQuery = useSettings()
  const modelsQuery = useModels()
  const testModel = useTestModelConnection()
  const exportUserData = useExportUserData()
  const settings = settingsQuery.data?.data
  const model = modelsQuery.data?.data?.[0]

  const groups = settingsGroups.map((group) => {
    if (group.name === 'Models' && model) {
      return {
        ...group,
        fields: [
          ['Provider', model.provider],
          ['Chat Model', model.model],
          ['Reasoning Model', model.reasoningModel || 'deepseek-reasoner'],
          ['API Base', model.apiBase],
          ['API Key', model.apiKeyRef],
        ],
      }
    }

    if (group.name === 'Logs' || group.name === 'Agent' || group.name === 'Notifications') {
      return {
        ...group,
        fields: group.fields.map(([label, fallback]) => [label, String(settingValue(settings, group.name, label, fallback))]),
      }
    }

    return group
  })

  return (
    <div className="grid min-h-[calc(100vh-4rem)] gap-6 p-6 xl:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="rounded-[32px] border border-stone-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-400">Settings</p>
        <h1 className="mt-2 text-2xl font-semibold text-stone-950">系统行为配置</h1>
        <nav className="mt-6 space-y-2">
          {['General', 'Goals', 'Logs', 'Today', 'Agent', 'Models', 'Notifications', 'Integrations', 'Data & Privacy'].map((item) => (
            <a key={item} href={`#${item}`} className={`block rounded-2xl px-4 py-3 text-sm ${item === 'Models' ? 'bg-stone-950 text-white' : 'text-stone-600 hover:bg-stone-100'}`}>
              {item}
            </a>
          ))}
        </nav>
      </aside>

      <main className="space-y-6">
        {groups.map((group) => (
          <section id={group.name} key={group.name} className="rounded-[32px] border border-stone-200 bg-white p-6 shadow-sm">
            <div className="mb-6 max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-400">{group.name}</p>
              <h2 className="mt-2 text-2xl font-semibold text-stone-950">{group.name === 'Models' ? '模型配置' : group.name}</h2>
              <p className="mt-2 text-sm leading-6 text-stone-500">{group.description}</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {group.fields.map(([label, value]) => (
                <label key={label} className="rounded-2xl bg-stone-50 p-4">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">{label}</span>
                  <input value={value} readOnly className="mt-2 w-full bg-transparent text-base font-medium text-stone-900 outline-none" />
                  <span className="mt-2 block text-xs leading-5 text-stone-500">修改后会影响 Agent 的规划、提醒或记录行为。</span>
                </label>
              ))}
            </div>
            {group.name === 'Models' && (
              <div className="mt-5 flex flex-wrap gap-3">
                <button disabled={testModel.isPending} onClick={() => testModel.mutate()} className="rounded-full bg-stone-950 px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45">测试连接</button>
                <button className="rounded-full bg-stone-100 px-5 py-3 text-sm font-semibold text-stone-700">设为默认</button>
              </div>
            )}
          </section>
        ))}
        <section id="Data & Privacy" className="rounded-[32px] border border-stone-200 bg-white p-6 shadow-sm">
          <div className="mb-6 max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-400">Data & Privacy</p>
            <h2 className="mt-2 text-2xl font-semibold text-stone-950">数据与隐私</h2>
            <p className="mt-2 text-sm leading-6 text-stone-500">导出目标、日志、Agent 对话和设置；模型密钥会被脱敏，不导出明文 API Key。</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              disabled={exportUserData.isPending}
              onClick={() => exportUserData.mutate()}
              className="rounded-full bg-stone-950 px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45"
            >
              导出数据
            </button>
            <button className="rounded-full bg-stone-100 px-5 py-3 text-sm font-semibold text-stone-700">
              删除数据需要强确认
            </button>
          </div>
        </section>
      </main>
    </div>
  )
}
