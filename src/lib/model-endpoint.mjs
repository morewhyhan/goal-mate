export function normalizeOpenAiCompatibleApiBase(value) {
  const raw = String(value || '').trim().replace(/\/+$/, '')
  if (!raw) return ''
  try {
    const url = new URL(raw)
    const path = url.pathname.replace(/\/+$/, '')
    if ((url.hostname === 'api.b.ai' || url.hostname === 'api.openai.com') && path === '') {
      url.pathname = '/v1'
      return url.toString().replace(/\/+$/, '')
    }
  } catch {
    return raw
  }
  return raw
}

export function chatCompletionsUrl(apiBase) {
  const base = normalizeOpenAiCompatibleApiBase(apiBase)
  return `${base}/chat/completions`
}
