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
