-- Telegram Bot integration.
-- Binds Telegram chat ids to Goal Mate users and records incoming update processing.

CREATE TABLE "TelegramChatBinding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "username" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "title" TEXT,
    "status" TEXT NOT NULL DEFAULT 'enabled',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TelegramChatBinding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "TelegramUpdateEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "chatId" TEXT NOT NULL,
    "updateId" INTEGER NOT NULL,
    "messageText" TEXT,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'received',
    "agentThreadId" TEXT,
    "agentMessageId" TEXT,
    "replyMessageId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TelegramUpdateEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "TelegramChatBinding_chatId_key" ON "TelegramChatBinding"("chatId");
CREATE UNIQUE INDEX "TelegramChatBinding_userId_chatId_key" ON "TelegramChatBinding"("userId", "chatId");
CREATE INDEX "TelegramChatBinding_userId_idx" ON "TelegramChatBinding"("userId");
CREATE INDEX "TelegramChatBinding_chatId_idx" ON "TelegramChatBinding"("chatId");
CREATE INDEX "TelegramChatBinding_status_idx" ON "TelegramChatBinding"("status");
CREATE UNIQUE INDEX "TelegramUpdateEvent_updateId_key" ON "TelegramUpdateEvent"("updateId");
CREATE INDEX "TelegramUpdateEvent_userId_idx" ON "TelegramUpdateEvent"("userId");
CREATE INDEX "TelegramUpdateEvent_chatId_idx" ON "TelegramUpdateEvent"("chatId");
CREATE INDEX "TelegramUpdateEvent_status_idx" ON "TelegramUpdateEvent"("status");
