import { client } from '@/lib/api-client'
import { InferRequestType, InferResponseType } from 'hono/client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

const $get = client.api.settings.$get
type SettingsResponse = any

const $put = client.api.settings.$put
type UpdateSettingsRequest = InferRequestType<typeof $put>['json']
type UpdateSettingsResponse = any

const $controlCenter = client.api.settings['control-center'].$get
type SettingsControlCenterResponse = any

const $reminders = client.api.settings.reminders.$put
type UpdateReminderRulesRequest = InferRequestType<typeof $reminders>['json']
type UpdateReminderRulesResponse = any

const $test = client.api.settings.models.test.$post
type TestModelResponse = any

const $export = client.api.settings.export.$get
type ExportResponse = any

export function useSettings() {
  return useQuery<SettingsResponse, Error>({
    queryKey: ['settings'],
    queryFn: async () => (await $get()).json(),
  })
}

export function useSettingsControlCenter() {
  return useQuery<SettingsControlCenterResponse, Error>({
    queryKey: ['settings-control-center'],
    queryFn: async () => (await $controlCenter()).json(),
  })
}

export function useUpdateSettings() {
  const queryClient = useQueryClient()
  return useMutation<UpdateSettingsResponse, Error, UpdateSettingsRequest>({
    mutationFn: async (json) => (await $put({ json })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      queryClient.invalidateQueries({ queryKey: ['settings-control-center'] })
      toast.success('设置已保存')
    },
    onError: (error) => toast.error(error.message || '设置保存失败'),
  })
}

export function useUpdateReminderRules() {
  const queryClient = useQueryClient()
  return useMutation<UpdateReminderRulesResponse, Error, UpdateReminderRulesRequest>({
    mutationFn: async (json) => (await $reminders({ json })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings-control-center'] })
      toast.success('提醒规则已保存')
    },
    onError: (error) => toast.error(error.message || '提醒规则保存失败'),
  })
}

export function useTestModelConnection() {
  return useMutation<TestModelResponse, Error>({
    mutationFn: async () => (await $test()).json(),
    onSuccess: () => toast.success('模型连接测试已提交'),
    onError: (error) => toast.error(error.message || '模型连接测试失败'),
  })
}

export function useExportUserData() {
  return useMutation<ExportResponse, Error>({
    mutationFn: async () => (await $export()).json(),
    onSuccess: () => toast.success('导出数据已生成，密钥已脱敏'),
    onError: (error) => toast.error(error.message || '数据导出失败'),
  })
}
