export function buildLogPeriodRollupTargets(date?: Date): Array<{
  type: 'WEEK' | 'MONTH' | 'QUARTER' | 'YEAR'
  title: string
  path: string
  label: string
}>

export function ensureLogPeriodRollups(
  prisma: any,
  input: {
    userId: string
    date?: Date
    sourcePath?: string
    sourceKind?: string
    goalId?: string
    actionId?: string
    goalTitle?: string
    actionTitle?: string
    resultLabel?: string
    conditionTitle?: string
    diagnosisQuestion?: string
  },
): Promise<Array<{ logEntry: any; markdownDocument: any }>>
