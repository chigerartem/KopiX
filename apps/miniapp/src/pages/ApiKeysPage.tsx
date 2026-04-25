/**
 * /api-keys — list + manage the subscriber's BingX API key.
 *
 * The subscriber model stores at most one (apiKey, apiSecret) pair, so this
 * page renders either a "key connected" card with Disconnect, or an empty
 * state with an "Add API key" CTA leading to /api-keys/add.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { KeyRound, Plus, Trash2 } from "lucide-react";
import { SubPageHeader } from "@/components/layout/SubPageHeader";
import { useSubscriber } from "@/contexts/SubscriberContext";
import { deleteExchangeCredentials } from "@/services/api";
import styles from "./ApiKeysPage.module.css";

export function ApiKeysPage() {
  const navigate = useNavigate();
  const { me, loading, refresh } = useSubscriber();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connected = !!me?.hasExchangeConnected;

  async function handleDisconnect() {
    if (!window.confirm("Disconnect your BingX API key? Copy trading will pause.")) return;
    setBusy(true);
    setError(null);
    try {
      await deleteExchangeCredentials();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disconnect");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <SubPageHeader title="API keys" />

        {loading ? (
          <div className={styles.placeholder}>Loading…</div>
        ) : connected ? (
          <section className={styles.card} aria-label="Connected BingX key">
            <div className={styles.cardHead}>
              <span className={styles.iconWrap} aria-hidden>
                <KeyRound size={18} />
              </span>
              <div className={styles.cardHeadText}>
                <h2 className={styles.cardTitle}>BingX</h2>
                <p className={styles.cardSubtitle}>Trade-only key · connected</p>
              </div>
              <span className={styles.statusDot} aria-hidden />
            </div>

            <p className={styles.note}>
              Withdraw permission is rejected on connect — only spot/futures trading is allowed.
            </p>

            <button
              type="button"
              className={styles.dangerBtn}
              onClick={handleDisconnect}
              disabled={busy}
            >
              <Trash2 size={16} aria-hidden />
              <span>{busy ? "Disconnecting…" : "Disconnect"}</span>
            </button>
            {error && <p className={styles.error} role="alert">{error}</p>}
          </section>
        ) : (
          <section className={styles.card} aria-label="No API key">
            <div className={styles.emptyTitleRow}>
              <span className={styles.iconWrap} aria-hidden>
                <KeyRound size={18} />
              </span>
              <h2 className={styles.cardTitle}>No API key connected</h2>
            </div>
            <p className={styles.emptyText}>
              Connect a BingX trade-only API key so KopiX can copy the master's trades to your account.
            </p>
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={() => navigate("/api-keys/add")}
            >
              <Plus size={18} aria-hidden />
              <span>Add API key</span>
            </button>
          </section>
        )}
      </div>
    </div>
  );
}
