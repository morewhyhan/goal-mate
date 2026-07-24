import { client } from '@/lib/api-client'
import { InferRequestType, InferResponseType } from 'hono/client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { parseApiResponse } from '@/lib/api-response'

const $tree = client.api.logs.tree.$get
type LogTreeResponse = any

const $get = client.api.logs[':id'].$get
type LogResponse = any

const $put = client.api.logs[':id'].$put
type UpdateLogRequest = InferRequestType<typeof $put>['json'] & { id: string }
type UpdateLogResponse = any

const $patch = client.api.logs.patch.$post
type PatchLogRequest = InferRequestType<typeof $patch>['json']
type PatchLogResponse = any

export function useLogTree() {
  return useQuery<LogTreeResponse, Error>({
    queryKey: ['logs', 'tree'],
    queryFn: async () => parseApiResponse(await $tree()),
  })
}

export function useLog(id?: string) {
  return useQuery<LogResponse, Error>({
    queryKey: ['log', id],
    enabled: !!id,
    queryFn: async () => parseApiResponse(await $get({ param: { id: id! } })),
  })
}

export function useUpdateLog() {
  const queryClient = useQueryClient()
  return useMutation<UpdateLogResponse, Error, UpdateLogRequest>({
    mutationFn: async ({ id, ...json }) => parseApiResponse(await $put({ param: { id }, json })),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['logs'] })
      queryClient.invalidateQueries({ queryKey: ['log', variables.id] })
      toast.success('日志已保存')
    },
    onError: (error) => toast.error(error.message || '日志保存失败'),
  })
}

export function usePatchLog() {
  const queryClient = useQueryClient()
  return useMutation<PatchLogResponse, Error, PatchLogRequest>({
    mutationFn: async (json) => parseApiResponse(await $patch({ json })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['logs'] })
      toast.success('日志已更新')
    },
    onError: (error) => toast.error(error.message || '日志更新失败'),
  })
}
