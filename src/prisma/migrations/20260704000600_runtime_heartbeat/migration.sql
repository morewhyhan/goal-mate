-- Runtime process heartbeat for Web, QQ Worker, and Scheduler Worker.
-- This stores only process liveness metadata, never secrets or user content.

CREATE TABLE "RuntimeHeartbeat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "service" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'starting',
    "pid" INTEGER,
    "detail" TEXT,
    "payload" JSONB,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "RuntimeHeartbeat_service_key" ON "RuntimeHeartbeat"("service");
CREATE INDEX "RuntimeHeartbeat_status_idx" ON "RuntimeHeartbeat"("status");
CREATE INDEX "RuntimeHeartbeat_lastSeenAt_idx" ON "RuntimeHeartbeat"("lastSeenAt");
