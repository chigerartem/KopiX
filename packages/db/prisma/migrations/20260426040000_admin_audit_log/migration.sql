-- Append-only log of every privileged admin action: broadcasts, DMs,
-- plan price/active changes. Stores only the LAST 8 chars of the admin
-- secret used (actorSuffix) so the full secret never lands on disk in
-- another place.

CREATE TABLE "admin_audit_log" (
  "id"          UUID         NOT NULL DEFAULT gen_random_uuid(),
  "action"      VARCHAR(50)  NOT NULL,
  "actorSuffix" VARCHAR(16)  NOT NULL,
  "ip"          VARCHAR(45),
  "details"     JSONB,
  "createdAt"   TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),

  CONSTRAINT "admin_audit_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "admin_audit_log_action_createdAt_idx"
  ON "admin_audit_log" ("action", "createdAt");
