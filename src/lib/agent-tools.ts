import { prisma } from '@/lib/db'
import {
  asAgentToolRecord,
  compactAgentToolSummary,
  listSharedAgentTools,
} from '@/lib/agent-tool-shared.mjs'
import {
  canHandleSharedReadDraftTool,
  runSharedReadDraftToolHandler,
} from '@/lib/agent-tool-read-handlers.mjs'
import {
  canHandleSharedWriteTool,
  runSharedWriteToolHandler,
} from '@/lib/agent-tool-write-handlers.mjs'

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

type AgentToolHandlerResult = {
  targetId?: string
  result: unknown
}

const toolDefinitions = listSharedAgentTools() as AgentToolDefinition[]

async function runSharedAgentTool(
  userId: string,
  toolName: string,
  input: Record<string, unknown>,
): Promise<AgentToolHandlerResult> {
  if (canHandleSharedReadDraftTool(toolName)) {
    return runSharedReadDraftToolHandler(prisma, userId, toolName, input)
  }
  if (canHandleSharedWriteTool(toolName)) {
    return runSharedWriteToolHandler(prisma, userId, toolName, input)
  }

  throw new Error(`未知 Agent 工具：${toolName}`)
}

export function listAgentTools() {
  return listSharedAgentTools()
}

export async function executeAgentTool(
  context: AgentToolContext,
  toolName: string,
  rawInput: unknown,
) {
  const definition = toolDefinitions.find((item) => item.name === toolName)
  if (!definition) throw new Error(`未知 Agent 工具：${toolName}`)

  const input = asAgentToolRecord(rawInput)
  const requiresConfirmation = definition.permission === 'execute' && !context.confirmed

  if (requiresConfirmation) {
    const action = await prisma.agentToolAction.create({
      data: {
        userId: context.userId,
        source: context.source,
        toolName: definition.name,
        permission: definition.permission,
        inputSummary: compactAgentToolSummary(input),
        input,
        targetType: definition.targetType,
        riskLevel: definition.riskLevel,
        requiresConfirmation: true,
        status: 'pending_confirmation',
        agentThreadId: context.agentThreadId,
        agentMessageId: context.agentMessageId,
      },
    })
    return { needsConfirmation: true, action, result: null }
  }

  try {
    const output = await runSharedAgentTool(context.userId, definition.name, input)
    const action = await prisma.agentToolAction.create({
      data: {
        userId: context.userId,
        source: context.source,
        toolName: definition.name,
        permission: definition.permission,
        inputSummary: compactAgentToolSummary(input),
        input,
        result: output.result as any,
        targetType: definition.targetType,
        targetId: output.targetId,
        riskLevel: definition.riskLevel,
        requiresConfirmation: false,
        status: definition.permission === 'draft' ? 'drafted' : 'executed',
        agentThreadId: context.agentThreadId,
        agentMessageId: context.agentMessageId,
      },
    })
    return { needsConfirmation: false, action, result: output.result }
  } catch (error) {
    const action = await prisma.agentToolAction.create({
      data: {
        userId: context.userId,
        source: context.source,
        toolName: definition.name,
        permission: definition.permission,
        inputSummary: compactAgentToolSummary(input),
        input,
        targetType: definition.targetType,
        riskLevel: definition.riskLevel,
        requiresConfirmation,
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : String(error),
        agentThreadId: context.agentThreadId,
        agentMessageId: context.agentMessageId,
      },
    })
    return { needsConfirmation: false, action, result: null }
  }
}
