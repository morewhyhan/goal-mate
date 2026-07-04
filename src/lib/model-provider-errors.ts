export type ModelProviderFailure = {
  reason: 'insufficient_balance' | 'invalid_api_key' | 'rate_limited' | 'provider_unavailable' | 'provider_error'
  message: string
}

export function parseModelProviderError(text: string) {
  try {
    const parsed = JSON.parse(text)
    return String(parsed?.error?.message || parsed?.message || text)
  } catch {
    return String(text || '')
  }
}

export function classifyModelProviderFailure(status: number | undefined, rawMessage: string): ModelProviderFailure {
  const text = rawMessage.toLowerCase()
  if (text.includes('insufficient balance') || text.includes('余额不足') || text.includes('quota') || text.includes('billing')) {
    return {
      reason: 'insufficient_balance',
      message: 'DeepSeek 账户余额不足。请充值，或者换一个可用的 API Key 后再试。',
    }
  }
  if (status === 401 || status === 403 || text.includes('invalid api key') || text.includes('unauthorized') || text.includes('authentication')) {
    return {
      reason: 'invalid_api_key',
      message: '模型 API Key 无效或没有权限。请检查 Key 是否复制完整，或者重新生成一个 Key。',
    }
  }
  if (status === 429 || text.includes('rate limit') || text.includes('too many requests')) {
    return {
      reason: 'rate_limited',
      message: '模型请求被限流。稍后再试，或降低请求频率。',
    }
  }
  if (status && status >= 500) {
    return {
      reason: 'provider_unavailable',
      message: '模型服务暂时不可用。稍后再试。',
    }
  }
  return {
    reason: 'provider_error',
    message: rawMessage ? `模型服务返回错误：${rawMessage.slice(0, 160)}` : '模型服务返回未知错误。',
  }
}

export function formatAgentModelFailureMessage(failure: { message: string }) {
  return [
    '模型现在不可用，我已经保存了你的消息，但不会假装已经完成思考，也不会改动任何计划。',
    failure.message,
    '先去 Settings 测试连接；修好后再让我继续。',
  ].join('\n')
}

export function formatAgentModelNetworkFailureMessage(message: string) {
  return [
    '模型现在连不上，我已经保存了你的消息，但不会假装已经完成思考，也不会改动任何计划。',
    `网络错误：${message}`,
    '先去 Settings 测试连接；修好后再让我继续。',
  ].join('\n')
}
