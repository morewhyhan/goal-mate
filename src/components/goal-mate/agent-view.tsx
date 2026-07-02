'use client'

import { useEffect, useState } from 'react'
import { agentMessages, agentThreads } from '@/lib/goal-mate-demo-data'
import { useAgentMessages, useAgentThreads, useAgentToolActions, useConfirmAgentToolAction, useRejectAgentToolAction, useSendAgentMessage } from '@/hooks/use-agent'

function statusClass(status?: string) {
  const normalized = String(status || '').toLowerCase()
  if (normalized.includes('executed') || normalized.includes('drafted')) return 'bg-emerald-100 text-emerald-800'
  if (normalized.includes('pending') || normalized.includes('approved')) return 'bg-amber-100 text-amber-800'
  if (normalized.includes('failed') || normalized.includes('rejected')) return 'bg-red-100 text-red-800'
  return 'bg-stone-100 text-stone-700'
}

function parseStructuredOutput(message: any) {
  const output = message?.structuredOutput
  return output && typeof output === 'object' ? output : {}
}

function ToolActionCard({
  message,
  action,
  onConfirm,
  onReject,
  busy,
}: {
  message: any
  action?: any
  onConfirm: (id: string) => void
  onReject: (id: string) => void
  busy: boolean
}) {
  const output = parseStructuredOutput(message)
  const toolName = action?.toolName || output?.toolIntent?.toolName || output?.toolName || 'agent.tool'
  const actionId = action?.id || output?.toolActionId
  const needsConfirmation = Boolean(output?.needsConfirmation || action?.status === 'pending_confirmation')
  if (!actionId && !needsConfirmation) return null

  const status = action?.status || (needsConfirmation ? 'pending_confirmation' : 'processed')
  const inputSummary = action?.inputSummary || JSON.stringify(output?.toolIntent?.input || {})

  return (
    <div className="mt-3 rounded-[22px] border border-amber-200 bg-amber-50 p-4 text-stone-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">Agent Action</p>
          <h3 className="mt-1 text-base font-semibold">{toolName}</h3>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusClass(status)}`}>{status}</span>
      </div>
      <p className="mt-3 line-clamp-2 text-xs leading-5 text-stone-600">{inputSummary}</p>
      {status === 'pending_confirmation' ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <button disabled={busy} onClick={() => onConfirm(actionId)} className="rounded-full bg-stone-950 px-4 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45">
            确认执行
          </button>
          <button disabled={busy} onClick={() => onReject(actionId)} className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-stone-700 ring-1 ring-stone-200 disabled:cursor-not-allowed disabled:opacity-45">
            取消
          </button>
        </div>
      ) : (
        <p className="mt-3 text-xs font-medium text-stone-500">该动作已处理，结果已写入工具审计。</p>
      )}
    </div>
  )
}

export function AgentView() {
  const threadsQuery = useAgentThreads()
  const threads = threadsQuery.data?.data || []
  const [selectedThreadId, setSelectedThreadId] = useState<string | undefined>()
  const activeThreadId = selectedThreadId || threads[0]?.id
  const messagesQuery = useAgentMessages(activeThreadId)
  const apiMessages = messagesQuery.data?.data || []
  const toolActionsQuery = useAgentToolActions()
  const toolActions = toolActionsQuery.data?.data || []
  const sendMessage = useSendAgentMessage()
  const confirmToolAction = useConfirmAgentToolAction(activeThreadId)
  const rejectToolAction = useRejectAgentToolAction(activeThreadId)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    if (!selectedThreadId && threads[0]?.id) setSelectedThreadId(threads[0].id)
  }, [selectedThreadId, threads])

  const visibleThreads = threads.length
    ? threads.map((thread: any) => ({ title: thread.title, time: '最近', active: thread.id === activeThreadId, id: thread.id }))
    : agentThreads
  const visibleMessages = apiMessages.length ? apiMessages : agentMessages
  const actionById = new Map(toolActions.map((action: any) => [action.id, action]))

  const handleSend = () => {
    if (!draft.trim() || !activeThreadId) return
    sendMessage.mutate({ threadId: activeThreadId, content: draft.trim() })
    setDraft('')
  }

  return (
    <div className="grid h-[calc(100vh-4rem)] grid-cols-1 overflow-hidden p-6 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="overflow-y-auto rounded-l-[32px] border border-stone-200 bg-white p-5 shadow-sm lg:rounded-r-none">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-400">Agent</p>
        <h1 className="mt-2 text-2xl font-semibold text-stone-950">对话历史</h1>
        <div className="mt-6 space-y-2">
          {visibleThreads.map((thread: any) => (
            <button key={thread.id || thread.title} onClick={() => thread.id && setSelectedThreadId(thread.id)} className={`block w-full rounded-2xl p-4 text-left ${thread.active ? 'bg-stone-950 text-white' : 'bg-stone-50 text-stone-700 hover:bg-stone-100'}`}>
              <span className="block font-medium">{thread.title}</span>
              <span className={`mt-1 block text-xs ${thread.active ? 'text-stone-300' : 'text-stone-400'}`}>{thread.time}</span>
            </button>
          ))}
        </div>
      </aside>

      <main className="flex min-h-0 flex-col rounded-r-[32px] border-y border-r border-stone-200 bg-stone-50 shadow-sm">
        <header className="border-b border-stone-200 bg-white px-6 py-4">
          <h2 className="text-xl font-semibold text-stone-950">{visibleThreads.find((thread: any) => thread.active)?.title || '暑假主目标拆解'}</h2>
          <p className="text-sm text-stone-500">Agent 可读取当前目标、日志、Today 行动和设置；关键修改需要确认。</p>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          <div className="mx-auto max-w-3xl space-y-5">
            {visibleMessages.map((message: any, index: number) => {
              const role = String(message.role || '').toLowerCase()
              const output = parseStructuredOutput(message)
              const actionId = output?.toolActionId || output?.confirmedActionId || output?.rejectedActionId
              const action = actionId ? actionById.get(actionId) : undefined
              return (
                <div key={message.id || index} className={`flex ${role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[78%] rounded-[24px] px-5 py-4 text-sm leading-7 ${role === 'user' ? 'bg-stone-950 text-white' : 'border border-stone-200 bg-white text-stone-700'}`}>
                    <div className="whitespace-pre-wrap">{message.content}</div>
                    {role !== 'user' && message.structuredOutputType === 'agent_tool_result' && (
                      <ToolActionCard
                        message={message}
                        action={action}
                        busy={confirmToolAction.isPending || rejectToolAction.isPending}
                        onConfirm={(id) => confirmToolAction.mutate({ id })}
                        onReject={(id) => rejectToolAction.mutate({ id, reason: '用户在 Agent 页面取消执行。' })}
                      />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <footer className="border-t border-stone-200 bg-white p-4">
          <div className="mx-auto flex max-w-3xl items-end gap-3 rounded-[26px] border border-stone-200 bg-stone-50 p-3">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="问 Agent：今天没做怎么办？这个目标为什么这么拆？帮我生成周志。"
              className="max-h-32 min-h-[52px] flex-1 resize-none bg-transparent px-2 py-2 text-sm leading-6 outline-none"
            />
            <button disabled={!activeThreadId || sendMessage.isPending} onClick={handleSend} className="rounded-full bg-stone-950 px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45">发送</button>
          </div>
        </footer>
      </main>
    </div>
  )
}
