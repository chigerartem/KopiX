import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { LineChart } from "lucide-react";
import type { OpenTradePosition } from "@/types/trade";
import styles from "./OpenTradesSection.module.css";

export type TradePreview = OpenTradePosition;

const EMPTY_TRADE: OpenTradePosition = {
  id: "empty-open-trade",
  pair: "No open trades",
  side: "LONG",
  leverage: 0,
  sizeUsdt: 0,
  entryPrice: 0,
  currentPrice: 0,
  pnlUsd: 0,
  pnlPct: 0,
};

function formatPrice(n: number): string {
  return n.toLocaleString("en-US", {
    maximumFractionDigits: n % 1 === 0 ? 0 : 2,
    minimumFractionDigits: 0,
  });
}

function formatPnlLine(trade: OpenTradePosition): string {
  const usd =
    (trade.pnlUsd > 0 ? "+" : "") +
    trade.pnlUsd.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) +
    " USDT";
  const pct =
    "(" +
    (trade.pnlPct > 0 ? "+" : "") +
    trade.pnlPct.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) +
    "%)";
  return `${usd} ${pct}`;
}

type OpenTradesSectionProps = {
  trades?: OpenTradePosition[];
  onManageClick?: () => void;
};

function TradeSlideCard({
  trade,
  slideIndex,
  slideCount,
}: {
  trade: OpenTradePosition;
  slideIndex: number;
  slideCount: number;
}) {
  const isPlaceholder = trade.id === EMPTY_TRADE.id;
  const pnlPositive = trade.pnlUsd > 0;
  const pnlNegative = trade.pnlUsd < 0;
  const pnlClass = pnlPositive
    ? styles.pnlUp
    : pnlNegative
      ? styles.pnlDown
      : styles.pnlFlat;

  return (
    <article
      className={`${styles.slideCard} ${isPlaceholder ? styles.slideCardPlaceholder : ""}`}
      data-carousel-slide={slideIndex}
      aria-roledescription="slide"
      aria-label={`Position ${slideIndex + 1} of ${slideCount}`}
    >
      <div className={styles.rowTop}>
        <span className={`${styles.pair} ${isPlaceholder ? styles.placeholderText : ""}`}>
          {trade.pair}
        </span>
        <span
          className={`${styles.side} ${isPlaceholder ? styles.placeholderText : trade.side === "LONG" ? styles.long : styles.short}`}
        >
          {isPlaceholder ? "--" : `${trade.side} ×${trade.leverage}`}
        </span>
      </div>

      <div className={styles.rowMid}>
        <div className={styles.kv}>
          <span className={styles.k}>Entry</span>
          <span className={`${styles.v} ${isPlaceholder ? styles.placeholderText : ""}`}>
            {isPlaceholder ? "-" : formatPrice(trade.entryPrice)}
          </span>
        </div>
        <div className={styles.kv}>
          <span className={styles.k}>Current</span>
          <span className={`${styles.v} ${isPlaceholder ? styles.placeholderText : ""}`}>
            {isPlaceholder ? "-" : formatPrice(trade.currentPrice)}
          </span>
        </div>
      </div>

      <div className={styles.rowBot}>
        <div className={styles.marginBlock}>
          <span className={styles.marginLabel}>Margin</span>
          <span className={`${styles.marginValue} ${isPlaceholder ? styles.placeholderText : ""}`}>
            {isPlaceholder ? "0 USDT" : `${formatPrice(trade.sizeUsdt)} USDT`}
          </span>
        </div>
        <div className={styles.pnlBlock}>
          <span className={styles.pnlLabel}>PNL</span>
          <p className={`${styles.pnlLine} ${isPlaceholder ? styles.placeholderText : pnlClass}`}>
            {isPlaceholder ? "0.00 USDT (0.00%)" : formatPnlLine(trade)}
          </p>
        </div>
      </div>
    </article>
  );
}

export function OpenTradesSection({
  trades = [],
  onManageClick,
}: OpenTradesSectionProps) {
  const isEmpty = trades.length === 0;
  const displayTrades = trades.length > 0 ? trades : [EMPTY_TRADE];
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const updateActiveFromScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || displayTrades.length === 0) return;
    const w = el.clientWidth;
    if (w <= 0) return;
    const cs = getComputedStyle(el);
    const peek =
      parseFloat(cs.getPropertyValue("--carousel-peek")) || 36;
    const gap =
      parseFloat(cs.getPropertyValue("--carousel-gap")) ||
      parseFloat(cs.gap) ||
      12;
    const stride = w - peek + gap;
    if (stride <= 0) return;
    const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
    const x = el.scrollLeft;
    const maxIdx = displayTrades.length - 1;
    let idx = Math.round(x / stride);
    if (x >= maxScroll - 2) idx = maxIdx;
    else if (x <= 2) idx = 0;
    setActiveIndex(Math.min(Math.max(idx, 0), maxIdx));
  }, [displayTrades.length]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(updateActiveFromScroll);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("scrollend", onScroll as EventListener);
    const ro = new ResizeObserver(() => updateActiveFromScroll());
    ro.observe(el);
    updateActiveFromScroll();
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("scrollend", onScroll as EventListener);
      ro.disconnect();
    };
  }, [updateActiveFromScroll, displayTrades.length]);

  const n = displayTrades.length;
  const statusStyle = {
    position: "absolute",
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: "hidden",
    clip: "rect(0,0,0,0)",
    whiteSpace: "nowrap",
    border: 0,
  } as CSSProperties;

  return (
    <section className={styles.section} aria-labelledby="positions-title">
      <header className={styles.head}>
        <h2 id="positions-title" className={styles.title}>
          <LineChart
            className={styles.titleIcon}
            size={17}
            strokeWidth={2}
            aria-hidden
          />
          <span>Recent trades</span>
        </h2>
        {onManageClick ? (
          <button type="button" className={styles.manage} onClick={onManageClick}>
            Manage
          </button>
        ) : null}
      </header>

      <div className={styles.carouselWrap}>
        {isEmpty ? (
          <div className={styles.emptyCenter} aria-label="No open positions">
            <div className={styles.emptyCardWrap}>
              <TradeSlideCard trade={EMPTY_TRADE} slideIndex={0} slideCount={1} />
            </div>
          </div>
        ) : (
          <div
            ref={scrollRef}
            className={styles.carousel}
            tabIndex={0}
            aria-label="Swipe to browse open positions"
          >
            {displayTrades.map((trade, i) => (
              <TradeSlideCard
                key={trade.id}
                trade={trade}
                slideIndex={i}
                slideCount={n}
              />
            ))}
          </div>
        )}

        {!isEmpty && n > 1 ? (
          <div className={styles.indicators} aria-hidden="true">
            {displayTrades.map((_, i) => (
              <span
                key={i}
                className={`${styles.indicator} ${i === activeIndex ? styles.indicatorActive : ""}`}
              />
            ))}
          </div>
        ) : null}
      </div>

      <span style={statusStyle} aria-live="polite">
        {n > 0 ? `Position ${activeIndex + 1} of ${n}` : ""}
      </span>
    </section>
  );
}
