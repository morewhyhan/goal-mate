export type QqReminderControlIntent = {
  action: 'pause' | 'resume'
  scope: 'qq' | 'reminder_type' | 'nearest_or_all'
  reminderType?: string | null
  reason: string
}

export function detectQqReminderControlIntent(text: unknown): QqReminderControlIntent | null
export function shouldPauseAllQqProactiveRules(intent: QqReminderControlIntent): boolean
export function selectQqReminderRulesForControl(rules: any[], intent: QqReminderControlIntent, recentSchedulerEvent?: any): any[]
export function buildQqReminderControlToolInput(intent: QqReminderControlIntent): Record<string, unknown> | null
export function hasExplicitSchedulerFeedbackSignal(text: unknown): boolean
export function isLikelyQqSchedulerFeedback(text: unknown, schedulerEvent: any, context?: any): boolean
export function renderQqSchedulerFeedback(feedback: any, options?: { writeFailed?: boolean }): string
export function renderQqReminderControlResult(result: { action?: string; count?: number }): string
export function renderQqToolExecution(toolName: string, execution: any): string
export function renderQqModelFailure(reason: unknown): string
export function renderQqModelReply(value: unknown, options?: { fallback?: string; maxLength?: number }): string
export function inspectQqRenderedMessage(value: unknown): {
  questionCount: number
  exposesInternalReasonLabel: boolean
}
