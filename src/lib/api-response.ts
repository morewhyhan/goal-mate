type ApiErrorPayload = {
  error?: {
    message?: string
  } | string
  message?: string
}

function messageFromPayload(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== 'object') return fallback
  const value = payload as ApiErrorPayload
  if (typeof value.error === 'string' && value.error.trim()) return value.error
  if (value.error && typeof value.error === 'object' && value.error.message?.trim()) {
    return value.error.message
  }
  if (value.message?.trim()) return value.message
  return fallback
}

export async function parseApiResponse<T = any>(response: Response): Promise<T> {
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    if (!response.ok) throw new Error(`请求失败（${response.status}）`)
    throw new Error('服务器返回了无法读取的响应。')
  }

  if (!response.ok) {
    throw new Error(messageFromPayload(payload, `请求失败（${response.status}）`))
  }

  return payload as T
}
