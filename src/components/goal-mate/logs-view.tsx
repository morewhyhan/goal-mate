'use client'

import { useEffect, useMemo, useState } from 'react'
import { useLog, useLogTree, usePatchLog, useUpdateLog } from '@/hooks/use-logs'

type TreeNode = {
  id?: string
  label: string
  path?: string
  active?: boolean
  children?: TreeNode[]
}

function pathsToTree(items: any[], selectedId?: string): TreeNode[] {
  const root: TreeNode[] = []

  for (const item of items) {
    const parts = String(item.path || item.title).split('/').filter(Boolean)
    if (parts[0] === 'logs') parts.shift()
    let level = root
    parts.forEach((part, index) => {
      let node = level.find((entry) => entry.label === part)
      if (!node) {
        node = { label: part, children: [] }
        level.push(node)
      }
      if (index === parts.length - 1) {
        node.id = item.id
        node.path = item.path
        node.active = item.id === selectedId
      }
      level = node.children || []
    })
  }

  return root
}

function pad(value: number) {
  return String(value).padStart(2, '0')
}

function getWeekNumber(date: Date) {
  const copied = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = copied.getUTCDay() || 7
  copied.setUTCDate(copied.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(copied.getUTCFullYear(), 0, 1))
  return Math.ceil((((copied.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
}

function buildTodayLogPath(date = new Date()) {
  const year = date.getFullYear()
  const quarter = `Q${Math.floor(date.getMonth() / 3) + 1}`
  const month = `${year}-${pad(date.getMonth() + 1)}`
  const week = `W${pad(getWeekNumber(date))}`
  const day = `${year}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  return `logs/${year}/${quarter}/${month}/${week}/${day}.md`
}

function buildTodayLogTemplate(date = new Date()) {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  return [
    `# ${day}`,
    '',
    '## 今日主目标',
    '',
    '- 目标：',
    '- 当前 KR：',
    '- 当前关键条件：',
    '',
    '## 今日行动',
    '',
    '- 行动：',
    '- 完成标准：',
    '- 最小启动：',
    '',
    '## 执行反馈',
    '',
    '- 结果：',
    '- 原因：',
    '- 调整：',
    '',
    '## 自由记录',
    '',
    '',
  ].join('\n')
}

function LogTreeNode({ node, level = 0, onSelect }: { node: TreeNode; level?: number; onSelect?: (id: string) => void }) {
  return (
    <div className="relative">
      <button
        onClick={() => node.id && onSelect?.(node.id)}
        className={`relative flex w-full min-w-0 max-w-full items-center rounded-xl px-3 py-2 text-left text-sm ${node.active ? 'bg-stone-950 text-white' : 'text-stone-600 hover:bg-stone-100'}`}
        style={{ paddingLeft: 12 + level * 16 }}
      >
        {level > 0 && <span className="absolute -left-2 top-0 h-full w-px bg-stone-200" />}
        <span className="min-w-0 flex-1 truncate">{node.label}</span>
      </button>
      {node.children && <div className="mt-1 space-y-1">{node.children.map((child) => <LogTreeNode key={`${node.label}-${child.label}`} node={child} level={level + 1} onSelect={onSelect} />)}</div>}
    </div>
  )
}

export function LogsView() {
  const treeQuery = useLogTree()
  const logs = treeQuery.data?.data || []
  const [selectedId, setSelectedId] = useState<string | undefined>()
  const selectedLogId = selectedId || logs[0]?.id
  const logQuery = useLog(selectedLogId)
  const updateLog = useUpdateLog()
  const createLog = usePatchLog()
  const apiLog = logQuery.data?.data
  const [content, setContent] = useState('')

  useEffect(() => {
    setContent(apiLog?.content || '')
  }, [apiLog?.id, apiLog?.content])

  const tree = useMemo(() => logs.length ? pathsToTree(logs, selectedLogId) : [], [logs, selectedLogId])
  const title = apiLog?.title || '未选择日志'
  const canSave = !!apiLog?.id
  const isDirty = canSave && content !== (apiLog?.content || '')
  const saveStatus = updateLog.isPending
    ? '保存中'
    : createLog.isPending
      ? '创建中'
      : isDirty
        ? '未保存'
        : canSave
          ? '已保存'
          : '未创建'

  const handleSave = () => {
    if (!apiLog?.id || !isDirty) return
    updateLog.mutate({ id: apiLog.id, content })
  }

  const handleCreateTodayLog = () => {
    const path = buildTodayLogPath()
    const existing = logs.find((log: any) => log.path === path)
    if (existing?.id) {
      setSelectedId(existing.id)
      return
    }

    createLog.mutate(
      {
        targetLog: path,
        writeMode: 'create',
        markdownContent: buildTodayLogTemplate(),
        sourceContext: ['logs_page_manual_create'],
      },
      {
        onSuccess: (response: any) => {
          if (response?.data?.id) setSelectedId(response.data.id)
          if (response?.data?.content) setContent(response.data.content)
        },
      },
    )
  }

  return (
    <div className="grid h-[calc(100vh-4rem)] grid-cols-1 grid-rows-[210px_minmax(0,1fr)] overflow-hidden p-4 md:p-6 lg:grid-cols-[300px_minmax(0,1fr)] lg:grid-rows-1">
      <aside className="overflow-y-auto overflow-x-hidden rounded-t-[32px] border border-stone-200 bg-white p-5 shadow-sm lg:rounded-l-[32px] lg:rounded-r-none lg:rounded-t-none">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-400">Logs</p>
        <div className="mt-2 flex items-start justify-between gap-3">
          <h1 className="text-2xl font-semibold text-stone-950">Markdown 推进记录</h1>
          <button disabled={createLog.isPending} onClick={handleCreateTodayLog} className="shrink-0 rounded-full bg-stone-100 px-3 py-2 text-xs font-semibold text-stone-600 ring-1 ring-stone-200 disabled:cursor-not-allowed disabled:opacity-45">
            手动新建
          </button>
        </div>
        <div className="mt-6 space-y-1">
          {treeQuery.isError ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-800">
              <p>{treeQuery.error?.message || '日志读取失败。'}</p>
              <button onClick={() => treeQuery.refetch()} className="mt-3 rounded-full bg-stone-950 px-3 py-1.5 text-xs font-semibold text-white">重新读取</button>
            </div>
          ) : treeQuery.isLoading ? (
            <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4 text-sm leading-6 text-stone-500">
              正在读取 Markdown 日志树。
            </div>
          ) : tree.length ? tree.map((node) => <LogTreeNode key={node.label} node={node} onSelect={setSelectedId} />) : (
            <div className="rounded-2xl border border-dashed border-stone-200 p-4 text-sm leading-6 text-stone-500">
              还没有日志文件。你可以先不用管这里；完成一次 Check-in 或复盘后，Agent 会把推进证据自动写入 Markdown。
              <div className="mt-4 flex flex-wrap gap-2">
                <a href="/dashboard/agent" className="rounded-full bg-stone-950 px-3 py-1.5 text-xs font-semibold text-white">去 Agent 反馈</a>
                <a href="/dashboard/today" className="rounded-full bg-stone-100 px-3 py-1.5 text-xs font-semibold text-stone-700">查看 Today</a>
              </div>
            </div>
          )}
        </div>
      </aside>

      <main className="flex min-h-0 flex-col rounded-b-[32px] border-x border-b border-stone-200 bg-stone-50 shadow-sm lg:rounded-b-none lg:rounded-r-[32px] lg:border-y lg:border-l-0 lg:border-r">
        <div className="flex items-center justify-between border-b border-stone-200 bg-white px-6 py-4">
          <div>
            <h2 className="text-xl font-semibold text-stone-950">{title}</h2>
            <p className="text-sm text-stone-500">{treeQuery.isLoading ? '正在读取日志 API' : canSave ? `已连接日志 API · ${saveStatus}` : '选择或创建一篇真实日志后才可以编辑保存'}</p>
            <p className="mt-1 text-xs text-stone-400">日志用于还原：系统观察、执行结果、偏差判断、下一步调整。</p>
          </div>
          <button disabled={!canSave || !isDirty || updateLog.isPending} onClick={handleSave} className="rounded-full bg-stone-950 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45">保存</button>
        </div>
        {logQuery.isError ? (
          <div className="m-6 rounded-2xl border border-red-200 bg-white p-5 text-sm leading-6 text-red-800">
            <p>{logQuery.error?.message || '这篇日志暂时无法读取。'}</p>
            <button onClick={() => logQuery.refetch()} className="mt-3 rounded-full bg-stone-950 px-3 py-1.5 text-xs font-semibold text-white">重新读取</button>
          </div>
        ) : (
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="这里显示真实 Markdown 日志。没有日志时，不展示示例文本。"
            disabled={!canSave}
            className="min-h-0 flex-1 resize-none bg-transparent p-6 font-mono text-sm leading-7 text-stone-800 outline-none"
          />
        )}
      </main>
    </div>
  )
}
