'use client'

import { useEffect, useRef, useState } from 'react'
import {
  useAgentMessages,
  useAgentThreads,
  useAgentToolActions,
  useClearAgentThreadMessages,
  useConfirmAgentToolAction,
  useCreateAgentThread,
  useDeleteAgentThread,
  useRejectAgentToolAction,
  useSendAgentMessage,
  useUpdateAgentThread,
} from '@/hooks/use-agent'
import { useSettingsControlCenter } from '@/hooks/use-settings'

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

const quickPrompts = [
  { label: '建立目标', prompt: '我想达到的结果是：\n截止时间是：\n我现在的情况是：' },
  { label: '下一步', prompt: '我现在下一步应该做什么？' },
  { label: '没做诊断', prompt: '我今天没有完成，帮我判断原因，并把下一步改小。' },
  { label: '由你提醒', prompt: '你根据我的目标状态，在合适的时候主动提醒我开始。安静时段不要打扰，完成或暂停后就停止。' },
  { label: '暂停提醒', prompt: '暂停所有主动提醒，直到我再次明确开启。' },
  { label: '生成复盘', prompt: '根据最近目标、行动和日志，帮我生成今天的复盘。' },
  { label: '写入日志', prompt: '把我接下来这段反馈写入今天日志：' },
]

function isFirstGoalIntake(content: string) {
  return /我想达到的结果是|截止时间是|我现在的情况是/.test(content)
}

function asList(value: unknown) {
  return Array.isArray(value) ? value : []
}

function readableDate(value: unknown) {
  if (!value) return ''
  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('zh-CN')
}

function humanToolLabel(toolName: string, input: any) {
  if (toolName === 'goal.update') return '确认当前目标'
  if (toolName === 'today.set_next_action') return '调整当前任务'
  if (toolName === 'checkin.submit') return '记录执行反馈'
  if (toolName === 'log.write_daily') return '整理推进记录'
  if (toolName === 'review.generate') return '生成复盘'
  if (toolName === 'settings.model.update') return '更新模型设置'
  if (toolName === 'reminder.schedule') {
    return input?.enabled === false || ['pause', 'disable', 'off', 'revoke'].includes(String(input?.mode || '').toLowerCase())
      ? '暂停主动提醒'
      : '开启助手主动联系'
  }
  return '更新系统状态'
}

function humanStatusLabel(status: string) {
  if (status === 'pending_confirmation') return '等待你确认'
  if (status === 'executed') return '已执行'
  if (status === 'drafted') return '草稿已生成'
  if (status === 'approved') return '已确认'
  if (status === 'rejected') return '已取消'
  if (status === 'failed') return '执行失败'
  return '已处理'
}

function humanActionSummary(toolName: string, input: any) {
  if (toolName === 'reminder.schedule') {
    if (input?.enabled === false || ['pause', 'disable', 'off', 'revoke'].includes(String(input?.mode || '').toLowerCase())) {
      return '停止主动联系；你之后明确说重新开启时才会恢复。'
    }
    if (String(input?.mode || '').toLowerCase() === 'autonomous') {
      return '允许助手根据目标状态，在推荐候选时段自行决定发送、跳过或延后；安静时段、已完成、等待回复和连续无回应都会抑制提醒。'
    }
    return `调整提醒规则${input?.schedule ? `，候选时间 ${input.schedule}` : ''}。`
  }
  if (toolName === 'goal.update') return '把你核对过的目标设为当前推进方向。'
  if (toolName === 'today.set_next_action') return `把当前下一步调整为“${input?.title || '新的行动'}”。`
  if (toolName === 'settings.model.update') return '更新模型连接配置；密钥不会显示在对话里。'
  return '执行后会同步到目标、行动或推进记录；不会要求你手工维护内部结构。'
}

function GoalDraftReviewCard({
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
  const draft = output?.tool_result?.result
  const goal = draft?.goal
  if (!goal) return null

  const reasoningCard = draft?.reasoningCard || {}
  const keyResults = asList(draft?.keyResults)
  const conditions = asList(draft?.conditions)
  const stages = asList(draft?.stagePlans)
  const successSignals = asList(reasoningCard?.successSignals)
  const dailyAction = draft?.dailyAction
  const actionId = action?.id || output?.toolActionId
  const needsConfirmation = Boolean(output?.needsConfirmation || action?.status === 'pending_confirmation')
  const status = action?.status || (needsConfirmation ? 'pending_confirmation' : 'processed')
  const isPending = status === 'pending_confirmation'

  return (
    <section className="mt-4 overflow-hidden rounded-[24px] border border-amber-200 bg-amber-50 text-stone-900">
      <div className="border-b border-amber-200 bg-white/60 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">目标草稿 · 请核对</p>
            <h3 className="mt-2 text-xl font-semibold leading-7 text-stone-950">{goal.title || '新目标'}</h3>
            {goal.interpretedGoal ? <p className="mt-2 text-sm leading-6 text-stone-600">{goal.interpretedGoal}</p> : null}
          </div>
          <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${statusClass(status)}`}>
            {isPending ? '等待你确认' : status === 'rejected' ? '已取消' : '已处理'}
          </span>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold text-stone-600">
          {readableDate(goal.horizonEnd) ? <span className="rounded-full bg-white px-3 py-1.5 ring-1 ring-amber-200">目标日期 {readableDate(goal.horizonEnd)}</span> : null}
          {reasoningCard?.recommendedFocus ? <span className="rounded-full bg-white px-3 py-1.5 ring-1 ring-amber-200">当前重点：{reasoningCard.recommendedFocus}</span> : null}
        </div>
      </div>

      <div className="grid gap-3 p-4 md:grid-cols-2">
        <div className="rounded-[18px] bg-white p-4 ring-1 ring-amber-100">
          <h4 className="text-sm font-semibold text-stone-950">做到什么算成功</h4>
          <ul className="mt-2 space-y-2 text-sm leading-6 text-stone-600">
            {(successSignals.length ? successSignals : keyResults.map((item: any) => item.title)).map((item: any, index: number) => (
              <li key={`${String(item)}-${index}`} className="flex gap-2">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                <span>{String(item)}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-[18px] bg-white p-4 ring-1 ring-amber-100">
          <h4 className="text-sm font-semibold text-stone-950">关键结果</h4>
          <ul className="mt-2 space-y-2 text-sm leading-6 text-stone-600">
            {keyResults.map((item: any) => (
              <li key={item.id || item.title}>
                <strong className="font-semibold text-stone-800">{item.title}</strong>
                {item.currentValue || item.targetValue ? <span className="block text-xs text-stone-500">{item.currentValue || '当前待记录'} → {item.targetValue || '完成'}</span> : null}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-[18px] bg-white p-4 ring-1 ring-amber-100">
          <h4 className="text-sm font-semibold text-stone-950">必须具备的条件</h4>
          <ul className="mt-2 space-y-2 text-sm leading-6 text-stone-600">
            {conditions.map((item: any) => (
              <li key={item.id || item.title}>
                <strong className="font-semibold text-stone-800">{item.title}</strong>
                {item.whyRequired ? <span className="block text-xs leading-5 text-stone-500">{item.whyRequired}</span> : null}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-[18px] bg-white p-4 ring-1 ring-amber-100">
          <h4 className="text-sm font-semibold text-stone-950">推进阶段</h4>
          <ol className="mt-2 space-y-2 text-sm leading-6 text-stone-600">
            {stages.map((item: any, index: number) => (
              <li key={item.id || item.title} className="flex gap-2">
                <span className="font-semibold text-stone-400">{index + 1}.</span>
                <span><strong className="font-semibold text-stone-800">{item.title}</strong>{item.stageGoal ? `：${item.stageGoal}` : ''}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      {dailyAction ? (
        <div className="mx-4 mb-4 rounded-[18px] bg-stone-950 p-4 text-white">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/50">确认后的第一步</p>
          <h4 className="mt-2 text-base font-semibold">{dailyAction.title}</h4>
          <p className="mt-2 text-sm leading-6 text-white/70"><strong className="text-white">完成标准：</strong>{dailyAction.doneWhen}</p>
          <p className="mt-1 text-sm leading-6 text-white/70"><strong className="text-white">最小启动：</strong>{dailyAction.minimumStep}</p>
        </div>
      ) : null}

      <div className="border-t border-amber-200 p-4">
        {isPending && actionId ? (
          <>
            <p className="text-xs leading-5 text-stone-600">方向正确就激活；有任何理解偏差，先不激活，直接在对话里告诉我哪里需要改。</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button disabled={busy} onClick={() => onConfirm(actionId)} className="rounded-full bg-stone-950 px-4 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45">
                方向正确，设为当前目标
              </button>
              <button disabled={busy} onClick={() => onReject(actionId)} className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-stone-700 ring-1 ring-amber-200 disabled:cursor-not-allowed disabled:opacity-45">
                先不激活
              </button>
            </div>
          </>
        ) : isPending ? (
          <p className="text-xs font-medium text-amber-700">确认动作正在生成，稍后会自动刷新。</p>
        ) : (
          <p className="text-xs font-medium text-stone-500">{status === 'rejected' ? '这份草稿没有激活，你可以继续在对话中修改。' : '这份目标草稿已经处理。'}</p>
        )}
      </div>
    </section>
  )
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
  const requestedToolName = output?.toolIntent?.toolName || output?.tool_intent?.toolName
  if (requestedToolName === 'goal.create_draft' && output?.tool_result?.result?.goal) {
    return <GoalDraftReviewCard message={message} action={action} onConfirm={onConfirm} onReject={onReject} busy={busy} />
  }

  const toolName = action?.toolName || requestedToolName || output?.toolName || 'agent.tool'
  const actionId = action?.id || output?.toolActionId
  const needsConfirmation = Boolean(output?.needsConfirmation || action?.status === 'pending_confirmation')
  if (!actionId && !needsConfirmation) return null

  const status = action?.status || (needsConfirmation ? 'pending_confirmation' : 'processed')
  const actionInput = action?.input || output?.toolIntent?.input || output?.tool_intent?.input || {}

  return (
    <div className="mt-3 rounded-[22px] border border-amber-200 bg-amber-50 p-4 text-stone-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">{status === 'pending_confirmation' ? '需要确认' : '系统动作'}</p>
          <h3 className="mt-1 text-base font-semibold">{humanToolLabel(toolName, actionInput)}</h3>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusClass(status)}`}>{humanStatusLabel(status)}</span>
      </div>
      <p className="mt-3 text-xs leading-5 text-stone-600">{humanActionSummary(toolName, actionInput)}</p>
      {status === 'pending_confirmation' && actionId ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <button disabled={busy} onClick={() => onConfirm(actionId)} className="rounded-full bg-stone-950 px-4 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45">
            确认执行
          </button>
          <button disabled={busy} onClick={() => onReject(actionId)} className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-stone-700 ring-1 ring-stone-200 disabled:cursor-not-allowed disabled:opacity-45">
            取消
          </button>
        </div>
      ) : status === 'pending_confirmation' ? (
        <p className="mt-3 text-xs font-medium text-amber-700">动作正在生成编号，稍后会自动刷新。</p>
      ) : (
        <p className="mt-3 text-xs font-medium text-stone-500">该动作已处理，结果已写入工具审计。</p>
      )}
    </div>
  )
}

export function AgentView() {
  const threadsQuery = useAgentThreads()
  const controlCenter = useSettingsControlCenter()
  const threads = threadsQuery.data?.data || []
  const [selectedThreadId, setSelectedThreadId] = useState<string | undefined>()
  const activeThreadId = selectedThreadId || threads[0]?.id
  const messagesQuery = useAgentMessages(activeThreadId)
  const apiMessages = messagesQuery.data?.data || []
  const toolActionsQuery = useAgentToolActions()
  const toolActions = toolActionsQuery.data?.data || []
  const createThread = useCreateAgentThread()
  const updateThread = useUpdateAgentThread()
  const deleteThread = useDeleteAgentThread()
  const clearThreadMessages = useClearAgentThreadMessages()
  const sendMessage = useSendAgentMessage()
  const confirmToolAction = useConfirmAgentToolAction(activeThreadId)
  const rejectToolAction = useRejectAgentToolAction(activeThreadId)
  const [draft, setDraft] = useState('')
  const [optimisticMessage, setOptimisticMessage] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [clearConfirm, setClearConfirm] = useState(false)
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!selectedThreadId && threads[0]?.id) setSelectedThreadId(threads[0].id)
  }, [selectedThreadId, threads])

  const visibleThreads = threads.map((thread: any) => ({ title: thread.title, time: '最近', active: thread.id === activeThreadId, id: thread.id }))
  const filteredThreads = visibleThreads.filter((thread: any) => {
    const keyword = searchTerm.trim().toLowerCase()
    if (!keyword) return true
    return String(thread.title || '').toLowerCase().includes(keyword)
  })
  const visibleMessages = optimisticMessage
    ? [...apiMessages, { id: 'optimistic-user-message', role: 'USER', content: optimisticMessage, optimistic: true }]
    : apiMessages
  const actionById = new Map(toolActions.map((action: any) => [action.id, action]))
  const isSending = sendMessage.isPending || createThread.isPending
  const pendingActions = toolActions.filter((action: any) => action.status === 'pending_confirmation')
  const isMutatingThread = updateThread.isPending || deleteThread.isPending || clearThreadMessages.isPending
  const modelConfigured = Boolean(controlCenter.data?.data?.model?.apiKeyConfigured)
  const conversationError = threadsQuery.error || messagesQuery.error || toolActionsQuery.error

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: 'end' })
  }, [activeThreadId, visibleMessages.length, isSending])

  useEffect(() => {
    setClearConfirm(false)
    setDeleteConfirmId(null)
  }, [activeThreadId])

  const handleCreateThread = () => {
    createThread.mutate(
      { title: '新的 Agent 对话' },
      { onSuccess: (response: any) => setSelectedThreadId(response?.data?.id) },
    )
  }

  const startRenameThread = (thread: any) => {
    setDeleteConfirmId(null)
    setEditingThreadId(thread.id)
    setEditingTitle(thread.title)
  }

  const commitRenameThread = () => {
    const title = editingTitle.trim()
    if (!editingThreadId || !title) {
      setEditingThreadId(null)
      setEditingTitle('')
      return
    }

    updateThread.mutate(
      { id: editingThreadId, title },
      {
        onSuccess: () => {
          setEditingThreadId(null)
          setEditingTitle('')
        },
      },
    )
  }

  const handleDeleteThread = (threadId: string) => {
    if (deleteConfirmId !== threadId) {
      setEditingThreadId(null)
      setDeleteConfirmId(threadId)
      return
    }

    deleteThread.mutate(threadId, {
      onSuccess: () => {
        const nextThread = visibleThreads.find((thread: any) => thread.id !== threadId)
        setSelectedThreadId(nextThread?.id)
        setDeleteConfirmId(null)
      },
    })
  }

  const handleClearCurrentThread = () => {
    if (!activeThreadId || isMutatingThread) return
    if (!clearConfirm) {
      setClearConfirm(true)
      return
    }
    clearThreadMessages.mutate(activeThreadId, { onSuccess: () => setClearConfirm(false) })
  }

  const copyMessage = (message: any) => {
    const id = message.id || String(Date.now())
    void navigator.clipboard?.writeText(String(message.content || '')).then(() => {
      setCopiedMessageId(id)
      window.setTimeout(() => setCopiedMessageId(null), 1200)
    })
  }

  const sendToThread = (threadId: string, content: string) => {
    sendMessage.mutate(
      { threadId, content, structuredOutputType: isFirstGoalIntake(content) ? 'first_goal_intake' : undefined },
      {
        onSettled: () => setOptimisticMessage(null),
        onError: () => setDraft(content),
      },
    )
  }

  const sendContent = (rawContent: string) => {
    const content = rawContent.trim()
    if (!content || isSending) return
    setDraft('')
    setOptimisticMessage(content)

    if (activeThreadId) {
      sendToThread(activeThreadId, content)
      return
    }

    createThread.mutate(
      { title: content.length > 24 ? `${content.slice(0, 24)}...` : content },
      {
        onSuccess: (response: any) => {
          const threadId = response?.data?.id
          if (!threadId) {
            setDraft(content)
            setOptimisticMessage(null)
            return
          }
          setSelectedThreadId(threadId)
          sendToThread(threadId, content)
        },
        onError: () => {
          setDraft(content)
          setOptimisticMessage(null)
        },
      },
    )
  }

  const handleSend = () => {
    sendContent(draft)
  }

  const handleUsePrompt = (prompt: string) => {
    if (prompt.endsWith('：')) {
      setDraft(prompt)
      textareaRef.current?.focus()
      return
    }
    sendContent(prompt)
  }

  return (
    <div className="grid h-[calc(100dvh-3.75rem)] min-h-0 grid-cols-1 overflow-hidden bg-[#f4f1ea] p-3 md:p-4 xl:h-screen xl:grid-cols-[280px_minmax(0,1fr)] xl:gap-3 xl:p-5">
      <aside className="hidden min-h-0 flex-col rounded-[30px] border border-stone-200 bg-white p-4 shadow-sm xl:flex">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-400">Agent</p>
            <h1 className="mt-2 text-xl font-semibold text-stone-950">对话历史</h1>
          </div>
          <button
            disabled={createThread.isPending}
            onClick={handleCreateThread}
            className="rounded-full bg-stone-950 px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45"
          >
            新对话
          </button>
        </div>
        <div className="mt-4">
          <input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="搜索对话"
            className="w-full rounded-2xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm outline-none focus:border-stone-400 focus:bg-white"
          />
        </div>
        <div className="mt-4 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
          {threadsQuery.isLoading ? (
            <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4 text-sm leading-6 text-stone-500">
              正在读取对话历史。
            </div>
          ) : filteredThreads.length ? filteredThreads.map((thread: any) => (
            <div key={thread.id || thread.title} className={`group rounded-2xl p-2 ${thread.active ? 'bg-stone-950 text-white' : 'bg-stone-50 text-stone-700 hover:bg-stone-100'}`}>
              {editingThreadId === thread.id ? (
                <div className="space-y-2">
                  <input
                    autoFocus
                    value={editingTitle}
                    onChange={(event) => setEditingTitle(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') commitRenameThread()
                      if (event.key === 'Escape') {
                        setEditingThreadId(null)
                        setEditingTitle('')
                      }
                    }}
                    className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 outline-none"
                  />
                  <div className="flex gap-2">
                    <button disabled={updateThread.isPending} onClick={commitRenameThread} className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-stone-950 disabled:opacity-45">保存</button>
                    <button onClick={() => setEditingThreadId(null)} className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-current ring-1 ring-current/15">取消</button>
                  </div>
                </div>
              ) : (
                <>
                  <button onClick={() => thread.id && setSelectedThreadId(thread.id)} className="block w-full rounded-xl p-2 text-left">
                    <span className="block truncate text-sm font-semibold">{thread.title}</span>
                    <span className={`mt-1 block text-xs ${thread.active ? 'text-stone-300' : 'text-stone-400'}`}>{thread.time}</span>
                  </button>
                  <div className={`mt-1 flex gap-1 px-1 opacity-100 transition-opacity xl:opacity-0 xl:group-hover:opacity-100 ${deleteConfirmId === thread.id ? 'xl:opacity-100' : ''}`}>
                    <button disabled={isMutatingThread} onClick={() => startRenameThread(thread)} className={`rounded-full px-2.5 py-1 text-xs font-semibold ${thread.active ? 'bg-white/10 text-white' : 'bg-white text-stone-600 ring-1 ring-stone-200'} disabled:opacity-45`}>重命名</button>
                    <button disabled={isMutatingThread} onClick={() => handleDeleteThread(thread.id)} className={`rounded-full px-2.5 py-1 text-xs font-semibold ${deleteConfirmId === thread.id ? 'bg-red-600 text-white' : thread.active ? 'bg-white/10 text-white' : 'bg-white text-stone-600 ring-1 ring-stone-200'} disabled:opacity-45`}>
                      {deleteConfirmId === thread.id ? '确认删除' : '删除'}
                    </button>
                  </div>
                </>
              )}
            </div>
          )) : (
            <div className="rounded-2xl border border-dashed border-stone-200 p-4 text-sm leading-6 text-stone-500">
              {searchTerm ? '没有匹配的对话。' : '还没有对话。你可以直接在右侧输入第一句话，Agent 会自动创建对话并读取目标、日志和 Today。'}
            </div>
          )}
        </div>
        <div className="mt-4 rounded-2xl border border-stone-200 bg-stone-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">能力边界</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {['Goals', 'Logs', 'Today', 'Memory'].map((item) => (
              <span key={item} className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-stone-600 ring-1 ring-stone-200">{item}</span>
            ))}
          </div>
          {pendingActions.length ? <p className="mt-3 text-xs leading-5 text-amber-700">{pendingActions.length} 个动作等待确认。</p> : null}
        </div>
      </aside>

      <main className="flex min-h-0 flex-col rounded-[28px] border border-stone-200 bg-[#fbfaf7] shadow-sm xl:rounded-[30px]">
        <header className="shrink-0 border-b border-stone-200 bg-white/90 px-4 py-3 backdrop-blur md:px-6">
          <div className="mx-auto flex max-w-[920px] flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-400">Goal Mate Agent</p>
              <h2 className="mt-1 truncate text-lg font-semibold text-stone-950">{visibleThreads.find((thread: any) => thread.active)?.title || '开始一段 Agent 对话'}</h2>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-stone-500">
              <span className={`rounded-full px-3 py-1 ${modelConfigured ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>{modelConfigured ? '模型已配置' : '缺模型'}</span>
              <span className="rounded-full bg-stone-100 px-3 py-1">读目标</span>
              <span className="rounded-full bg-stone-100 px-3 py-1">读日志</span>
              <span className="rounded-full bg-stone-100 px-3 py-1">可执行需确认</span>
              {pendingActions.length ? <span className="animate-pulse rounded-full bg-amber-100 px-3 py-1 text-amber-800">{pendingActions.length} 个待确认</span> : null}
              {activeThreadId ? (
                <button disabled={isMutatingThread || !visibleMessages.length} onClick={handleClearCurrentThread} className={`rounded-full px-3 py-1 ring-1 disabled:cursor-not-allowed disabled:opacity-45 ${clearConfirm ? 'bg-red-600 text-white ring-red-600' : 'bg-white text-stone-600 ring-stone-200 hover:text-stone-950'}`}>
                  {clearConfirm ? '确认清空' : '清空当前对话'}
                </button>
              ) : null}
            </div>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-6">
          <div className="mx-auto max-w-[920px] space-y-5">
            {conversationError ? (
              <div className="flex min-h-[360px] items-center justify-center">
                <div className="max-w-xl rounded-[28px] border border-red-200 bg-white p-8 text-center shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-red-600">对话暂时不可用</p>
                  <h3 className="mt-3 text-2xl font-semibold text-stone-950">暂时无法读取这段对话。</h3>
                  <p className="mt-3 text-sm leading-6 text-stone-600">{conversationError.message}</p>
                  <button
                    onClick={() => {
                      threadsQuery.refetch()
                      messagesQuery.refetch()
                      toolActionsQuery.refetch()
                    }}
                    className="mt-5 rounded-full bg-stone-950 px-4 py-2 text-xs font-semibold text-white"
                  >
                    重新读取
                  </button>
                </div>
              </div>
            ) : messagesQuery.isLoading || threadsQuery.isLoading ? (
              <div className="flex min-h-[360px] items-center justify-center">
                <div className="max-w-xl rounded-[28px] border border-stone-200 bg-white p-8 text-center shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-400">Loading</p>
                  <h3 className="mt-3 text-2xl font-semibold text-stone-950">正在读取对话上下文</h3>
                  <p className="mt-3 text-sm leading-6 text-stone-500">正在加载历史消息、工具动作和待确认事项。</p>
                </div>
              </div>
            ) : visibleMessages.length ? visibleMessages.map((message: any, index: number) => {
              const role = String(message.role || '').toLowerCase()
              const output = parseStructuredOutput(message)
              const actionId = output?.toolActionId || output?.confirmedActionId || output?.rejectedActionId
              const action = actionId ? actionById.get(actionId) : undefined
              const optimistic = Boolean(message.optimistic)
              return (
                <div key={message.id || index} className={`flex ${role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`group relative max-w-[82%] rounded-[24px] px-5 py-4 text-sm leading-7 shadow-sm ${role === 'user' ? 'bg-stone-950 text-white' : 'border border-stone-200 bg-white text-stone-700'} ${optimistic ? 'opacity-70' : ''}`}>
                    <div className="mb-1 flex items-center justify-between gap-3">
                      <div className={`text-[11px] font-semibold uppercase tracking-[0.16em] ${role === 'user' ? 'text-white/50' : 'text-stone-400'}`}>{role === 'user' ? 'You' : 'Agent'}</div>
                      <button onClick={() => copyMessage(message)} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold opacity-0 transition-opacity group-hover:opacity-100 ${role === 'user' ? 'bg-white/10 text-white/70' : 'bg-stone-100 text-stone-500'}`}>
                        {copiedMessageId === message.id ? '已复制' : '复制'}
                      </button>
                    </div>
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
            }) : (
              <div className="flex min-h-[360px] items-center justify-center">
                <div className="max-w-xl rounded-[28px] border border-dashed border-stone-200 bg-white p-8 text-center shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-400">First message</p>
                  <h3 className="mt-3 text-2xl font-semibold text-stone-950">{modelConfigured ? '先说你想达到什么结果' : '基础控制可用，完整理解需要模型'}</h3>
                  <p className="mt-3 text-sm leading-6 text-stone-500">
                    {modelConfigured
                      ? '第一次使用时，不需要研究 OKR、甘特图或日志。直接告诉 Agent：结果、截止时间、当前情况。它会把这些转成目标结构和今天的下一步。'
                      : '当前还没有模型 API Key。你仍可直接暂停提醒、反馈“做完了/没做”或读取当前任务；需要理解复杂目标和自由对话时再去 Settings 配置模型。'}
                  </p>
                  <div className="mt-5 flex flex-wrap justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleUsePrompt(quickPrompts[0].prompt)}
                      className="rounded-full bg-stone-950 px-4 py-2 text-xs font-semibold text-white"
                    >
                      填写目标模板
                    </button>
                    {!modelConfigured && <a href="/dashboard/settings#settings-model" className="rounded-full bg-stone-100 px-4 py-2 text-xs font-semibold text-stone-700">配置模型</a>}
                  </div>
                </div>
              </div>
            )}
            {isSending && (
              <div className="flex justify-start">
                <div className="rounded-[24px] border border-stone-200 bg-white px-5 py-4 text-sm leading-7 text-stone-600 shadow-sm">
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-400">Agent</div>
                  正在读取上下文并处理...
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        <footer className="shrink-0 border-t border-stone-200 bg-white px-4 py-4 md:px-6 md:py-5">
          <div className="mx-auto max-w-[920px] rounded-[28px] border border-stone-200 bg-stone-50 p-3 shadow-sm">
            <div className="mb-3 flex flex-wrap gap-2">
              {quickPrompts.map((item) => (
                <button
                  key={item.label}
                  disabled={isSending || (!modelConfigured && item.label !== '建立目标')}
                  onClick={() => handleUsePrompt(item.prompt)}
                  className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-stone-600 ring-1 ring-stone-200 hover:bg-stone-950 hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="flex items-end gap-3">
              <textarea
              ref={textareaRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  handleSend()
                }
              }}
                placeholder="直接说：我现在的情况、完成了什么、哪里卡住、希望系统怎么帮你。Enter 发送，Shift+Enter 换行。"
                className="max-h-36 min-h-[64px] flex-1 resize-none bg-transparent px-3 py-2 text-sm leading-6 outline-none"
              />
              {!modelConfigured && <a href="/dashboard/settings#settings-model" className="rounded-full bg-stone-100 px-4 py-3 text-sm font-semibold text-stone-700">配置模型</a>}
              <button disabled={!draft.trim() || isSending || !modelConfigured} onClick={handleSend} className="rounded-full bg-stone-950 px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45">
                {isSending ? '处理中' : modelConfigured ? '发送' : '先配置'}
              </button>
            </div>
          </div>
        </footer>
      </main>
    </div>
  )
}
