export type SharedAgentToolPermission = 'read' | 'draft' | 'execute'
export type SharedAgentToolSource = 'web' | 'qq' | 'scheduler'

export type SharedAgentToolContext = {
  userId: string
  source: SharedAgentToolSource
  confirmed?: boolean
  agentThreadId?: string
  agentMessageId?: string
}

export type SharedAgentToolDefinition = {
  name: string
  description: string
  permission: SharedAgentToolPermission
  targetType: string
  riskLevel: 'low' | 'medium' | 'high'
}

export function listSharedAgentToolDefinitions(): SharedAgentToolDefinition[]

export function recordAgentToolActionWithPrisma(
  prisma: any,
  options: {
    context: SharedAgentToolContext
    toolName: string
    permission: SharedAgentToolPermission
    input?: Record<string, unknown>
    inputSummary?: string
    result?: unknown
    targetType: string
    targetId?: string
    riskLevel: 'low' | 'medium' | 'high'
    requiresConfirmation?: boolean
    status: 'pending_confirmation' | 'drafted' | 'approved' | 'executed' | 'failed' | 'rejected'
    errorMessage?: string
  },
): Promise<any>

export function executeAgentToolWithPrisma(
  prisma: any,
  context: SharedAgentToolContext,
  toolName: string,
  rawInput: unknown,
): Promise<{
  needsConfirmation: boolean
  action: any
  result: unknown
}>
