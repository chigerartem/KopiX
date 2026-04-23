/**
 * Positions list from backend (`/balance/bingx/swap/positions`).
 */
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { BottomTabBar, type TabId } from "@/components/dashboard/BottomTabBar";
import { useAppState } from "@/contexts/AppStateContext";
import { TradeListCard } from "@/components/trades/TradeListCard";
import { useActivePageRefresh } from "@/hooks/useActivePageRefresh";
import { getSwapClosedTrades, getSwapPositions } from "@/services/api";
import type { OpenTradePosition } from "@/types/trade";
import styles from "./TradesPage.module.css";

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

export function TradesPage() {
  const navigate = useNavigate();
  const { tradesOpen, tradesClosed, setTradesOpen, setTradesClosed } = useAppState();
  const [query, setQuery] = useState("");
  const [showClosedTrades, setShowClosedTrades] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(
    tradesOpen.length > 0 || tradesClosed.length > 0,
  );

  useActivePageRefresh({
    refresh: async () => {
      try {
        const openRows = await getSwapPositions();
        setTradesOpen(openRows);
        if (showClosedTrades) {
          const closedRows = await getSwapClosedTrades();
          setTradesClosed(closedRows);
        }
        setHasLoadedOnce(true);
      } catch (err) {
        console.error("[Trades] positions load failed", err);
      }
    },
    intervalMs: 8000,
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const trades = showClosedTrades
      ? [...tradesOpen, ...tradesClosed].sort((a, b) => {
          const at = a.openedAt ? Date.parse(a.openedAt) : 0;
          const bt = b.openedAt ? Date.parse(b.openedAt) : 0;
          return bt - at;
        })
      : tradesOpen;
    if (!q) return trades;
    return trades.filter((t) => t.pair.toLowerCase().includes(q));
  }, [query, showClosedTrades, tradesClosed, tradesOpen]);
  const shouldShowEmpty = hasLoadedOnce && filtered.length === 0;
  const displayTrades = shouldShowEmpty ? [EMPTY_TRADE] : filtered;
  const showEmptyHint = shouldShowEmpty;
  const emptyText = showClosedTrades ? "No trades found" : "No open trades";

  return (
    <div className={styles.page}>
      <div className={styles.scroll}>
        <div className={styles.searchField} role="search">
          <span className={styles.searchIconWrap} aria-hidden>
            <Search className={styles.searchIcon} size={18} strokeWidth={2} />
          </span>
          <input
            className={styles.searchInput}
            type="search"
            inputMode="search"
            placeholder="Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search positions"
            autoComplete="off"
          />
        </div>

        <label className={styles.toggleRow}>
          <input
            className={styles.toggleInput}
            type="checkbox"
            checked={showClosedTrades}
            onChange={(e) => setShowClosedTrades(e.target.checked)}
          />
          <span className={styles.toggleLabel}>Show closed trades</span>
        </label>

        {showEmptyHint ? (
          <p className={styles.emptyHint}>{emptyText}</p>
        ) : null}

        <div className={styles.list} role="list">
          {displayTrades.map((trade) => (
            <div key={trade.id ?? trade.pair} role="listitem">
              <TradeListCard trade={trade} />
            </div>
          ))}
        </div>
      </div>

      <BottomTabBar
        active="trades"
        onChange={(id: TabId) => {
          if (id === "home") navigate("/dashboard");
        }}
      />
    </div>
  );
}
