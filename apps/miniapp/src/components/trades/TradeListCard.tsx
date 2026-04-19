import type { OpenTradePosition } from "@/types/trade";
import styles from "./TradeListCard.module.css";

function formatPrice(n: number): string {
  return n.toLocaleString("en-US", {
    maximumFractionDigits: n % 1 === 0 ? 0 : 4,
    minimumFractionDigits: 0,
  });
}

function formatTimeFooter(iso?: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

type TradeListCardProps = {
  trade: OpenTradePosition;
};

export function TradeListCard({ trade }: TradeListCardProps) {
  const isPlaceholder = trade.id === "empty-open-trade";
  const isClosed = trade.status === "closed";
  const pnlPositive = trade.pnlUsd > 0;
  const pnlNegative = trade.pnlUsd < 0;
  const pnlTone = pnlPositive
    ? styles.toneUp
    : pnlNegative
      ? styles.toneDown
      : styles.toneFlat;

  const usdStr =
    (trade.pnlUsd > 0 ? "+" : "") +
    trade.pnlUsd.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) +
    " USDT";
  const pctStr =
    (trade.pnlPct > 0 ? "+" : "") +
    trade.pnlPct.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) +
    "%";

  const timeStr = formatTimeFooter(trade.openedAt);

  return (
    <article className={`${styles.card} ${isPlaceholder ? styles.cardPlaceholder : ""}`}>
      <div className={styles.top}>
        <div className={styles.topLeft}>
          <div className={`${styles.pair} ${isPlaceholder ? styles.placeholderText : ""}`}>
            {trade.pair}
          </div>
          <div className={styles.positionRow}>
            {isPlaceholder ? (
              <span className={styles.placeholderText}>--</span>
            ) : (
              <>
                <span className={styles.side}>{trade.side}</span>
                <span className={styles.sep} aria-hidden>
                  ·
                </span>
                <span className={styles.leverage}>{trade.leverage}x</span>
              </>
            )}
          </div>
        </div>
        <div className={`${styles.pnlBlock} ${isPlaceholder ? styles.toneFlat : pnlTone}`}>
          <div className={`${styles.pnlUsd} ${isPlaceholder ? styles.placeholderText : ""}`}>
            {isPlaceholder ? "0.00 USDT" : usdStr}
          </div>
          <div className={`${styles.pnlPct} ${isPlaceholder ? styles.placeholderText : ""}`}>
            {isPlaceholder ? "0.00%" : pctStr}
          </div>
        </div>
      </div>

      <div className={styles.metrics}>
        <div className={styles.metric}>
          <span className={`${styles.metricValue} ${isPlaceholder ? styles.placeholderText : ""}`}>
            {isPlaceholder ? "-" : formatPrice(trade.entryPrice)}
          </span>
          <span className={styles.metricLabel}>Entry</span>
        </div>
        <div className={styles.metric}>
          <span className={`${styles.metricValue} ${isPlaceholder ? styles.placeholderText : ""}`}>
            {isPlaceholder ? "-" : formatPrice(trade.currentPrice)}
          </span>
          <span className={styles.metricLabel}>{isClosed ? "Exit" : "Current"}</span>
        </div>
        <div className={styles.metric}>
          <span className={`${styles.metricValue} ${isPlaceholder ? styles.placeholderText : ""}`}>
            {isPlaceholder ? "0 USDT" : `${formatPrice(trade.sizeUsdt)} USDT`}
          </span>
          <span className={styles.metricLabel}>Margin</span>
        </div>
      </div>

      {timeStr ? (
        <time className={styles.time} dateTime={trade.openedAt}>
          {timeStr}
        </time>
      ) : null}
    </article>
  );
}
