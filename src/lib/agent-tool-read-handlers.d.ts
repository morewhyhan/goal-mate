export const sharedReadDraftToolNames: string[]

export function canHandleSharedReadDraftTool(toolName: string): boolean

export function runSharedReadDraftToolHandler(
  prisma: any,
  userId: string,
  toolName: string,
  input?: Record<string, unknown>,
): Promise<{
  targetId?: string
  result: unknown
}>
