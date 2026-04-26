-- Switch subscriber-owned FKs to ON DELETE CASCADE so wiping a subscriber
-- (e.g. GDPR removal) cleans up dependent rows in one statement instead of
-- failing on the FK constraint. Plan and TradeSignal stay RESTRICT to
-- prevent accidental destruction of historical pricing/audit data.

ALTER TABLE "subscriptions" DROP CONSTRAINT "subscriptions_subscriberId_fkey";
ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_subscriberId_fkey"
  FOREIGN KEY ("subscriberId") REFERENCES "subscribers"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "copied_trades" DROP CONSTRAINT "copied_trades_subscriberId_fkey";
ALTER TABLE "copied_trades"
  ADD CONSTRAINT "copied_trades_subscriberId_fkey"
  FOREIGN KEY ("subscriberId") REFERENCES "subscribers"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "positions" DROP CONSTRAINT "positions_subscriberId_fkey";
ALTER TABLE "positions"
  ADD CONSTRAINT "positions_subscriberId_fkey"
  FOREIGN KEY ("subscriberId") REFERENCES "subscribers"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "pnl_snapshots" DROP CONSTRAINT "pnl_snapshots_subscriberId_fkey";
ALTER TABLE "pnl_snapshots"
  ADD CONSTRAINT "pnl_snapshots_subscriberId_fkey"
  FOREIGN KEY ("subscriberId") REFERENCES "subscribers"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Hot-path index: filter copied_trades by status per subscriber
-- (failed/pending dashboards, retry-queue scans).
CREATE INDEX IF NOT EXISTS "copied_trades_subscriberId_status_idx"
  ON "copied_trades" ("subscriberId", "status");
