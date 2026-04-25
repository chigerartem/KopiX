/**
 * /api-keys/add — paste BingX API key + secret, validate, store.
 *
 * Backend rejects keys with withdraw permission (packages/exchange
 * `validateCredentials`). On success the credentials are encrypted and
 * stored on the subscriber row; we redirect back to /api-keys.
 */
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldCheck, AlertTriangle } from "lucide-react";
import { SubPageHeader } from "@/components/layout/SubPageHeader";
import { useSubscriber } from "@/contexts/SubscriberContext";
import { postExchangeValidate } from "@/services/api";
import styles from "./ApiKeysAddPage.module.css";

export function ApiKeysAddPage() {
  const navigate = useNavigate();
  const { refresh } = useSubscriber();
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = apiKey.trim().length > 0 && apiSecret.trim().length > 0 && !busy;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const result = await postExchangeValidate(apiKey.trim(), apiSecret.trim());
      if (!result.ok) {
        if (result.hasWithdrawPermission) {
          setError(
            "This API key has withdraw permission. Use a trade-only key — disable withdraw in BingX and try again.",
          );
        } else {
          setError(result.error ?? "Validation failed");
        }
        return;
      }
      await refresh();
      navigate("/api-keys");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Validation failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <SubPageHeader title="Add API key" />

        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.notice}>
            <span className={styles.noticeIcon} aria-hidden>
              <ShieldCheck size={18} />
            </span>
            <div>
              <p className={styles.noticeTitle}>Trade-only key required</p>
              <p className={styles.noticeText}>
                Create a BingX API key with <b>spot/futures trading</b> enabled and
                <b> withdraw disabled</b>. Keys with withdraw permission are rejected.
              </p>
            </div>
          </div>

          <label className={styles.field}>
            <span className={styles.label}>API key</span>
            <input
              className={styles.input}
              type="text"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Paste your BingX API key"
              disabled={busy}
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>API secret</span>
            <input
              className={styles.input}
              type="password"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              value={apiSecret}
              onChange={(e) => setApiSecret(e.target.value)}
              placeholder="Paste your BingX API secret"
              disabled={busy}
            />
          </label>

          {error && (
            <div className={styles.error} role="alert">
              <AlertTriangle size={16} aria-hidden />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            className={styles.primaryBtn}
            disabled={!canSubmit}
          >
            {busy ? "Validating…" : "Validate & save"}
          </button>
        </form>
      </div>
    </div>
  );
}
