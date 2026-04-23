export enum SignalType {
  OpenLong = "open_long",
  OpenShort = "open_short",
  CloseLong = "close_long",
  CloseShort = "close_short",
  IncreaseLong = "increase_long",
  IncreaseShort = "increase_short",
  DecreaseLong = "decrease_long",
  DecreaseShort = "decrease_short",
}

export enum CopyMode {
  Fixed = "fixed",
  Percentage = "percentage",
}

export enum SubscriberStatus {
  Active = "active",
  Paused = "paused",
  Inactive = "inactive",
  Suspended = "suspended",
}

export enum SubscriptionStatus {
  Active = "active",
  Expired = "expired",
  Cancelled = "cancelled",
}

export enum TradeStatus {
  Pending = "pending",
  Filled = "filled",
  Partial = "partial",
  Failed = "failed",
  Skipped = "skipped",
}

export enum PositionSide {
  Long = "long",
  Short = "short",
}

export enum PositionStatus {
  Open = "open",
  Closed = "closed",
}

export enum OrderSide {
  Buy = "buy",
  Sell = "sell",
}
