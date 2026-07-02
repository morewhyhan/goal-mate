import { prisma } from '@/lib/db'
import {
  executeAgentToolWithPrisma,
  listSharedAgentToolDefinitions,
} from '@/lib/agent-tool-executor.mjs'

export type AgentToolPermission = 'read' | 'draft' | 'execute'
export type AgentToolSource = 'web' | 'qq' | 'scheduler'

export type AgentToolContext = {
  userId: string
  source: AgentToolSource
  confirmed?: boolean
  agentThreadId?: string
  agentMessageId?: string
}

export type AgentToolDefinition = {
  name: string
  description: string
  permission: AgentToolPermission
  targetType: string
  riskLevel: 'low' | 'medium' | 'high'
}

export function listAgentTools(): AgentToolDefinition[] {
  return listSharedAgentToolDefinitions() as AgentToolDefinition[]
}

export async function executeAgentTool(
  context: AgentToolContext,
  toolName: string,
  rawInput: unknown,
) {
  return executeAgentToolWithPrisma(prisma, context, toolName, rawInput)
}
