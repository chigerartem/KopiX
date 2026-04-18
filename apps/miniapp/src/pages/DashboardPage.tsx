import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createApi, SubscriberProfile, Stats, TradeItem } from "../api/client";
import { useTma } from "../hooks/useTma";
import { useSse } from "../hooks/useSse";
import { Spinner } from "../components/Spinner";
import { ErrorMessage } from "../components/ErrorMessage";

function daysRemaining(expiresAt: string): number {
  return Math.max(
    0,
    Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86400000)
  );
}

function statusBadge(status: SubscriberProfile["status"]) {
  const map: Record<SubscriberProfile["status"], string> = {
    active: "🟢 Активен",
    paused: "⏸ Пауза",
    inactive: "⚪ Неактивен",
    suspended: "🔴 Заблокирован",
  };
  return map[status];
}

export function DashboardPage() {
  const { initData } = useTma();
  const api = createApi(initData);
  const navigate = useNavigate();

  const [profile, setProfile] = useState<SubscriberProfile | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [trades, setTrades] = useState<TradeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const [p, s, t] = await Promise.all([
        api.getProfile(),
        api.getStats(),
        api.getTrades({ limit: 5, offset: 0 }),
      ]);
      setProfile(p);
      setStats(s);
      setTrades(t.items);
    } catch {
      setError("Не удалось загрузить данные");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const handleSseEvent = useCallback(
    (event: { type: string; data: Record<string, unknown> }) => {
      if (event.type === "trade_executed") {
        api.getStats().then(setStats).catch(() => null);
      }
    },
    []
  );

  useSse(handleSseEvent);

  if (loading) return <Spinner />;
  if (error) return <ErrorMessage message={error} />;
  if (!profile || !stats) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <div className="card">
        <div style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: "0.5rem" }}>
          {statusBadge(profile.status)}
        </div>
        {profile.subscription ? (
          <div style={{ color: "var(--hint)", fontSize: "0.85rem" }}>
            {profile.subscription.planName} · ещё{" "}
            {daysRemaining(profile.subscription.expiresAt)} дн.
          </div>
        ) : (
          <div style={{ color: "var(--hint)", fontSize: "0.85rem" }}>Подписка не активна</div>
        )}
      </div>

      <div className="card">
        <div style={{ color: "var(--hint)", fontSize: "0.75rem", marginBottom: "0.25rem" }}>
          Режим копирования
        </div>
        <div style={{ fontWeight: 600 }}>
          {profile.copyMode === "fixed" && profile.fixedAmount !== null
            ? `Фиксированный: ${profile.fixedAmount} USDT`
            : profile.copyMode === "percentage" && profile.percentage !== null
            ? `${profile.percentage}% от баланса`
            : "Не настроен"}
        </div>
      </div>

      <div className="card" style={{ display: "flex", gap: "1rem" }}>
        <div style={{ flex: 1, textAlign: "center" }}>
          <div
            style={{
              fontSize: "1.1rem",
              fontWeight: 700,
              color: stats.realizedPnl >= 0 ? "var(--success)" : "var(--destructive)",
            }}
          >
            {stats.realizedPnl >= 0 ? "+" : ""}
            {stats.realizedPnl.toFixed(2)} $
          </div>
          <div style={{ color: "var(--hint)", fontSize: "0.7rem" }}>P&L</div>
        </div>
        <div style={{ flex: 1, textAlign: "center" }}>
          <div style={{ fontSize: "1.1rem", fontWeight: 700 }}>
            {stats.winRate !== null ? `${(stats.winRate * 100).toFixed(0)}%` : "—"}
          </div>
          <div style={{ color: "var(--hint)", fontSize: "0.7rem" }}>Win rate</div>
        </div>
        <div style={{ flex: 1, textAlign: "center" }}>
          <div style={{ fontSize: "1.1rem", fontWeight: 700 }}>{stats.totalTrades}</div>
          <div style={{ color: "var(--hint)", fontSize: "0.7rem" }}>Сделок</div>
        </div>
      </div>

      {!profile.hasExchangeConnected && (
        <button className="btn" onClick={() => navigate("/connect")}>
          Подключить BingX →
        </button>
      )}

      {!profile.subscription && (
        <button className="btn" onClick={() => navigate("/subscribe")}>
          Оформить подписку →
        </button>
      )}

      {trades.length > 0 && (
        <div className="card">
          <div style={{ fontWeight: 600, marginBottom: "0.5rem" }}>Последние сделки</div>
          {trades.map((t) => (
            <div
              key={t.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "0.4rem 0",
                borderBottom: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <span style={{ fontWeight: 600 }}>{t.symbol}</span>
              <span
                style={{
                  color: t.side === "buy" ? "var(--success)" : "var(--destructive)",
                  fontSize: "0.85rem",
                }}
              >
                {t.side}
              </span>
              <span style={{ color: "var(--hint)", fontSize: "0.85rem" }}>
                {t.orderedSize}
              </span>
              <span
                style={{
                  fontSize: "0.75rem",
                  color:
                    t.status === "filled"
                      ? "var(--success)"
                      : t.status === "failed"
                      ? "var(--destructive)"
                      : "var(--hint)",
                }}
              >
                {t.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
