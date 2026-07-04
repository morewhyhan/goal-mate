import { client } from '@/lib/api-client'
import { InferRequestType, InferResponseType } from 'hono/client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

const $threads = client.api.agent.threads.$get
type ThreadsResponse = any

const $createThread = client.api.agent.threads.$post
type CreateThreadRequest = InferRequestType<typeof $createThread>['json']
type CreateThreadResponse = any

const $updateThread = client.api.agent.threads[':id'].$patch
type UpdateThreadRequest = InferRequestType<typeof $updateThread>['json'] & { id: string }
type UpdateThreadResponse = any

const $deleteThread = client.api.agent.threads[':id'].$delete
type DeleteThreadResponse = any

const $clearThreadMessages = client.api.agent.threads[':id'].messages.$delete
type ClearThreadMessagesResponse = any

const $messages = client.api.agent.threads[':id'].messages.$get
type MessagesResponse = any

const $sendMessage = client.api.agent.threads[':id'].messages.$post
type SendMessageRequest = InferRequestType<typeof $sendMessage>['json'] & { threadId: string }
type SendMessageResponse = any

const $toolActions = client.api.agent.tools.actions.$get
type AgentToolActionsResponse = any

const $confirmToolAction = client.api.agent.tools.actions[':id'].confirm.$post
type ConfirmToolActionRequest = { id: string }
type ConfirmToolActionResponse = any

const $rejectToolAction = client.api.agent.tools.actions[':id'].reject.$post
type RejectToolActionRequest = { id: string; reason?: string }
type RejectToolActionResponse = any

export function useAgentThreads() {
  return useQuery<ThreadsResponse, Error>({
    queryKey: ['agent', 'threads'],
    queryFn: async () => (await $threads()).json(),
  })
}

export function useCreateAgentThread() {
  const queryClient = useQueryClient()
  return useMutation<CreateThreadResponse, Error, CreateThreadRequest>({
    mutationFn: async (json) => (await $createThread({ json })).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agent', 'threads'] }),
    onError: (error) => toast.error(error.message || '创建对话失败'),
  })
}

export function useUpdateAgentThread() {
  const queryClient = useQueryClient()
  return useMutation<UpdateThreadResponse, Error, UpdateThreadRequest>({
    mutationFn: async ({ id, ...json }) => (await $updateThread({ param: { id }, json })).json(),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['agent', 'threads'] })
      queryClient.invalidateQueries({ queryKey: ['agent', 'messages', variables.id] })
    },
    onError: (error) => toast.error(error.message || '对话更新失败'),
  })
}

export function useDeleteAgentThread() {
  const queryClient = useQueryClient()
  return useMutation<DeleteThreadResponse, Error, string>({
    mutationFn: async (id) => (await $deleteThread({ param: { id } })).json(),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['agent', 'threads'] })
      queryClient.removeQueries({ queryKey: ['agent', 'messages', id] })
      toast.success('对话已删除')
    },
    onError: (error) => toast.error(error.message || '对话删除失败'),
  })
}

export function useClearAgentThreadMessages() {
  const queryClient = useQueryClient()
  return useMutation<ClearThreadMessagesResponse, Error, string>({
    mutationFn: async (id) => (await $clearThreadMessages({ param: { id } })).json(),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['agent', 'threads'] })
      queryClient.invalidateQueries({ queryKey: ['agent', 'messages', id] })
      toast.success('当前对话已清空')
    },
    onError: (error) => toast.error(error.message || '对话清空失败'),
  })
}

export function useAgentMessages(threadId?: string) {
  return useQuery<MessagesResponse, Error>({
    queryKey: ['agent', 'messages', threadId],
    enabled: !!threadId,
    queryFn: async () => (await $messages({ param: { id: threadId! } })).json(),
  })
}

export function useSendAgentMessage() {
  const queryClient = useQueryClient()
  return useMutation<SendMessageResponse, Error, SendMessageRequest>({
    mutationFn: async ({ threadId, ...json }) => (await $sendMessage({ param: { id: threadId }, json })).json(),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['agent', 'threads'] })
      queryClient.invalidateQueries({ queryKey: ['agent', 'messages', variables.threadId] })
      queryClient.invalidateQueries({ queryKey: ['agent', 'tool-actions'] })
    },
    onError: (error) => toast.error(error.message || '消息发送失败'),
  })
}

export function useAgentToolActions() {
  return useQuery<AgentToolActionsResponse, Error>({
    queryKey: ['agent', 'tool-actions'],
    queryFn: async () => (await $toolActions()).json(),
  })
}

export function useConfirmAgentToolAction(threadId?: string) {
  const queryClient = useQueryClient()
  return useMutation<ConfirmToolActionResponse, Error, ConfirmToolActionRequest>({
    mutationFn: async ({ id }) => (await $confirmToolAction({ param: { id } })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent', 'tool-actions'] })
      queryClient.invalidateQueries({ queryKey: ['agent', 'threads'] })
      if (threadId) queryClient.invalidateQueries({ queryKey: ['agent', 'messages', threadId] })
      toast.success('工具动作已确认')
    },
    onError: (error) => toast.error(error.message || '工具动作确认失败'),
  })
}

export function useRejectAgentToolAction(threadId?: string) {
  const queryClient = useQueryClient()
  return useMutation<RejectToolActionResponse, Error, RejectToolActionRequest>({
    mutationFn: async ({ id, reason }) => (await $rejectToolAction({ param: { id }, json: { reason } })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent', 'tool-actions'] })
      queryClient.invalidateQueries({ queryKey: ['agent', 'threads'] })
      if (threadId) queryClient.invalidateQueries({ queryKey: ['agent', 'messages', threadId] })
      toast.success('工具动作已取消')
    },
    onError: (error) => toast.error(error.message || '工具动作取消失败'),
  })
}
