'use client'

import { useEffect, useMemo, useState } from 'react'
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
  const apiLog = logQuery.data?.data
  const [content, setContent] = useState('')

  useEffect(() => {
    setContent(apiLog?.content || '')
  }, [apiLog?.id, apiLog?.content])

  const tree = useMemo(() => logs.length ? pathsToTree(logs, selectedLogId) : [], [logs, selectedLogId])
  const title = apiLog?.title || '未选择日志'
  const canSave = !!apiLog?.id

  const handleSave = () => {
    if (!apiLog?.id) return
    updateLog.mutate({ id: apiLog.id, content })
  }

  return (
    <div className="grid h-[calc(100vh-4rem)] grid-cols-1 grid-rows-[210px_minmax(0,1fr)] overflow-hidden p-4 md:p-6 lg:grid-cols-[300px_minmax(0,1fr)] lg:grid-rows-1">
      <aside className="overflow-y-auto overflow-x-hidden rounded-t-[32px] border border-stone-200 bg-white p-5 shadow-sm lg:rounded-l-[32px] lg:rounded-r-none lg:rounded-t-none">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-400">Logs</p>
        <h1 className="mt-2 text-2xl font-semibold text-stone-950">Markdown 推进记录</h1>
        <div className="mt-6 space-y-1">
          {tree.length ? tree.map((node) => <LogTreeNode key={node.label} node={node} onSelect={setSelectedId} />) : (
            <div className="rounded-2xl border border-dashed border-stone-200 p-4 text-sm leading-6 text-stone-500">
              还没有日志文件。Agent 生成年志、周志、日记后会出现在这里。
            </div>
          )}
        </div>
      </aside>

      <main className="flex min-h-0 flex-col rounded-b-[32px] border-x border-b border-stone-200 bg-stone-50 shadow-sm lg:rounded-b-none lg:rounded-r-[32px] lg:border-y lg:border-l-0 lg:border-r">
        <div className="flex items-center justify-between border-b border-stone-200 bg-white px-6 py-4">
          <div>
            <h2 className="text-xl font-semibold text-stone-950">{title}</h2>
            <p className="text-sm text-stone-500">{canSave ? '已连接日志 API · 可直接编辑保存' : '选择一篇真实日志后才可以编辑保存'}</p>
          </div>
          <button disabled={!canSave || updateLog.isPending} onClick={handleSave} className="rounded-full bg-stone-950 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45">保存</button>
        </div>
        <textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder="这里显示真实 Markdown 日志。没有日志时，不展示示例文本。"
          disabled={!canSave}
          className="min-h-0 flex-1 resize-none bg-transparent p-6 font-mono text-sm leading-7 text-stone-800 outline-none"
        />
      </main>
    </div>
  )
}
