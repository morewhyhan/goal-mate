import { auth } from '@/lib/auth'

export async function getCurrentUserId(c: any): Promise<string | null> {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  return session?.user?.id || null
}

export function unauthorized(c: any) {
  return c.json({ error: { code: 'UNAUTHORIZED', message: '请先登录。' } }, 401)
}

export function notFound(c: any, message = '资源不存在。') {
  return c.json({ error: { code: 'NOT_FOUND', message } }, 404)
}

export const defaultUserSettings = {
  general: { locale: 'zh-CN', timezone: 'Asia/Shanghai', week_start: 'monday' },
  goals: { max_active_goals: 1, review_cadence: 'weekly' },
  logs: {
    vault_root: 'logs/',
    naming_pattern: 'YYYY/Q#/YYYY-MM/W##/YYYY-MM-DD.md',
    auto_write_checkin: true,
    auto_write_review: true,
    preserve_user_edits: true,
  },
  today: { generate_time: '08:30', low_energy_mode: true, heatmap_scope: 'year' },
  agent: {
    can_read_goals: true,
    can_read_logs: true,
    memory_enabled: true,
    require_confirm_goal_changes: true,
    require_confirm_setting_changes: true,
    require_confirm_external_actions: true,
  },
  notifications: {
    morning_checkin_time: '08:30',
    evening_review_time: '21:30',
    quiet_hours: '23:00-07:30',
    channel: 'web',
    max_daily_prompts: 2,
  },
  dataPrivacy: { redact_secrets: true, export_markdown: true, local_first_mode: false },
}

export const defaultDeepSeekModel = {
  provider: 'DeepSeek',
  model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
  reasoningModel: process.env.DEEPSEEK_REASONING_MODEL || '',
  apiBase: process.env.DEEPSEEK_API_BASE || 'https://api.deepseek.com',
  apiKeyRef: '',
  usage: 'CHAT' as const,
  isDefault: true,
  temperature: 0.3,
}
