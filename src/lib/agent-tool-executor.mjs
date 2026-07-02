import {
  asAgentToolRecord,
  compactAgentToolSummary,
  listSharedAgentTools,
} from './agent-tool-shared.mjs'
import {
  canHandleSharedReadDraftTool,
  runSharedReadDraftToolHandler,
} from './agent-tool-read-handlers.mjs'
import {
  canHandleSharedWriteTool,
  runSharedWriteToolHandler,
} from './agent-tool-write-handlers.mjs'

const sharedToolDefinitions = listSharedAgentTools()

export function listSharedAgentToolDefinitions() {
  return sharedToolDefinitions.map((tool) => ({ ...tool }))
}

async function runSharedAgentTool(prisma, userId, toolName, input) {
  if (canHandleSharedReadDraftTool(toolName)) {
    return runSharedReadDraftToolHandler(prisma, userId, toolName, input)
  }
  if (canHandleSharedWriteTool(toolName)) {
    return runSharedWriteToolHandler(prisma, userId, toolName, input)
  }

  throw new Error(`未知 Agent 工具：${toolName}`)
}

export async function executeAgentToolWithPrisma(prisma, context, toolName, rawInput) {
  const definition = sharedToolDefinitions.find((item) => item.name === toolName)
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
    const output = await runSharedAgentTool(prisma, context.userId, definition.name, input)
    const action = await prisma.agentToolAction.create({
      data: {
        userId: context.userId,
        source: context.source,
        toolName: definition.name,
        permission: definition.permission,
        inputSummary: compactAgentToolSummary(input),
        input,
        result: output.result,
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
