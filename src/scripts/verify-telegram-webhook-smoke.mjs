const baseUrl = process.env.GOAL_MATE_BASE_URL || 'http://127.0.0.1:3000'
const secret = process.env.TELEGRAM_WEBHOOK_SECRET || ''

const update = {
  update_id: Number(process.env.TELEGRAM_TEST_UPDATE_ID || Date.now()),
  message: {
    message_id: 1,
    date: Math.floor(Date.now() / 1000),
    text: process.env.TELEGRAM_TEST_TEXT || 'Telegram webhook smoke test',
    chat: {
      id: Number(process.env.TELEGRAM_TEST_CHAT_ID || 100001),
      type: 'private',
      username: 'goal_mate_smoke',
      first_name: 'GoalMate',
    },
    from: {
      id: Number(process.env.TELEGRAM_TEST_CHAT_ID || 100001),
      is_bot: false,
      first_name: 'GoalMate',
      username: 'goal_mate_smoke',
    },
  },
}

const response = await fetch(`${baseUrl}/api/integrations/telegram/webhook`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    ...(secret ? { 'x-telegram-bot-api-secret-token': secret } : {}),
  },
  body: JSON.stringify(update),
})
const text = await response.text()
console.log(text)
process.exit(response.ok ? 0 : 1)
