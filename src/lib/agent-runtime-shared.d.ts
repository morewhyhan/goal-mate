export type SharedAgentRuntimeOptions = {
  userId: string
  threadId: string
  latestUserContent: string
  defaultAgentSettings?: Record<string, unknown>
  defaultChatModel?: Record<string, unknown>
  channel?: 'web' | 'qq'
}

export type SharedAgentToolIntentOptions = {
  userId: string
  latestUserContent: string
  defaultAgentSettings?: Record<string, unknown>
  defaultChatModel?: Record<string, unknown>
}

export function loadSharedAgentRuntimeSettings(prisma: any, userId: string, defaults?: Record<string, unknown>): Promise<{
  canReadGoals: boolean
  canReadLogs: boolean
  memoryEnabled: boolean
}>
export function generateAssistantReplyWithPrisma(prisma: any, options: SharedAgentRuntimeOptions): Promise<any>
export function buildFirstGoalDraftInput(content: string, now?: Date): any
export function evaluateFirstGoalTurnWithPrisma(prisma: any, userId: string, content: string): Promise<any>
export function inferCheckinFeedbackIntent(content: string): any
export function generateAgentToolIntentWithPrisma(prisma: any, options: SharedAgentToolIntentOptions): Promise<any>
