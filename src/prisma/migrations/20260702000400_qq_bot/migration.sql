-- QQ Bot integration.
-- Stores QQ chat bindings and processed message events for long-running gateway workers.

CREATE TABLE "QqChatBinding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "contextType" TEXT NOT NULL,
    "contextId" TEXT NOT NULL,
    "username" TEXT,
    "nickname" TEXT,
    "status" TEXT NOT NULL DEFAULT 'enabled',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "QqChatBinding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "QqMessageEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "contextType" TEXT NOT NULL,
    "contextId" TEXT NOT NULL,
    "messageText" TEXT,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'received',
    "agentThreadId" TEXT,
    "agentMessageId" TEXT,
    "replyMessageId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "QqMessageEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "QqChatBinding_contextType_contextId_key" ON "QqChatBinding"("contextType", "contextId");
CREATE UNIQUE INDEX "QqChatBinding_userId_contextType_contextId_key" ON "QqChatBinding"("userId", "contextType", "contextId");
CREATE INDEX "QqChatBinding_userId_idx" ON "QqChatBinding"("userId");
CREATE INDEX "QqChatBinding_contextType_idx" ON "QqChatBinding"("contextType");
CREATE INDEX "QqChatBinding_contextId_idx" ON "QqChatBinding"("contextId");
CREATE INDEX "QqChatBinding_status_idx" ON "QqChatBinding"("status");
CREATE UNIQUE INDEX "QqMessageEvent_eventId_key" ON "QqMessageEvent"("eventId");
CREATE INDEX "QqMessageEvent_userId_idx" ON "QqMessageEvent"("userId");
CREATE INDEX "QqMessageEvent_eventType_idx" ON "QqMessageEvent"("eventType");
CREATE INDEX "QqMessageEvent_contextType_idx" ON "QqMessageEvent"("contextType");
CREATE INDEX "QqMessageEvent_contextId_idx" ON "QqMessageEvent"("contextId");
CREATE INDEX "QqMessageEvent_status_idx" ON "QqMessageEvent"("status");
