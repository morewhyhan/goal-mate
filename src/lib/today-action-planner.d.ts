export function ensureTodayAction(
  prisma: any,
  userId: string,
  options?: { goalId?: string; date?: Date },
): Promise<{
  goal: any
  action: any
  generated: boolean
  todayLocked: boolean
}>
