export type TelegramChat = {
  id: number | string
  type?: string
  title?: string
  username?: string
  first_name?: string
  last_name?: string
}

export type TelegramMessage = {
  message_id: number
  date?: number
  text?: string
  chat: TelegramChat
  from?: {
    id: number
    is_bot?: boolean
    first_name?: string
    last_name?: string
    username?: string
  }
}

export type TelegramUpdate = {
  update_id: number
  message?: TelegramMessage
  edited_message?: TelegramMessage
}

export function getTelegramBotToken() {
  return process.env.TELEGRAM_BOT_TOKEN || ''
}

export function getTelegramApiBase() {
  return (process.env.TELEGRAM_BOT_API_BASE || 'https://api.telegram.org').replace(/\/+$/, '')
}

export function getTelegramWebhookSecret() {
  return process.env.TELEGRAM_WEBHOOK_SECRET || ''
}

export function getTelegramAllowedChatIds() {
  return new Set(
    (process.env.TELEGRAM_ALLOWED_CHAT_IDS || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  )
}

export function isTelegramChatAllowed(chatId: string) {
  const allowed = getTelegramAllowedChatIds()
  return allowed.size === 0 || allowed.has(chatId)
}

async function telegramRequest(method: string, body: Record<string, unknown>) {
  const token = getTelegramBotToken()
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not configured')

  const response = await fetch(`${getTelegramApiBase()}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  let data: any = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }

  if (!response.ok || data?.ok === false) {
    throw new Error(`Telegram ${method} failed: ${response.status} ${text.slice(0, 300)}`)
  }

  return data
}

export async function sendTelegramMessage(chatId: string, text: string) {
  return telegramRequest('sendMessage', {
    chat_id: chatId,
    text: text.length > 3900 ? `${text.slice(0, 3900)}...` : text,
    disable_web_page_preview: true,
  })
}

export async function setTelegramWebhook(url: string) {
  return telegramRequest('setWebhook', {
    url,
    secret_token: getTelegramWebhookSecret() || undefined,
    allowed_updates: ['message'],
  })
}

export async function deleteTelegramWebhook() {
  return telegramRequest('deleteWebhook', {})
}
