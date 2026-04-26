-- Standardize all USDT/fiat amounts to DECIMAL(15, 2) — sufficient for ~$10
-- trillion accounts at cent precision. Contract sizes (DECIMAL(20, 8)) are
-- unchanged; that precision matters for crypto contract units.

ALTER TABLE plans
  ALTER COLUMN price TYPE DECIMAL(15, 2) USING ROUND(price, 2);

ALTER TABLE subscribers
  ALTER COLUMN "fixedAmount" TYPE DECIMAL(15, 2) USING ROUND("fixedAmount", 2),
  ALTER COLUMN "maxPositionUsdt" TYPE DECIMAL(15, 2) USING ROUND("maxPositionUsdt", 2);

ALTER TABLE subscriptions
  ALTER COLUMN "amountPaid" TYPE DECIMAL(15, 2) USING ROUND("amountPaid", 2);
