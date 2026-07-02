import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '../../../validator'
import { prisma } from '@/lib/db'
import { generateAssistantReply } from '@/lib/agent-runtime'
import {
  deleteTelegramWebhook,
  getTelegramBotToken,
  getTelegramWebhookSecret,
  isTelegramChatAllowed,
  sendTelegramMessage,
  setTelegramWebhook,
  type TelegramUpdate,
} from '@/lib/telegram-bot'
import { getCurrentUserId, unauthorized } from '../../../context'

const setupWebhookSchema = z.object({ url: z.string().url() })

function extractTextMessage(update: TelegramUpdate) {
  const message = update.message || update.edited_message
  if (!message?.chat?.id || !message.text?.trim()) return null
  return {
    message,
    chatId: String(message.chat.id),
    text: message.text.trim(),
  }
}

async function resolveTelegramUser(chatId: string, update: TelegramUpdate) {
  const existingBinding = await prisma.telegramChatBinding.findUnique({ where: { chatId } })
  if (existingBinding?.status === 'ENABLED') return existingBinding.userId

  const defaultEmail = process.env.TELEGRAM_DEFAULT_USER_EMAIL || 'demo@goalmate.local'
  const user = await prisma.user.findUnique({ where: { email: defaultEmail } })
  if (!user) return null

  const message = update.message || update.edited_message
  const chat = message?.chat
  await prisma.telegramChatBinding.upsert({
    where: { chatId },
    update: {
      userId: user.id,
      username: chat?.username || message?.from?.username,
      firstName: chat?.first_name || message?.from?.first_name,
      lastName: chat?.last_name || message?.from?.last_name,
      title: chat?.title,
      status: 'ENABLED',
    },
    create: {
      userId: user.id,
      chatId,
      username: chat?.username || message?.from?.username,
      firstName: chat?.first_name || message?.from?.first_name,
      lastName: chat?.last_name || message?.from?.last_name,
      title: chat?.title,
      status: 'ENABLED',
    },
  })

  await prisma.integrationAccount.upsert({
    where: { id: `telegram-${user.id}-${chatId}` },
    update: {
      accountLabel: chat?.username || chat?.title || chatId,
      status: 'ENABLED',
      permissions: { chatId, canReceiveMessage: true, canSendMessage: true },
    },
    create: {
      id: `telegram-${user.id}-${chatId}`,
      userId: user.id,
      provider: 'telegram',
      accountLabel: chat?.username || chat?.title || chatId,
      status: 'ENABLED',
      permissions: { chatId, canReceiveMessage: true, canSendMessage: true },
    },
  })

  return user.id
}

async function findOrCreateTelegramThread(userId: string, chatId: string) {
  const title = `Telegram ${chatId}`
  const existing = await prisma.agentThread.findFirst({ where: { userId, title, status: 'ACTIVE' } })
  if (existing) return existing

  const goal = await prisma.goal.findFirst({ where: { userId, isCurrentFocus: true } })
  return prisma.agentThread.create({ data: { userId, goalId: goal?.id, title } })
}

async function handleTelegramUpdate(update: TelegramUpdate) {
  const existingEvent = await prisma.telegramUpdateEvent.findUnique({ where: { updateId: update.update_id } })
  if (existingEvent) {
    return { ignored: true, reason: 'duplicate-update', updateId: update.update_id }
  }

  const extracted = extractTextMessage(update)
  if (!extracted) {
    await prisma.telegramUpdateEvent.create({
      data: {
        chatId: 'unknown',
        updateId: update.update_id,
        payload: update as any,
        status: 'IGNORED',
      },
    })
    return { ignored: true, reason: 'non-text-message' }
  }

  const { chatId, text } = extracted
  if (!isTelegramChatAllowed(chatId)) {
    await prisma.telegramUpdateEvent.create({
      data: {
        chatId,
        updateId: update.update_id,
        messageText: text,
        payload: update as any,
        status: 'IGNORED',
      },
    })
    return { ignored: true, reason: 'chat-not-allowed', chatId }
  }

  const userId = await resolveTelegramUser(chatId, update)
  if (!userId) {
    await sendTelegramMessage(chatId, 'Telegram Bot 尚未绑定 Goal Mate 用户。请先配置 TELEGRAM_DEFAULT_USER_EMAIL。')
    await prisma.telegramUpdateEvent.create({
      data: {
        chatId,
        updateId: update.update_id,
        messageText: text,
        payload: update as any,
        status: 'FAILED',
      },
    })
    return { ignored: true, reason: 'user-not-found', chatId }
  }

  const thread = await findOrCreateTelegramThread(userId, chatId)
  const userMessage = await prisma.agentMessage.create({
    data: { userId, threadId: thread.id, role: 'USER', content: text },
  })
  const reply = await generateAssistantReply(userId, thread.id, text)
  const assistantMessage = await prisma.agentMessage.create({
    data: {
      userId,
      threadId: thread.id,
      role: 'ASSISTANT',
      content: reply.content,
      structuredOutputType: 'telegram_reply',
      structuredOutput: { updateId: update.update_id, chatId, model: reply.modelName, ok: reply.ok },
    },
  })
  await prisma.agentThread.update({ where: { id: thread.id }, data: { updatedAt: new Date() } })
  const telegramResponse = await sendTelegramMessage(chatId, reply.content)

  await prisma.telegramUpdateEvent.upsert({
    where: { updateId: update.update_id },
    update: {
      userId,
      chatId,
      messageText: text,
      payload: update as any,
      status: 'REPLIED',
      agentThreadId: thread.id,
      agentMessageId: assistantMessage.id,
      replyMessageId: String(telegramResponse?.result?.message_id || ''),
    },
    create: {
      userId,
      chatId,
      updateId: update.update_id,
      messageText: text,
      payload: update as any,
      status: 'REPLIED',
      agentThreadId: thread.id,
      agentMessageId: assistantMessage.id,
      replyMessageId: String(telegramResponse?.result?.message_id || ''),
    },
  })

  return { replied: true, chatId, threadId: thread.id, userMessageId: userMessage.id, assistantMessageId: assistantMessage.id }
}

const app = new Hono()
  .basePath('/integrations/telegram')
  .get('/status', async (c) => {
    const userId = await getCurrentUserId(c)
    if (!userId) return unauthorized(c)

    const bindings = await prisma.telegramChatBinding.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' } })
    return c.json({
      data: {
        configured: Boolean(getTelegramBotToken()),
        webhookSecretConfigured: Boolean(getTelegramWebhookSecret()),
        bindings,
      },
    })
  })
  .post('/webhook', async (c) => {
    const secret = getTelegramWebhookSecret()
    if (secret && c.req.header('x-telegram-bot-api-secret-token') !== secret) {
      return c.json({ ok: false, error: 'invalid-secret-token' }, 401)
    }

    const update = await c.req.json<TelegramUpdate>()
    const result = await handleTelegramUpdate(update)
    return c.json({ ok: true, result })
  })
  .post('/webhook/setup', zValidator('json', setupWebhookSchema), async (c) => {
    const userId = await getCurrentUserId(c)
    if (!userId) return unauthorized(c)

    const result = await setTelegramWebhook(c.req.valid('json').url)
    return c.json({ data: result })
  })
  .post('/webhook/delete', async (c) => {
    const userId = await getCurrentUserId(c)
    if (!userId) return unauthorized(c)

    const result = await deleteTelegramWebhook()
    return c.json({ data: result })
  })

export default app
