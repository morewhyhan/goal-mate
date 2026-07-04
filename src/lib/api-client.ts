import { AppType } from '@/server/api'
import { hc } from 'hono/client'
import ky from 'ky'

const serverBaseUrl =
  process.env.NEXT_PUBLIC_APP_URL ||
  process.env.NEXT_PUBLIC_BETTER_AUTH_URL ||
  (process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : 'http://localhost:3000')

const baseUrl = typeof window === 'undefined' ? serverBaseUrl : window.location.origin

export const fetch = ky.extend({
  credentials: 'include' as const,
  hooks: {
    afterResponse: [
      async (_, __, response: Response) => {
        if (response.ok) {
          return response
        } else {
          throw await response.json()
        }
      },
    ],
  },
})

export const client = hc<AppType>(baseUrl, {
  fetch: fetch,
})
