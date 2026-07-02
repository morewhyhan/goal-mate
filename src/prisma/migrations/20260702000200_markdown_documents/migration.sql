-- Goal Mate Markdown document store.
-- Stores Markdown files as path + content + metadata in the database and keeps explicit links between documents.

CREATE TABLE "MarkdownDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'note',
    "title" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "frontmatter" JSONB,
    "linkedGoalIds" JSONB,
    "linkedActionIds" JSONB,
    "source" TEXT NOT NULL DEFAULT 'user',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MarkdownDocument_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "MarkdownDocumentLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "fromDocumentId" TEXT NOT NULL,
    "toDocumentId" TEXT,
    "targetPath" TEXT NOT NULL,
    "linkType" TEXT NOT NULL DEFAULT 'wiki',
    "context" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarkdownDocumentLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MarkdownDocumentLink_fromDocumentId_fkey" FOREIGN KEY ("fromDocumentId") REFERENCES "MarkdownDocument" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MarkdownDocumentLink_toDocumentId_fkey" FOREIGN KEY ("toDocumentId") REFERENCES "MarkdownDocument" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "MarkdownDocument_userId_path_key" ON "MarkdownDocument"("userId", "path");
CREATE INDEX "MarkdownDocument_userId_idx" ON "MarkdownDocument"("userId");
CREATE INDEX "MarkdownDocument_type_idx" ON "MarkdownDocument"("type");
CREATE INDEX "MarkdownDocument_source_idx" ON "MarkdownDocument"("source");
CREATE INDEX "MarkdownDocument_updatedAt_idx" ON "MarkdownDocument"("updatedAt");
CREATE INDEX "MarkdownDocumentLink_userId_idx" ON "MarkdownDocumentLink"("userId");
CREATE INDEX "MarkdownDocumentLink_fromDocumentId_idx" ON "MarkdownDocumentLink"("fromDocumentId");
CREATE INDEX "MarkdownDocumentLink_toDocumentId_idx" ON "MarkdownDocumentLink"("toDocumentId");
CREATE INDEX "MarkdownDocumentLink_targetPath_idx" ON "MarkdownDocumentLink"("targetPath");
CREATE INDEX "MarkdownDocumentLink_linkType_idx" ON "MarkdownDocumentLink"("linkType");
