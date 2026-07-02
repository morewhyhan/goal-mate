export const sharedWriteToolNames: string[]

export function canHandleSharedWriteTool(toolName: string): boolean

export function runSharedWriteToolHandler(
  prisma: any,
  userId: string,
  toolName: string,
  input?: Record<string, unknown>,
): Promise<{
  targetId?: string
  result: unknown
}>
