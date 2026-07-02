'use client'

import { useEffect, useMemo, useState } from 'react'
import { currentMarkdown, logTree } from '@/lib/goal-mate-demo-data'
import { useLog, useLogTree, useUpdateLog } from '@/hooks/use-logs'

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

function LogTreeNode({ node, level = 0, onSelect }: { node: TreeNode; level?: number; onSelect?: (id: string) => void }) {
  return (
    <div className="relative">
      <button
        onClick={() => node.id && onSelect?.(node.id)}
        className={`relative flex w-full items-center rounded-xl px-3 py-2 text-left text-sm ${node.active ? 'bg-stone-950 text-white' : 'text-stone-600 hover:bg-stone-100'}`}
        style={{ marginLeft: level * 16 }}
      >
        {level > 0 && <span className="absolute -left-2 top-0 h-full w-px bg-stone-200" />}
        <span className="truncate">{node.label}</span>
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
  const apiLog = logQuery.data?.data
  const [content, setContent] = useState(currentMarkdown)

  useEffect(() => {
    if (apiLog?.content) setContent(apiLog.content)
  }, [apiLog?.content])

  const tree = useMemo(() => logs.length ? pathsToTree(logs, selectedLogId) : logTree, [logs, selectedLogId])
  const title = apiLog?.title || '2026-07-01.md'
  const canSave = !!apiLog?.id

  const handleSave = () => {
    if (!apiLog?.id) return
    updateLog.mutate({ id: apiLog.id, content })
  }

  return (
    <div className="grid h-[calc(100vh-4rem)] grid-cols-1 overflow-hidden p-6 lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="overflow-y-auto rounded-l-[32px] border border-stone-200 bg-white p-5 shadow-sm lg:rounded-r-none">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-400">Logs</p>
        <h1 className="mt-2 text-2xl font-semibold text-stone-950">Markdown 推进记录</h1>
        <div className="mt-6 space-y-1">
          {tree.map((node) => <LogTreeNode key={node.label} node={node} onSelect={setSelectedId} />)}
        </div>
      </aside>

      <main className="flex min-h-0 flex-col rounded-r-[32px] border-y border-r border-stone-200 bg-stone-50 shadow-sm">
        <div className="flex items-center justify-between border-b border-stone-200 bg-white px-6 py-4">
          <div>
            <h2 className="text-xl font-semibold text-stone-950">{title}</h2>
            <p className="text-sm text-stone-500">{canSave ? '已连接日志 API · 可保存' : '当前显示 demo Markdown · seed 后可保存'}</p>
          </div>
          <button disabled={!canSave || updateLog.isPending} onClick={handleSave} className="rounded-full bg-stone-950 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45">保存</button>
        </div>
        <textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          className="min-h-0 flex-1 resize-none bg-transparent p-6 font-mono text-sm leading-7 text-stone-800 outline-none"
        />
      </main>
    </div>
  )
}
