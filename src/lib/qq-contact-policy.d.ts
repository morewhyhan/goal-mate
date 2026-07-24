export type QqContactAction = 'send' | 'skip' | 'defer'
export type QqChannelMode = 'c2c_passive' | 'c2c_wakeup' | 'group_active'

export type QqContactPolicyDecision = {
  action: QqContactAction
  reasonCode: string
  channelMode: QqChannelMode | null
  nextEligibleAt: string | null
  shouldPauseAll: boolean
  sendOptions: { msgId: string | null; isWakeup: boolean } | null
  evidence: Record<string, unknown>
}

export const QQ_CONTACT_ACTION: Readonly<{
  SEND: 'send'
  SKIP: 'skip'
  DEFER: 'defer'
}>

export const QQ_CHANNEL_MODE: Readonly<{
  C2C_PASSIVE: 'c2c_passive'
  C2C_WAKEUP: 'c2c_wakeup'
  GROUP_ACTIVE: 'group_active'
}>

export const QQ_CADENCE_WINDOWS: Readonly<{
  light: readonly ['morning_planning', 'weekly_review']
  balanced: readonly ['morning_planning', 'evening_review', 'weekly_review']
  supportive: readonly ['morning_planning', 'midday_check', 'evening_review', 'weekly_review']
}>

export function qqCadenceAllowsReminder(cadence: unknown, reminderType: unknown): boolean
export function evaluateQqContactPolicy(input?: Record<string, unknown>): QqContactPolicyDecision
export function evaluateQqInterventionValue(input?: Record<string, unknown>): QqContactPolicyDecision

export function buildQqMessageBody(
  content: string,
  options?: {
    channelMode?: QqChannelMode
    sourceMessageId?: string
    msgSeq?: number
  },
): Record<string, unknown>

export function pauseQqProactiveContact(
  prisma: any,
  userId: string,
  options?: { reasonCode?: string; now?: Date | string },
): Promise<{
  userId: string
  reasonCode: string
  pausedAt: string
  disabledRuleIds: string[]
}>
