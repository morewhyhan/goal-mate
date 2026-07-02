-- Agent tool runtime and proactive scheduler.
-- Stores controlled Agent operations, reminder rules, and scheduler send events.

CREATE TABLE "AgentToolAction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "inputSummary" TEXT NOT NULL,
    "input" JSONB,
    "result" JSONB,
    "targetType" TEXT,
    "targetId" TEXT,
    "riskLevel" TEXT NOT NULL DEFAULT 'low',
    "requiresConfirmation" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'drafted',
    "errorMessage" TEXT,
    "agentThreadId" TEXT,
    "agentMessageId" TEXT,
    "externalActionRequestId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AgentToolAction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ReminderRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "goalId" TEXT,
    "reminderType" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'qq',
    "schedule" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Shanghai',
    "maxPerDay" INTEGER NOT NULL DEFAULT 2,
    "quietHours" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReminderRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "SchedulerEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "reminderRuleId" TEXT,
    "eventType" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "dueKey" TEXT NOT NULL,
    "scheduledFor" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "messageText" TEXT,
    "payload" JSONB,
    "sentAt" DATETIME,
    "agentThreadId" TEXT,
    "agentMessageId" TEXT,
    "externalMessageId" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SchedulerEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "AgentToolAction_userId_idx" ON "AgentToolAction"("userId");
CREATE INDEX "AgentToolAction_source_idx" ON "AgentToolAction"("source");
CREATE INDEX "AgentToolAction_toolName_idx" ON "AgentToolAction"("toolName");
CREATE INDEX "AgentToolAction_permission_idx" ON "AgentToolAction"("permission");
CREATE INDEX "AgentToolAction_status_idx" ON "AgentToolAction"("status");
CREATE INDEX "AgentToolAction_targetType_targetId_idx" ON "AgentToolAction"("targetType", "targetId");
CREATE INDEX "AgentToolAction_createdAt_idx" ON "AgentToolAction"("createdAt");

CREATE INDEX "ReminderRule_userId_idx" ON "ReminderRule"("userId");
CREATE INDEX "ReminderRule_goalId_idx" ON "ReminderRule"("goalId");
CREATE INDEX "ReminderRule_reminderType_idx" ON "ReminderRule"("reminderType");
CREATE INDEX "ReminderRule_channel_idx" ON "ReminderRule"("channel");
CREATE INDEX "ReminderRule_enabled_idx" ON "ReminderRule"("enabled");

CREATE UNIQUE INDEX "SchedulerEvent_userId_eventType_channel_dueKey_key" ON "SchedulerEvent"("userId", "eventType", "channel", "dueKey");
CREATE INDEX "SchedulerEvent_userId_idx" ON "SchedulerEvent"("userId");
CREATE INDEX "SchedulerEvent_reminderRuleId_idx" ON "SchedulerEvent"("reminderRuleId");
CREATE INDEX "SchedulerEvent_eventType_idx" ON "SchedulerEvent"("eventType");
CREATE INDEX "SchedulerEvent_channel_idx" ON "SchedulerEvent"("channel");
CREATE INDEX "SchedulerEvent_status_idx" ON "SchedulerEvent"("status");
CREATE INDEX "SchedulerEvent_scheduledFor_idx" ON "SchedulerEvent"("scheduledFor");
