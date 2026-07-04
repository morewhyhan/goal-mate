import { decryptModelApiKeyRef, encryptModelApiKey, isEncryptedModelApiKeyRef } from './model-secret.mjs'

export const QQ_BOT_PROVIDER = 'qq_bot'

const DEFAULT_QQ_API_BASE = 'https://api.sgroup.qq.com'
const DEFAULT_QQ_INTENTS = 33554432
const BINDING_CODE_PREFIX = 'GM'
const BINDING_CODE_TTL_MS = 30 * 60 * 1000

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function withoutLegacyDefaultUserEmail(value) {
  const record = { ...asRecord(value) }
  delete record.defaultUserEmail
  return record
}

function readString(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function readNumber(value, fallback) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function readBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback
}

function readDate(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function randomBindingSuffix() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let index = 0; index < 6; index += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  return code
}

export function normalizeQqBindingCode(value) {
  const text = String(value || '').toUpperCase()
  const match = text.match(/\bGM[\s-]*([A-Z0-9]{3})[\s-]*([A-Z0-9]{3})\b/)
  return match ? `${BINDING_CODE_PREFIX}-${match[1]}${match[2]}` : ''
}

export function isQqBindingCodeActive(permissions, now = new Date()) {
  const record = asRecord(permissions)
  const code = normalizeQqBindingCode(record.bindingCode)
  const expiresAt = readDate(record.bindingCodeExpiresAt)
  return Boolean(code && expiresAt && expiresAt.getTime() > now.getTime())
}

function bindingCodeView(permissions, now = new Date()) {
  const record = asRecord(permissions)
  const code = normalizeQqBindingCode(record.bindingCode)
  const expiresAt = readDate(record.bindingCodeExpiresAt)
  const active = Boolean(code && expiresAt && expiresAt.getTime() > now.getTime())
  return {
    code: active ? code : '',
    expiresAt: active ? expiresAt.toISOString() : '',
    command: active ? `绑定 ${code}` : '',
    active,
  }
}

function normalizeAllowedContextIds(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean)
  }
  if (typeof value === 'string') {
    return value.split(',').map((item) => item.trim()).filter(Boolean)
  }
  return []
}

function maskValue(value) {
  const text = String(value || '')
  if (!text) return ''
  if (text.length <= 10) return 'configured'
  return `${text.slice(0, 4)}...${text.slice(-4)}`
}

function decryptSecretRef(ref) {
  const value = String(ref || '').trim()
  if (!value) return ''
  if (isEncryptedModelApiKeyRef(value)) return decryptModelApiKeyRef(value)
  return ''
}

export async function findQqBotAccount(prisma, userId) {
  return prisma.integrationAccount.findFirst({
    where: { userId, provider: QQ_BOT_PROVIDER },
    orderBy: { updatedAt: 'desc' },
  })
}

export function maskQqBotConfig(account) {
  const permissions = asRecord(account?.permissions)
  const hasAccount = Boolean(account)
  const tokenRef = readString(permissions.tokenRef)
  const tokenConfigured = Boolean(decryptSecretRef(tokenRef))
  const appId = readString(permissions.appId)
  const enabled = hasAccount ? account.status === 'ENABLED' : Boolean(appId && tokenConfigured)

  return {
    id: account?.id || '',
    provider: QQ_BOT_PROVIDER,
    source: hasAccount ? 'settings' : 'settings_required',
    enabled,
    configured: Boolean(enabled && appId && tokenConfigured),
    status: account?.status || (appId && tokenConfigured ? 'ENABLED' : 'DISABLED'),
    appId,
    appIdMasked: maskValue(appId),
    tokenConfigured,
    tokenSource: tokenRef ? 'settings_encrypted' : 'missing',
    apiBase: readString(permissions.apiBase, DEFAULT_QQ_API_BASE).replace(/\/+$/, ''),
    intents: readNumber(permissions.intents, DEFAULT_QQ_INTENTS),
    allowedContextIds: normalizeAllowedContextIds(permissions.allowedContextIds),
    binding: bindingCodeView(permissions),
    updatedAt: account?.updatedAt,
  }
}

export async function saveQqBotConfig(prisma, userId, input = {}) {
  const existing = await findQqBotAccount(prisma, userId)
  const previous = asRecord(existing?.permissions)
  const appId = readString(input.appId)
  const token = readString(input.token)
  const tokenRef = token
    ? encryptModelApiKey(token)
    : readString(previous.tokenRef)
  const apiBase = readString(input.apiBase, DEFAULT_QQ_API_BASE).replace(/\/+$/, '')
  const intents = readNumber(input.intents, DEFAULT_QQ_INTENTS)
  const allowedContextIds = normalizeAllowedContextIds(input.allowedContextIds)
  const enabled = readBoolean(input.enabled, true)
  const configured = Boolean(enabled && appId && tokenRef)
  const previousBinding = bindingCodeView(previous)

  const data = {
    accountLabel: appId ? `QQ Bot ${maskValue(appId)}` : 'QQ Bot',
    status: configured ? 'ENABLED' : 'DISABLED',
    permissions: {
      appId,
      tokenRef,
      apiBase,
      intents,
      allowedContextIds,
      bindingCode: previousBinding.code,
      bindingCodeExpiresAt: previousBinding.expiresAt,
      configuredFrom: 'settings_ui',
    },
  }

  const saved = existing
    ? await prisma.integrationAccount.update({ where: { id: existing.id }, data })
    : await prisma.integrationAccount.create({
        data: {
          userId,
          provider: QQ_BOT_PROVIDER,
          ...data,
        },
      })

  return maskQqBotConfig(saved)
}

export async function issueQqBindingCode(prisma, userId) {
  const existing = await findQqBotAccount(prisma, userId)
  const previous = existing
    ? withoutLegacyDefaultUserEmail(existing.permissions)
    : {
        appId: '',
        tokenRef: '',
        apiBase: readString(process.env.QQ_BOT_API_BASE, DEFAULT_QQ_API_BASE).replace(/\/+$/, ''),
        intents: readNumber(process.env.QQ_BOT_INTENTS, DEFAULT_QQ_INTENTS),
        allowedContextIds: normalizeAllowedContextIds(process.env.QQ_ALLOWED_CONTEXT_IDS),
        configuredFrom: 'settings_required',
      }
  const now = new Date()
  const expiresAt = new Date(now.getTime() + BINDING_CODE_TTL_MS)
  const bindingCode = `${BINDING_CODE_PREFIX}-${randomBindingSuffix()}`
  const configured = Boolean(readString(previous.appId) && readString(previous.tokenRef))

  const data = {
    accountLabel: existing?.accountLabel || 'QQ Bot',
    status: existing?.status || (configured ? 'ENABLED' : 'DISABLED'),
    permissions: {
      ...previous,
      bindingCode,
      bindingCodeCreatedAt: now.toISOString(),
      bindingCodeExpiresAt: expiresAt.toISOString(),
    },
  }

  const saved = existing
    ? await prisma.integrationAccount.update({ where: { id: existing.id }, data })
    : await prisma.integrationAccount.create({
        data: {
          userId,
          provider: QQ_BOT_PROVIDER,
          ...data,
        },
      })

  return maskQqBotConfig(saved).binding
}

export async function findQqAccountByBindingCode(prisma, rawCode) {
  const code = normalizeQqBindingCode(rawCode)
  if (!code) return null

  const accounts = await prisma.integrationAccount.findMany({
    where: { provider: QQ_BOT_PROVIDER, status: 'ENABLED' },
    orderBy: { updatedAt: 'desc' },
  })

  const now = new Date()
  return accounts.find((account) => {
    const permissions = asRecord(account.permissions)
    return normalizeQqBindingCode(permissions.bindingCode) === code && isQqBindingCodeActive(permissions, now)
  }) || null
}

export async function clearQqBindingCode(prisma, accountId, boundContext) {
  const account = await prisma.integrationAccount.findUnique({ where: { id: accountId } })
  if (!account) return null
  const previous = withoutLegacyDefaultUserEmail(account.permissions)
  return prisma.integrationAccount.update({
    where: { id: accountId },
    data: {
      permissions: {
        ...previous,
        bindingCode: '',
        bindingCodeCreatedAt: '',
        bindingCodeExpiresAt: '',
        lastBoundAt: new Date().toISOString(),
        lastBoundContextType: boundContext?.contextType || '',
        lastBoundContextId: boundContext?.contextId || '',
      },
    },
  })
}

export async function resolveQqBotConfig(prisma, userId = '') {
  const account = userId
    ? await prisma.integrationAccount.findFirst({
        where: { userId, provider: QQ_BOT_PROVIDER },
        orderBy: { updatedAt: 'desc' },
      })
    : await prisma.integrationAccount.findFirst({
        where: { provider: QQ_BOT_PROVIDER, status: 'ENABLED' },
        orderBy: { updatedAt: 'desc' },
      })

  if (account && account.status !== 'ENABLED') {
    const masked = maskQqBotConfig(account)
    return {
      ...masked,
      token: '',
      configured: false,
      disabledBySettings: true,
    }
  }

  const permissions = asRecord(account?.permissions)
  const appId = readString(permissions.appId)
  const tokenRef = readString(permissions.tokenRef)
  const token = decryptSecretRef(tokenRef)
  const apiBase = readString(permissions.apiBase, readString(process.env.QQ_BOT_API_BASE, DEFAULT_QQ_API_BASE)).replace(/\/+$/, '')
  const intents = readNumber(permissions.intents, readNumber(process.env.QQ_BOT_INTENTS, DEFAULT_QQ_INTENTS))
  const allowedContextIds = normalizeAllowedContextIds(permissions.allowedContextIds)

  return {
    accountId: account?.id || '',
    userId: account?.userId || '',
    source: account ? 'settings' : 'settings_required',
    configured: Boolean(appId && token),
    appId,
    token,
    apiBase,
    intents,
    allowedContextIds,
  }
}
