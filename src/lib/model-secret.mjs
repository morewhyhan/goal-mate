import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

const ENCRYPTED_PREFIX = 'enc:v1:'
const USER_KEY_SOURCE = 'user_encrypted'
const ENV_KEY_SOURCE = 'server_env'
const MISSING_KEY_SOURCE = 'missing'
const LEGACY_RAW_SOURCE = 'legacy_raw'

function encryptionSecret() {
  return process.env.GOAL_MATE_SECRET
    || process.env.BETTER_AUTH_SECRET
    || process.env.AUTH_SECRET
    || process.env.NEXTAUTH_SECRET
    || 'goal-mate-local-development-secret'
}

function encryptionKey() {
  return createHash('sha256').update(encryptionSecret()).digest()
}

function base64Url(buffer) {
  return Buffer.from(buffer).toString('base64url')
}

function fromBase64Url(value) {
  return Buffer.from(value, 'base64url')
}

export function encryptModelApiKey(apiKey) {
  const secret = String(apiKey || '').trim()
  if (!secret) return ''
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${ENCRYPTED_PREFIX}${base64Url(iv)}:${base64Url(tag)}:${base64Url(encrypted)}`
}

export function isEncryptedModelApiKeyRef(value) {
  return typeof value === 'string' && value.startsWith(ENCRYPTED_PREFIX)
}

export function decryptModelApiKeyRef(value) {
  const ref = String(value || '')
  if (!isEncryptedModelApiKeyRef(ref)) return ''
  const payload = ref.slice(ENCRYPTED_PREFIX.length)
  const [ivText, tagText, encryptedText] = payload.split(':')
  if (!ivText || !tagText || !encryptedText) return ''
  try {
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), fromBase64Url(ivText))
    decipher.setAuthTag(fromBase64Url(tagText))
    return Buffer.concat([decipher.update(fromBase64Url(encryptedText)), decipher.final()]).toString('utf8')
  } catch {
    return ''
  }
}

export function resolveModelApiKey(modelConfig) {
  const ref = String(modelConfig?.apiKeyRef || '').trim()
  if (!ref) return ''
  if (isEncryptedModelApiKeyRef(ref)) return decryptModelApiKeyRef(ref)
  if (ref.startsWith('env:')) return process.env[ref.slice(4)] || ''
  if (/^[A-Z][A-Z0-9_]{2,}$/.test(ref)) return process.env[ref] || ''
  if (/^sk-[A-Za-z0-9_-]{12,}/.test(ref)) return ref
  return ''
}

export function modelApiKeySource(modelConfig) {
  const ref = String(modelConfig?.apiKeyRef || '').trim()
  if (!ref) return MISSING_KEY_SOURCE
  if (isEncryptedModelApiKeyRef(ref)) return resolveModelApiKey(modelConfig) ? USER_KEY_SOURCE : MISSING_KEY_SOURCE
  if (ref.startsWith('env:') || /^[A-Z][A-Z0-9_]{2,}$/.test(ref)) return resolveModelApiKey(modelConfig) ? ENV_KEY_SOURCE : MISSING_KEY_SOURCE
  if (/^sk-[A-Za-z0-9_-]{12,}/.test(ref)) return LEGACY_RAW_SOURCE
  return MISSING_KEY_SOURCE
}

export function hasModelApiKey(modelConfig) {
  return Boolean(resolveModelApiKey(modelConfig))
}

export function maskModelConfig(config) {
  if (!config) return null
  const source = modelApiKeySource(config)
  const configured = source !== MISSING_KEY_SOURCE && hasModelApiKey(config)
  return {
    ...config,
    apiKeyRef: configured ? 'sk-••••••••••••' : '',
    apiKeyConfigured: configured,
    apiKeySource: source,
  }
}

export function modelSecretWriteData(input = {}, existing = null) {
  const { apiKey, apiKeyRef, ...rest } = input
  const data = { ...rest }
  const nextApiKey = typeof apiKey === 'string' ? apiKey.trim() : ''
  if (nextApiKey) {
    data.apiKeyRef = encryptModelApiKey(nextApiKey)
  } else if (typeof apiKeyRef === 'string' && (apiKeyRef.startsWith('env:') || isEncryptedModelApiKeyRef(apiKeyRef))) {
    data.apiKeyRef = apiKeyRef
  } else if (existing) {
    data.apiKeyRef = existing.apiKeyRef || ''
  } else {
    data.apiKeyRef = ''
  }
  return data
}
