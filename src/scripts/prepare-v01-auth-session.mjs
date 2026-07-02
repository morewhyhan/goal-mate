import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const baseUrl = process.env.GOAL_MATE_BASE_URL || 'http://127.0.0.1:3000'
const authOrigin = process.env.BETTER_AUTH_URL || 'http://localhost:3000'
const sourceEmail = process.env.GOAL_MATE_SEED_SOURCE_EMAIL || 'demo@goalmate.local'
const email = process.env.GOAL_MATE_ACCEPTANCE_EMAIL || 'acceptance@goalmate.local'
const password = process.env.GOAL_MATE_ACCEPTANCE_PASSWORD || 'acceptance-pass-123'
const name = process.env.GOAL_MATE_ACCEPTANCE_NAME || 'Acceptance User'

async function authRequest(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: authOrigin,
    },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = text
  }
  return { response, json, text }
}

function extractCookie(response) {
  const setCookie = response.headers.get('set-cookie') || ''
  const match = setCookie.match(/hononext\.session_token=[^;]+/)
  if (!match) throw new Error(`Missing hononext.session_token in Set-Cookie: ${setCookie}`)
  return match[0]
}

async function signUpOrSignIn() {
  const signUp = await authRequest('/api/auth/sign-up/email', { email, password, name })
  if (signUp.response.ok) return { cookie: extractCookie(signUp.response), userId: signUp.json?.user?.id, mode: 'sign-up' }

  const signIn = await authRequest('/api/auth/sign-in/email', { email, password })
  if (signIn.response.ok) return { cookie: extractCookie(signIn.response), userId: signIn.json?.user?.id, mode: 'sign-in' }

  throw new Error(`Could not sign up or sign in acceptance user. sign-up=${signUp.response.status}:${signUp.text}; sign-in=${signIn.response.status}:${signIn.text}`)
}

async function moveGoalMateData(targetUserId) {
  const source = await prisma.user.findUnique({ where: { email: sourceEmail } })
  const target = await prisma.user.findUnique({ where: { id: targetUserId } })
  if (!source) throw new Error(`Missing source seed user: ${sourceEmail}`)
  if (!target) throw new Error(`Missing target auth user: ${targetUserId}`)

  const sourceGoalCount = await prisma.goal.count({ where: { userId: source.id } })
  if (sourceGoalCount < 1) throw new Error(`Source seed user has no goals: ${sourceEmail}`)

  await prisma.userSetting.deleteMany({ where: { userId: target.id } })
  await prisma.modelConfig.deleteMany({ where: { userId: target.id } })
  await prisma.qqMessageEvent.deleteMany({ where: { userId: target.id } })
  await prisma.qqChatBinding.deleteMany({ where: { userId: target.id } })
  await prisma.telegramUpdateEvent.deleteMany({ where: { userId: target.id } })
  await prisma.telegramChatBinding.deleteMany({ where: { userId: target.id } })
  await prisma.integrationAccount.deleteMany({ where: { userId: target.id } })
  await prisma.externalActionRequest.deleteMany({ where: { userId: target.id } })
  await prisma.markdownDocumentLink.deleteMany({ where: { userId: target.id } })
  await prisma.markdownDocument.deleteMany({ where: { userId: target.id } })
  await prisma.agentMessage.deleteMany({ where: { userId: target.id } })
  await prisma.agentThread.deleteMany({ where: { userId: target.id } })
  await prisma.review.deleteMany({ where: { userId: target.id } })
  await prisma.diagnosis.deleteMany({ where: { userId: target.id } })
  await prisma.checkin.deleteMany({ where: { userId: target.id } })
  await prisma.dailyAction.deleteMany({ where: { userId: target.id } })
  await prisma.stagePlan.deleteMany({ where: { userId: target.id } })
  await prisma.goalCondition.deleteMany({ where: { userId: target.id } })
  await prisma.keyResult.deleteMany({ where: { userId: target.id } })
  await prisma.goalReasoningCard.deleteMany({ where: { userId: target.id } })
  await prisma.logEntry.deleteMany({ where: { userId: target.id } })
  await prisma.goal.deleteMany({ where: { userId: target.id } })

  const models = [
    'userSetting',
    'modelConfig',
    'qqMessageEvent',
    'qqChatBinding',
    'telegramUpdateEvent',
    'telegramChatBinding',
    'integrationAccount',
    'externalActionRequest',
    'markdownDocumentLink',
    'markdownDocument',
    'agentMessage',
    'agentThread',
    'review',
    'diagnosis',
    'checkin',
    'dailyAction',
    'stagePlan',
    'goalCondition',
    'keyResult',
    'goalReasoningCard',
    'logEntry',
    'goal',
  ]

  for (const model of models) {
    await prisma[model].updateMany({
      where: { userId: source.id },
      data: { userId: target.id },
    })
  }

  return {
    goalCount: await prisma.goal.count({ where: { userId: target.id } }),
    logCount: await prisma.markdownDocument.count({ where: { userId: target.id } }),
    threadCount: await prisma.agentThread.count({ where: { userId: target.id } }),
  }
}

try {
  const auth = await signUpOrSignIn()
  const moved = await moveGoalMateData(auth.userId)
  console.log(`Prepared v0.1 authenticated acceptance user by ${auth.mode}: ${email}`)
  console.log(`Moved seed data: goals=${moved.goalCount}, logs=${moved.logCount}, threads=${moved.threadCount}`)
  console.log(`GOAL_MATE_COOKIE='${auth.cookie}'`)
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
