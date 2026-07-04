import { client } from '@/lib/api-client'
import { InferRequestType, InferResponseType } from 'hono/client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

const $get = client.api.today.$get
type TodayResponse = any

const $checkin = client.api.today.checkin.$post
type CheckinRequest = InferRequestType<typeof $checkin>['json']
type CheckinResponse = any

const $executeTool = client.api.agent.tools.execute.$post
type GenerateTodayActionResponse = any

export function useToday() {
  return useQuery<TodayResponse, Error>({
    queryKey: ['today'],
    queryFn: async () => (await $get()).json(),
  })
}

export function useGenerateTodayAction() {
  const queryClient = useQueryClient()
  return useMutation<GenerateTodayActionResponse, Error>({
    mutationFn: async () => (await $executeTool({ json: { toolName: 'today.get', input: {}, confirmed: true } })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['today'] })
      queryClient.invalidateQueries({ queryKey: ['goals'] })
      toast.success('今日行动已生成')
    },
    onError: (error) => toast.error(error.message || '今日行动生成失败'),
  })
}

export function useSubmitCheckin() {
  const queryClient = useQueryClient()
  return useMutation<CheckinResponse, Error, CheckinRequest>({
    mutationFn: async (json) => (await $checkin({ json })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['today'] })
      queryClient.invalidateQueries({ queryKey: ['goals'] })
      queryClient.invalidateQueries({ queryKey: ['logs'] })
      toast.success('反馈已记录')
    },
    onError: (error) => toast.error(error.message || '反馈保存失败'),
  })
}
