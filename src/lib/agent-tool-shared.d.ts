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
export declare function asAgentToolRecord(input: unknown): Record<string, unknown>
export declare function readAgentToolString(input: Record<string, unknown>, key: string, fallback?: string): string
export declare function readAgentToolNumber(input: Record<string, unknown>, key: string, fallback: number): number
export declare function readAgentToolBoolean(input: Record<string, unknown>, key: string): boolean | undefined
export declare function compactAgentToolSummary(input: Record<string, unknown>): string
export declare function toAgentToolDateInput(value: string): Date
export declare function formatAgentToolDatePath(date: Date): { title: string; path: string }
export declare function normalizeAgentToolCheckinResult(value: string): 'DONE' | 'PARTIAL' | 'NOT_DONE' | 'NO_RESPONSE'
export declare function normalizeAgentToolActionStatus(value: string): 'DONE' | 'PARTIAL' | 'NOT_DONE' | 'PLANNED'
export declare function parseAgentToolIntentJson(value: string): Record<string, unknown> | null
export declare function formatAgentToolReply(toolName: string, execution: any): string
