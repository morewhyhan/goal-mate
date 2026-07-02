import { client } from '@/lib/api-client'
import { InferRequestType, InferResponseType } from 'hono/client'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

const $generate = client.api.reviews.generate.$post
type GenerateReviewRequest = InferRequestType<typeof $generate>['json']
type GenerateReviewResponse = any

export function useGenerateReview() {
  const queryClient = useQueryClient()
  return useMutation<GenerateReviewResponse, Error, GenerateReviewRequest>({
    mutationFn: async (json) => (await $generate({ json })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['logs'] })
      queryClient.invalidateQueries({ queryKey: ['goals'] })
      toast.success('复盘草案已生成')
    },
    onError: (error) => toast.error(error.message || '复盘生成失败'),
  })
}
