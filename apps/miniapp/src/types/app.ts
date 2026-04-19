export type SubscriptionStatus =
  | "unknown"
  | "active"
  | "inactive"
  | "expired"
  /** User started checkout from Copy Settings; complete payment on provider (UI mock). */
  | "payment_pending";
