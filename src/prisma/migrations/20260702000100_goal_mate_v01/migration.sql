-- Drop old Ignite template task table. Goal Mate v0.1 uses goal/action/log models instead.
PRAGMA foreign_keys=off;
DROP TABLE "task";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "Goal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "rawInput" TEXT NOT NULL,
    "interpretedGoal" TEXT,
    "horizonStart" DATETIME,
    "horizonEnd" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "isCurrentFocus" BOOLEAN NOT NULL DEFAULT false,
    "currentReasoningCardId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Goal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GoalReasoningCard" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "purposeSummary" TEXT NOT NULL,
    "successSignals" JSONB NOT NULL,
    "sufficientConditionSet" TEXT NOT NULL,
    "currentGapConditionId" TEXT,
    "recommendedFocus" TEXT NOT NULL,
    "confidenceScore" REAL NOT NULL DEFAULT 0.6,
    "evidence" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GoalReasoningCard_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GoalReasoningCard_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "KeyResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "metricType" TEXT NOT NULL DEFAULT 'text',
    "currentValue" TEXT,
    "targetValue" TEXT,
    "progress" REAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "whyNecessary" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "KeyResult_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "KeyResult_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GoalCondition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'hard',
    "status" TEXT NOT NULL DEFAULT 'missing',
    "whyRequired" TEXT NOT NULL,
    "evidence" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GoalCondition_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GoalCondition_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StagePlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "stageGoal" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME,
    "linkedConditionIds" JSONB NOT NULL,
    "successSignals" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StagePlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StagePlan_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DailyAction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "stagePlanId" TEXT,
    "conditionId" TEXT NOT NULL,
    "actionDate" DATETIME NOT NULL,
    "title" TEXT NOT NULL,
    "reason" TEXT,
    "doneWhen" TEXT NOT NULL,
    "minimumStep" TEXT NOT NULL,
    "estimatedMinutes" INTEGER NOT NULL DEFAULT 20,
    "fallbackAction" TEXT NOT NULL,
    "checkinQuestion" TEXT,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DailyAction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DailyAction_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DailyAction_stagePlanId_fkey" FOREIGN KEY ("stagePlanId") REFERENCES "StagePlan" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DailyAction_conditionId_fkey" FOREIGN KEY ("conditionId") REFERENCES "GoalCondition" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Checkin" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "reasonCategory" TEXT,
    "userFeedback" TEXT,
    "adjustment" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Checkin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Checkin_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Checkin_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "DailyAction" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Diagnosis" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "actionId" TEXT,
    "checkinId" TEXT,
    "category" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "adjustmentType" TEXT NOT NULL,
    "nextQuestion" TEXT NOT NULL,
    "proposedNextAction" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Diagnosis_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Diagnosis_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Diagnosis_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "DailyAction" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Diagnosis_checkinId_fkey" FOREIGN KEY ("checkinId") REFERENCES "Checkin" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "periodStart" DATETIME NOT NULL,
    "periodEnd" DATETIME NOT NULL,
    "progressSummary" TEXT NOT NULL,
    "conditionChanges" JSONB NOT NULL,
    "blockerSummary" TEXT NOT NULL,
    "nextFocus" TEXT NOT NULL,
    "logEntryId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Review_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Review_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Review_logEntryId_fkey" FOREIGN KEY ("logEntryId") REFERENCES "LogEntry" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LogEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "periodType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "linkedGoalIds" JSONB,
    "linkedActionIds" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LogEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentThread" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "goalId" TEXT,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AgentThread_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentThread_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "structuredOutputType" TEXT,
    "structuredOutput" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "AgentThread" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ModelConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "reasoningModel" TEXT,
    "apiBase" TEXT NOT NULL,
    "apiKeyRef" TEXT NOT NULL,
    "usage" TEXT NOT NULL DEFAULT 'chat',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "temperature" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ModelConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserSetting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "general" JSONB NOT NULL,
    "goals" JSONB NOT NULL,
    "logs" JSONB NOT NULL,
    "today" JSONB NOT NULL,
    "agent" JSONB NOT NULL,
    "notifications" JSONB NOT NULL,
    "dataPrivacy" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "IntegrationAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "accountLabel" TEXT,
    "status" TEXT NOT NULL DEFAULT 'disabled',
    "permissions" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "IntegrationAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExternalActionRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "requiresConfirmation" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ExternalActionRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Goal_userId_idx" ON "Goal"("userId");
CREATE INDEX "Goal_userId_isCurrentFocus_idx" ON "Goal"("userId", "isCurrentFocus");
CREATE INDEX "Goal_status_idx" ON "Goal"("status");
CREATE INDEX "GoalReasoningCard_userId_idx" ON "GoalReasoningCard"("userId");
CREATE INDEX "GoalReasoningCard_goalId_idx" ON "GoalReasoningCard"("goalId");
CREATE UNIQUE INDEX "GoalReasoningCard_goalId_version_key" ON "GoalReasoningCard"("goalId", "version");
CREATE INDEX "KeyResult_userId_idx" ON "KeyResult"("userId");
CREATE INDEX "KeyResult_goalId_idx" ON "KeyResult"("goalId");
CREATE INDEX "GoalCondition_userId_idx" ON "GoalCondition"("userId");
CREATE INDEX "GoalCondition_goalId_idx" ON "GoalCondition"("goalId");
CREATE INDEX "GoalCondition_status_idx" ON "GoalCondition"("status");
CREATE INDEX "StagePlan_userId_idx" ON "StagePlan"("userId");
CREATE INDEX "StagePlan_goalId_idx" ON "StagePlan"("goalId");
CREATE INDEX "StagePlan_status_idx" ON "StagePlan"("status");
CREATE INDEX "DailyAction_userId_idx" ON "DailyAction"("userId");
CREATE INDEX "DailyAction_goalId_idx" ON "DailyAction"("goalId");
CREATE INDEX "DailyAction_conditionId_idx" ON "DailyAction"("conditionId");
CREATE INDEX "DailyAction_actionDate_idx" ON "DailyAction"("actionDate");
CREATE INDEX "DailyAction_status_idx" ON "DailyAction"("status");
CREATE INDEX "Checkin_userId_idx" ON "Checkin"("userId");
CREATE INDEX "Checkin_goalId_idx" ON "Checkin"("goalId");
CREATE INDEX "Checkin_actionId_idx" ON "Checkin"("actionId");
CREATE INDEX "Checkin_result_idx" ON "Checkin"("result");
CREATE INDEX "Diagnosis_userId_idx" ON "Diagnosis"("userId");
CREATE INDEX "Diagnosis_goalId_idx" ON "Diagnosis"("goalId");
CREATE INDEX "Diagnosis_category_idx" ON "Diagnosis"("category");
CREATE INDEX "Review_userId_idx" ON "Review"("userId");
CREATE INDEX "Review_goalId_idx" ON "Review"("goalId");
CREATE INDEX "Review_type_idx" ON "Review"("type");
CREATE INDEX "LogEntry_userId_idx" ON "LogEntry"("userId");
CREATE INDEX "LogEntry_periodType_idx" ON "LogEntry"("periodType");
CREATE UNIQUE INDEX "LogEntry_userId_path_key" ON "LogEntry"("userId", "path");
CREATE INDEX "AgentThread_userId_idx" ON "AgentThread"("userId");
CREATE INDEX "AgentThread_goalId_idx" ON "AgentThread"("goalId");
CREATE INDEX "AgentThread_status_idx" ON "AgentThread"("status");
CREATE INDEX "AgentMessage_userId_idx" ON "AgentMessage"("userId");
CREATE INDEX "AgentMessage_threadId_idx" ON "AgentMessage"("threadId");
CREATE INDEX "AgentMessage_role_idx" ON "AgentMessage"("role");
CREATE INDEX "ModelConfig_userId_idx" ON "ModelConfig"("userId");
CREATE INDEX "ModelConfig_provider_idx" ON "ModelConfig"("provider");
CREATE INDEX "ModelConfig_usage_idx" ON "ModelConfig"("usage");
CREATE UNIQUE INDEX "UserSetting_userId_key" ON "UserSetting"("userId");
CREATE INDEX "IntegrationAccount_userId_idx" ON "IntegrationAccount"("userId");
CREATE INDEX "IntegrationAccount_provider_idx" ON "IntegrationAccount"("provider");
CREATE INDEX "IntegrationAccount_status_idx" ON "IntegrationAccount"("status");
CREATE INDEX "ExternalActionRequest_userId_idx" ON "ExternalActionRequest"("userId");
CREATE INDEX "ExternalActionRequest_provider_idx" ON "ExternalActionRequest"("provider");
CREATE INDEX "ExternalActionRequest_status_idx" ON "ExternalActionRequest"("status");
