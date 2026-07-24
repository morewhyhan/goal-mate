import { client } from '@/lib/api-client'
import { InferRequestType, InferResponseType } from 'hono/client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { parseApiResponse } from '@/lib/api-response'

const $get = client.api.goals.$get
type GoalsResponse = any

const $getOne = client.api.goals[':id'].$get
type GoalResponse = any

const $draft = client.api.goals['reasoning-card'].draft.$post
type CreateReasoningDraftRequest = InferRequestType<typeof $draft>['json']
type CreateReasoningDraftResponse = any

const $confirm = client.api.goals['reasoning-card'][':id'].confirm.$post
type ConfirmReasoningCardResponse = any

export function useGoals() {
  return useQuery<GoalsResponse, Error>({
    queryKey: ['goals'],
    queryFn: async () => parseApiResponse(await $get()),
  })
}

export function useGoal(id?: string) {
  return useQuery<GoalResponse, Error>({
    queryKey: ['goal', id],
    enabled: !!id,
    queryFn: async () => parseApiResponse(await $getOne({ param: { id: id! } })),
  })
}

export function useCreateReasoningDraft() {
  const queryClient = useQueryClient()
  return useMutation<CreateReasoningDraftResponse, Error, CreateReasoningDraftRequest>({
    mutationFn: async (json) => parseApiResponse(await $draft({ json })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['goals'] })
      toast.success('目标推理卡草案已生成')
    },
    onError: (error) => toast.error(error.message || '目标推理卡生成失败'),
  })
}

export function useConfirmReasoningCard() {
  const queryClient = useQueryClient()
  return useMutation<ConfirmReasoningCardResponse, Error, string>({
    mutationFn: async (id) => parseApiResponse(await $confirm({ param: { id } })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['goals'] })
      toast.success('目标推理卡已确认')
    },
    onError: (error) => toast.error(error.message || '目标推理卡确认失败'),
  })
}
