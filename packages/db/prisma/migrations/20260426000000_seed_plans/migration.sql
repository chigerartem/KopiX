-- Idempotent plan seed: ensures the active monthly plan exists.
-- ON CONFLICT updates price + isActive so re-running stays safe.
INSERT INTO plans (id, name, price, currency, "durationDays", "isActive", "createdAt")
VALUES ('plan-monthly-30d', 'Monthly', 10.00, 'USDT', 30, true, NOW())
ON CONFLICT (id) DO UPDATE
  SET name           = EXCLUDED.name,
      price          = EXCLUDED.price,
      currency       = EXCLUDED.currency,
      "durationDays" = EXCLUDED."durationDays",
      "isActive"     = EXCLUDED."isActive";

-- Deactivate placeholder plans that are not yet in use.
UPDATE plans SET "isActive" = false WHERE id IN ('plan-trial-7d', 'plan-quarterly-90d');
