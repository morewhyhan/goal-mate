export type SharedAgentToolPermission = 'read' | 'draft' | 'execute'

export type SharedAgentToolDefinition = {
  name: string
  description: string
  permission: SharedAgentToolPermission
  targetType: string
  riskLevel: 'low' | 'medium' | 'high'
}

export declare const sharedAgentToolCatalog: SharedAgentToolDefinition[]
export declare function listSharedAgentTools(): SharedAgentToolDefinition[]
export declare function detectConfirmToolMessage(content?: string): boolean
export declare function formatAgentToolReply(toolName: string, execution: any): string
