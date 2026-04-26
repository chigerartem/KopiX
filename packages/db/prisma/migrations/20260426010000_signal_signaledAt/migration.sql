-- Persistent master-exchange event timestamp for each signal.
-- Existing rows backfill from createdAt; new rows must populate explicitly
-- but the column carries DEFAULT NOW() to keep upserts safe.
ALTER TABLE trade_signals
  ADD COLUMN "signaledAt" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW();

UPDATE trade_signals SET "signaledAt" = "createdAt";

CREATE INDEX IF NOT EXISTS "trade_signals_createdAt_idx" ON trade_signals ("createdAt");
