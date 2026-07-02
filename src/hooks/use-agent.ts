import { client } from '@/lib/api-client'
import { InferRequestType, InferResponseType } from 'hono/client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

const $threads = client.api.agent.threads.$get
type ThreadsResponse = any

const $createThread = client.api.agent.threads.$post
type CreateThreadRequest = InferRequestType<typeof $createThread>['json']
type CreateThreadResponse = any

const $messages = client.api.agent.threads[':id'].messages.$get
type MessagesResponse = any

const $sendMessage = client.api.agent.threads[':id'].messages.$post
type SendMessageRequest = InferRequestType<typeof $sendMessage>['json'] & { threadId: string }
type SendMessageResponse = any

const $confirm = client.api.agent['structured-output'].confirm.$post
type ConfirmStructuredOutputRequest = InferRequestType<typeof $confirm>['json']
type ConfirmStructuredOutputResponse = any

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
    },
    onError: (error) => toast.error(error.message || '消息发送失败'),
  })
}

export function useConfirmStructuredOutput() {
  return useMutation<ConfirmStructuredOutputResponse, Error, ConfirmStructuredOutputRequest>({
    mutationFn: async (json) => (await $confirm({ json })).json(),
    onSuccess: () => toast.success('结构化输出已确认'),
    onError: (error) => toast.error(error.message || '确认失败'),
  })
}
