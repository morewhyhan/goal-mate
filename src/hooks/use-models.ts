import { client } from '@/lib/api-client'
import { InferRequestType, InferResponseType } from 'hono/client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { parseApiResponse } from '@/lib/api-response'

const $get = client.api.models.$get
type ModelsResponse = any

const $post = client.api.models.$post
type CreateModelRequest = InferRequestType<typeof $post>['json']
type CreateModelResponse = any

const $put = client.api.models[':id'].$put
type UpdateModelRequest = InferRequestType<typeof $put>['json'] & { id: string }
type UpdateModelResponse = any

export function useModels() {
  return useQuery<ModelsResponse, Error>({
    queryKey: ['models'],
    queryFn: async () => parseApiResponse(await $get()),
  })
}

export function useCreateModel() {
  const queryClient = useQueryClient()
  return useMutation<CreateModelResponse, Error, CreateModelRequest>({
    mutationFn: async (json) => parseApiResponse(await $post({ json })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['models'] })
      queryClient.invalidateQueries({ queryKey: ['settings-control-center'] })
      toast.success('模型配置已创建')
    },
    onError: (error) => toast.error(error.message || '模型配置创建失败'),
  })
}

export function useUpdateModel() {
  const queryClient = useQueryClient()
  return useMutation<UpdateModelResponse, Error, UpdateModelRequest>({
    mutationFn: async ({ id, ...json }) => parseApiResponse(await $put({ param: { id }, json })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['models'] })
      queryClient.invalidateQueries({ queryKey: ['settings-control-center'] })
      toast.success('模型配置已保存')
    },
    onError: (error) => toast.error(error.message || '模型配置保存失败'),
  })
}
