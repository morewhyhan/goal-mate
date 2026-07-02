const DAY_MS = 24 * 60 * 60 * 1000
const ROLLUP_START = '<!-- goal-mate:rollup:start -->'
const ROLLUP_END = '<!-- goal-mate:rollup:end -->'

function pad(value) {
  return String(value).padStart(2, '0')
}

function getWeekNumber(date) {
  const copied = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = copied.getUTCDay() || 7
  copied.setUTCDate(copied.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(copied.getUTCFullYear(), 0, 1))
  return Math.ceil((((copied.getTime() - yearStart.getTime()) / DAY_MS) + 1) / 7)
}

function localParts(date = new Date()) {
  const year = date.getFullYear()
  const quarter = `Q${Math.floor(date.getMonth() / 3) + 1}`
  const month = `${year}-${pad(date.getMonth() + 1)}`
  const week = `W${pad(getWeekNumber(date))}`
  return { year, quarter, month, week }
}

export function buildLogPeriodRollupTargets(date = new Date()) {
  const parts = localParts(date)
  return [
    {
      type: 'WEEK',
      title: `${parts.year}-${parts.week}.md`,
      path: `logs/${parts.year}/${parts.quarter}/${parts.month}/${parts.week}/${parts.year}-${parts.week}.md`,
      label: `${parts.year} ${parts.week}`,
    },
    {
      type: 'MONTH',
      title: `${parts.month}.md`,
      path: `logs/${parts.year}/${parts.quarter}/${parts.month}/${parts.month}.md`,
      label: parts.month,
    },
    {
      type: 'QUARTER',
      title: `${parts.year}-${parts.quarter}.md`,
      path: `logs/${parts.year}/${parts.quarter}/${parts.year}-${parts.quarter}.md`,
      label: `${parts.year} ${parts.quarter}`,
    },
    {
      type: 'YEAR',
      title: `${parts.year}.md`,
      path: `logs/${parts.year}/${parts.year}.md`,
      label: String(parts.year),
    },
  ]
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function mergeArray(existing, additions) {
  const current = Array.isArray(existing) ? existing.filter((item) => typeof item === 'string') : []
  const next = Array.isArray(additions) ? additions.filter((item) => typeof item === 'string') : []
  return [...new Set([...current, ...next])]
}

function mergeRollupContent(existingContent, rollupBlock) {
  const existing = String(existingContent || '').trim()
  const startIndex = existing.indexOf(ROLLUP_START)
  const endIndex = existing.indexOf(ROLLUP_END)
  if (startIndex >= 0 && endIndex > startIndex) {
    return `${existing.slice(0, startIndex).trimEnd()}\n\n${rollupBlock}\n\n${existing.slice(endIndex + ROLLUP_END.length).trimStart()}`.trim()
  }
  return existing ? `${existing}\n\n${rollupBlock}` : rollupBlock
}

function buildRollupBlock(target, input) {
  const sourceLine = input.sourcePath && input.sourcePath !== target.path
    ? `- 最近下级记录：[[${input.sourcePath}]]`
    : '- 最近下级记录：当前周期记录'
  return [
    ROLLUP_START,
    `# ${target.label}`,
    '',
    '## 自动推进汇总',
    '',
    sourceLine,
    input.goalTitle ? `- 目标：${input.goalTitle}` : '- 目标：等待关联',
    input.actionTitle ? `- 最近行动：${input.actionTitle}` : undefined,
    input.resultLabel ? `- 最近结果：${input.resultLabel}` : undefined,
    input.conditionTitle ? `- 当前条件：${input.conditionTitle}` : undefined,
    input.diagnosisQuestion ? `- 诊断问题：${input.diagnosisQuestion}` : undefined,
    input.sourceKind ? `- 来源：${input.sourceKind}` : undefined,
    '',
    '## 自由复盘',
    '',
    '这里可以直接编辑。系统只会更新 goal-mate:rollup 区块，不覆盖区块外的文字。',
    ROLLUP_END,
  ].filter(Boolean).join('\n')
}

async function upsertPeriodLog(tx, target, input) {
  const linkedGoalIds = input.goalId ? [input.goalId] : []
  const linkedActionIds = input.actionId ? [input.actionId] : []
  const existingLog = await tx.logEntry.findUnique({ where: { userId_path: { userId: input.userId, path: target.path } } })
  const rollupBlock = buildRollupBlock(target, input)
  const content = mergeRollupContent(existingLog?.content, rollupBlock)
  const logEntry = await tx.logEntry.upsert({
    where: { userId_path: { userId: input.userId, path: target.path } },
    update: {
      title: target.title,
      content,
      linkedGoalIds: mergeArray(existingLog?.linkedGoalIds, linkedGoalIds),
      linkedActionIds: mergeArray(existingLog?.linkedActionIds, linkedActionIds),
    },
    create: {
      userId: input.userId,
      periodType: target.type,
      title: target.title,
      path: target.path,
      content,
      linkedGoalIds,
      linkedActionIds,
    },
  })

  const existingDocument = await tx.markdownDocument.findUnique({ where: { userId_path: { userId: input.userId, path: target.path } } })
  const documentContent = mergeRollupContent(existingDocument?.content || logEntry.content, rollupBlock)
  const document = await tx.markdownDocument.upsert({
    where: { userId_path: { userId: input.userId, path: target.path } },
    update: {
      title: target.title,
      type: target.type,
      content: documentContent,
      linkedGoalIds: mergeArray(existingDocument?.linkedGoalIds, linkedGoalIds),
      linkedActionIds: mergeArray(existingDocument?.linkedActionIds, linkedActionIds),
      source: existingDocument?.source || 'SYSTEM',
      frontmatter: {
        ...asObject(existingDocument?.frontmatter),
        rollup: { periodType: target.type },
      },
    },
    create: {
      userId: input.userId,
      type: target.type,
      title: target.title,
      path: target.path,
      content: documentContent,
      linkedGoalIds,
      linkedActionIds,
      source: 'SYSTEM',
      frontmatter: { kind: 'period_rollup', rollup: { periodType: target.type } },
    },
  })

  if (input.sourcePath && input.sourcePath !== target.path) {
    await tx.markdownDocumentLink.deleteMany({
      where: {
        userId: input.userId,
        fromDocumentId: document.id,
        targetPath: input.sourcePath,
        linkType: 'LOG_PARENT',
      },
    })
    const child = await tx.markdownDocument.findUnique({ where: { userId_path: { userId: input.userId, path: input.sourcePath } } })
    await tx.markdownDocumentLink.create({
      data: {
        userId: input.userId,
        fromDocumentId: document.id,
        toDocumentId: child?.id,
        targetPath: input.sourcePath,
        linkType: 'LOG_PARENT',
        context: input.sourceKind || 'rollup',
      },
    })
  }

  return { logEntry, markdownDocument: document }
}

export async function ensureLogPeriodRollups(prisma, input) {
  const date = input.date || new Date()
  const outputs = []
  for (const target of buildLogPeriodRollupTargets(date)) {
    outputs.push(await upsertPeriodLog(prisma, target, input))
  }
  return outputs
}
