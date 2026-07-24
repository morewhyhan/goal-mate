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
import { encryptModelApiKey } from './model-secret.mjs'
import { isProactiveContactDisableInput } from './proactive-contact-control.mjs'

const sharedToolDefinitions = listSharedAgentTools()

export function listSharedAgentToolDefinitions() {
  return sharedToolDefinitions.map((tool) => ({ ...tool }))
}

export async function recordAgentToolActionWithPrisma(prisma, options) {
  const input = asAgentToolRecord(options.input)
  return prisma.agentToolAction.create({
    data: {
      userId: options.context.userId,
      source: options.context.source,
      toolName: options.toolName,
      permission: options.permission,
      inputSummary: options.inputSummary || compactAgentToolSummary(input),
      input,
      ...(options.result !== undefined ? { result: options.result } : {}),
      targetType: options.targetType,
      targetId: options.targetId,
      riskLevel: options.riskLevel,
      requiresConfirmation: options.requiresConfirmation ?? false,
      status: options.status,
      ...(options.errorMessage ? { errorMessage: options.errorMessage } : {}),
      agentThreadId: options.context.agentThreadId,
      agentMessageId: options.context.agentMessageId,
    },
  })
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

function secureAgentToolInput(toolName, input) {
  const secured = { ...asAgentToolRecord(input) }
  if (toolName === 'settings.model.update') {
    const rawApiKey = typeof secured.apiKey === 'string' ? secured.apiKey.trim() : ''
    if (rawApiKey) {
      secured.apiKeyRef = encryptModelApiKey(rawApiKey)
    }
    delete secured.apiKey
  }
  return secured
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function readPolicyBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback
}

async function loadAgentConfirmationPolicy(prisma, userId) {
  const settings = await prisma.userSetting.findUnique({ where: { userId } })
  const agent = asRecord(settings?.agent)
  return {
    requireConfirmGoalChanges: readPolicyBoolean(agent.require_confirm_goal_changes, true),
    requireConfirmSettingChanges: readPolicyBoolean(agent.require_confirm_setting_changes, true),
    requireConfirmExternalActions: readPolicyBoolean(agent.require_confirm_external_actions, true),
  }
}

export function shouldRequireConfirmation(definition, policy, input) {
  if (definition.permission !== 'execute') return false
  if (definition.riskLevel === 'high') return true

  // A check-in is the user's report of an observed fact, not a proposed
  // system change. Requiring a second confirmation here would make the
  // "tell the assistant what happened" path fail to record the feedback.
  if (definition.name === 'checkin.submit') {
    return false
  }

  if (definition.name === 'goal.update' || definition.name === 'today.set_next_action') {
    return policy.requireConfirmGoalChanges
  }

  if (definition.name === 'settings.model.update') {
    return policy.requireConfirmSettingChanges
  }

  if (definition.name === 'reminder.schedule') {
    // Stopping contact is always safe and must take effect immediately.
    // Starting or restoring external contact always needs an explicit second step.
    return !isProactiveContactDisableInput(input)
  }

  return true
}

export async function executeAgentToolWithPrisma(prisma, context, toolName, rawInput) {
  const definition = sharedToolDefinitions.find((item) => item.name === toolName)
  if (!definition) throw new Error(`未知 Agent 工具：${toolName}`)

  const input = secureAgentToolInput(definition.name, rawInput)
  const confirmationPolicy = await loadAgentConfirmationPolicy(prisma, context.userId)
  const requiresConfirmation = !context.confirmed && shouldRequireConfirmation(definition, confirmationPolicy, input)

  if (requiresConfirmation) {
    const action = await recordAgentToolActionWithPrisma(prisma, {
      context,
      toolName: definition.name,
      permission: definition.permission,
      input,
      targetType: definition.targetType,
      riskLevel: definition.riskLevel,
      requiresConfirmation: true,
      status: 'pending_confirmation',
    })
    return { needsConfirmation: true, action, result: null }
  }

  try {
    const output = await runSharedAgentTool(prisma, context.userId, definition.name, input)
    const action = await recordAgentToolActionWithPrisma(prisma, {
      context,
      toolName: definition.name,
      permission: definition.permission,
      input,
      result: output.result,
      targetType: definition.targetType,
      targetId: output.targetId,
      riskLevel: definition.riskLevel,
      requiresConfirmation: false,
      status: definition.permission === 'draft' ? 'drafted' : 'executed',
    })
    return { needsConfirmation: false, action, result: output.result }
  } catch (error) {
    const action = await recordAgentToolActionWithPrisma(prisma, {
      context,
      toolName: definition.name,
      permission: definition.permission,
      input,
      targetType: definition.targetType,
      riskLevel: definition.riskLevel,
      requiresConfirmation,
      status: 'failed',
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    return { needsConfirmation: false, action, result: null }
  }
}
