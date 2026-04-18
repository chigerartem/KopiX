import { useEffect, useState } from "react";
import { createApi, TradeItem } from "../api/client";
import { useTma } from "../hooks/useTma";
import { Spinner } from "../components/Spinner";
import { ErrorMessage } from "../components/ErrorMessage";

const PAGE_SIZE = 20;

function StatusBadge({ status }: { status: string }) {
  const color =
    status === "filled"
      ? "var(--success)"
      : status === "failed"
      ? "var(--destructive)"
      : "var(--hint)";
  return (
    <span
      style={{
        fontSize: "0.72rem",
        color,
        border: `1px solid ${color}`,
        borderRadius: "0.25rem",
        padding: "0.1rem 0.35rem",
      }}
    >
      {status}
    </span>
  );
}

export function TradesPage() {
  const { initData } = useTma();

  const [items, setItems] = useState<TradeItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    const api = createApi(initData);
    api
      .getTrades({ limit: PAGE_SIZE, offset: 0 })
      .then((res) => {
        setItems(res.items);
        setTotal(res.total);
        setOffset(0);
      })
      .catch(() => setError("Не удалось загрузить сделки"))
      .finally(() => setLoading(false));
  }, []);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const api = createApi(initData);
      const nextOffset = offset + PAGE_SIZE;
      const res = await api.getTrades({ limit: PAGE_SIZE, offset: nextOffset });
      setItems((prev) => [...prev, ...res.items]);
      setTotal(res.total);
      setOffset(nextOffset);
    } catch {
      setError("Не удалось загрузить сделки");
    } finally {
      setLoadingMore(false);
    }
  }

  if (loading) return <Spinner />;
  if (error) return <ErrorMessage message={error} />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      <h2 style={{ margin: "0 0 0.5rem", fontSize: "1.2rem", fontWeight: 700 }}>
        Сделки
      </h2>

      {items.length === 0 && (
        <div style={{ color: "var(--hint)", textAlign: "center", padding: "2rem 0" }}>
          Сделок пока нет
        </div>
      )}

      {items.map((t) => (
        <div
          key={t.id}
          className="card"
          style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontWeight: 700 }}>{t.symbol}</span>
            <StatusBadge status={t.status} />
          </div>
          <div style={{ display: "flex", gap: "1rem", fontSize: "0.85rem" }}>
            <span
              style={{
                color: t.side === "BUY" ? "var(--success)" : "var(--destructive)",
                fontWeight: 600,
              }}
            >
              {t.side === "BUY" ? "↑ BUY" : "↓ SELL"}
            </span>
            {t.executedPrice !== null && (
              <span style={{ color: "var(--hint)" }}>
                @ {t.executedPrice.toFixed(4)}
              </span>
            )}
            {t.slippagePct !== null && (
              <span style={{ color: Math.abs(t.slippagePct) > 0.5 ? "var(--destructive)" : "var(--hint)" }}>
                slip {t.slippagePct > 0 ? "+" : ""}{t.slippagePct.toFixed(2)}%
              </span>
            )}
          </div>
          {t.failureReason && (
            <div style={{ fontSize: "0.78rem", color: "var(--destructive)" }}>
              {t.failureReason}
            </div>
          )}
        </div>
      ))}

      {items.length < total && (
        <button className="btn" onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? "Загружаем..." : "Загрузить ещё"}
        </button>
      )}
    </div>
  );
}
