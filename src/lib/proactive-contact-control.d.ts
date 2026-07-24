export type ProactiveContactCadence = 'light' | 'balanced' | 'supportive'

export const RECOMMENDED_PROACTIVE_CONTACT_RULES: ReadonlyArray<Readonly<{
  reminderType: string
  schedule: string
}>>

export function normalizeProactiveContactCadence(value: unknown): ProactiveContactCadence
export function inferProactiveContactToolIntent(value: unknown): {
  toolName: 'reminder.schedule'
  input: Record<string, unknown>
  confidence: number
  reason: string
} | null
export function isProactiveContactDisableInput(value?: Record<string, unknown>): boolean
export function buildProactiveContactMetadata(
  input?: Record<string, unknown>,
  now?: Date | string,
): Record<string, unknown>
