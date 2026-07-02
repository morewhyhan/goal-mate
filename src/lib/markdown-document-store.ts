type MarkdownDocumentInput = {
  userId: string
  path: string
  title?: string
  type?: 'YEAR' | 'QUARTER' | 'MONTH' | 'WEEK' | 'DAY' | 'GOAL' | 'NOTE' | 'SYSTEM'
  content: string
  frontmatter?: Record<string, unknown>
  linkedGoalIds?: string[]
  linkedActionIds?: string[]
  source?: 'USER' | 'AGENT' | 'SYSTEM' | 'SEED' | 'IMPORTED'
}

function inferTypeFromPath(path: string): MarkdownDocumentInput['type'] {
  if (/\/\d{4}-\d{2}-\d{2}\.md$/.test(path)) return 'DAY'
  if (/\/W\d{2}\/?$/.test(path) || /-W\d{2}\.md$/.test(path)) return 'WEEK'
  if (/\/\d{4}-\d{2}\/?$/.test(path) || /\d{4}-\d{2}\.md$/.test(path)) return 'MONTH'
  if (/\/Q[1-4]\/?$/.test(path) || /Q[1-4]\.md$/.test(path)) return 'QUARTER'
  if (/\/\d{4}\/?$/.test(path) || /\d{4}\.md$/.test(path)) return 'YEAR'
  if (path.startsWith('goals/')) return 'GOAL'
  return 'NOTE'
}

export function extractWikiLinks(content: string) {
  const matches = [...content.matchAll(/\[\[([^\]\n]+)\]\]/g)]
  return [...new Set(matches.map((match) => match[1].trim()).filter(Boolean))]
}

export async function upsertMarkdownDocument(prisma: any, input: MarkdownDocumentInput) {
  const title = input.title || input.path.split('/').pop() || input.path
  const document = await prisma.markdownDocument.upsert({
    where: { userId_path: { userId: input.userId, path: input.path } },
    update: {
      title,
      type: input.type || inferTypeFromPath(input.path),
      content: input.content,
      frontmatter: input.frontmatter,
      linkedGoalIds: input.linkedGoalIds || [],
      linkedActionIds: input.linkedActionIds || [],
      source: input.source || 'USER',
    },
    create: {
      userId: input.userId,
      path: input.path,
      title,
      type: input.type || inferTypeFromPath(input.path),
      content: input.content,
      frontmatter: input.frontmatter,
      linkedGoalIds: input.linkedGoalIds || [],
      linkedActionIds: input.linkedActionIds || [],
      source: input.source || 'USER',
    },
  })

  await prisma.markdownDocumentLink.deleteMany({ where: { userId: input.userId, fromDocumentId: document.id } })
  const linkTargets = extractWikiLinks(input.content)
  for (const targetPath of linkTargets) {
    const target = await prisma.markdownDocument.findUnique({
      where: { userId_path: { userId: input.userId, path: targetPath } },
    })
    await prisma.markdownDocumentLink.create({
      data: {
        userId: input.userId,
        fromDocumentId: document.id,
        toDocumentId: target?.id,
        targetPath,
        linkType: 'WIKI',
      },
    })
  }

  return document
}

export async function appendMarkdownDocument(prisma: any, input: MarkdownDocumentInput) {
  const existing = await prisma.markdownDocument.findUnique({
    where: { userId_path: { userId: input.userId, path: input.path } },
  })
  return upsertMarkdownDocument(prisma, {
    ...input,
    content: existing ? `${existing.content}\n\n${input.content}` : input.content,
  })
}
