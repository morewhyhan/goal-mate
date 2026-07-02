import { handleError } from './error'
import { Hono } from 'hono'
import settingsRoute from './routes/settings'
import modelsRoute from './routes/models'
import logsRoute from './routes/logs'
import goalsRoute from './routes/goals'
import todayRoute from './routes/today'
import agentRoute from './routes/agent'
import reviewsRoute from './routes/reviews'
import telegramRoute from './routes/integrations/telegram'
import { auth } from '@/lib/auth'

const app = new Hono().basePath('/api')

app.onError(handleError)

app.use('/auth/*', async (c, next) => {
  if (c.req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Credentials': 'true',
      },
    })
  }
  await next()
})

app.all('/auth/*', async (c) => {
  const response = await auth.handler(c.req.raw)
  if (response instanceof Response) {
    const newHeaders = new Headers(response.headers)
    newHeaders.set('Access-Control-Allow-Origin', '*')
    newHeaders.set('Access-Control-Allow-Credentials', 'true')
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    })
  }
  return response as any
})

app.get('/health', (c) => {
  return c.json({ status: 'ok', product: 'goal-mate', timestamp: new Date().toISOString() })
})

const routes = app
  .route('/', settingsRoute)
  .route('/', modelsRoute)
  .route('/', logsRoute)
  .route('/', goalsRoute)
  .route('/', todayRoute)
  .route('/', agentRoute)
  .route('/', reviewsRoute)
  .route('/', telegramRoute)

export default app

export type AppType = typeof routes
