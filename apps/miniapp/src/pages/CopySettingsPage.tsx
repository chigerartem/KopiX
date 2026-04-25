/**
 * /copy-settings — choose copy mode + sizing + pause/resume.
 *
 * Backend (`PATCH /api/subscribers/me`) validates that:
 *   - mode=fixed requires fixedAmount > 0
 *   - mode=percentage requires 0 < percentage <= 100
 *   - resume requires connected API keys + an active subscription
 */
import { useEffect, useState, type FormEvent } from "react";
import { AlertTriangle } from "lucide-react";
import { SubPageHeader } from "@/components/layout/SubPageHeader";
import { useSubscriber } from "@/contexts/SubscriberContext";
import { patchSubscriberMe } from "@/services/api";
import styles from "./CopySettingsPage.module.css";

type Mode = "fixed" | "percentage";

export function CopySettingsPage() {
  const { me, loading, refresh } = useSubscriber();

  const [mode, setMode] = useState<Mode>("fixed");
  const [fixedAmount, setFixedAmount] = useState<string>("");
  const [percentage, setPercentage] = useState<string>("");
  const [maxPosition, setMaxPosition] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [toggleBusy, setToggleBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hydrate form from server state
  useEffect(() => {
    if (!me) return;
    setMode(me.copyMode);
    setFixedAmount(me.fixedAmount != null ? String(me.fixedAmount) : "");
    setPercentage(me.percentage != null ? String(me.percentage) : "");
    setMaxPosition(me.maxPositionUsdt != null ? String(me.maxPositionUsdt) : "");
  }, [me]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy || !me) return;
    setError(null);

    const patch: Parameters<typeof patchSubscriberMe>[0] = { copyMode: mode };
    if (mode === "fixed") {
      const n = Number(fixedAmount);
      if (!Number.isFinite(n) || n <= 0) {
        setError("Enter a fixed amount in USDT greater than 0.");
        return;
      }
      patch.fixedAmount = n;
    } else {
      const n = Number(percentage);
      if (!Number.isFinite(n) || n <= 0 || n > 100) {
        setError("Enter a percentage between 0 and 100.");
        return;
      }
      patch.percentage = n;
    }
    if (maxPosition.trim() === "") {
      patch.maxPositionUsdt = null;
    } else {
      const n = Number(maxPosition);
      if (!Number.isFinite(n) || n <= 0) {
        setError("Max position cap must be a positive number, or empty.");
        return;
      }
      patch.maxPositionUsdt = n;
    }

    setBusy(true);
    try {
      await patchSubscriberMe(patch);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setBusy(false);
    }
  }

  async function handleToggle() {
    if (!me || toggleBusy) return;
    const action = me.status === "active" ? "pause" : "resume";
    setError(null);
    setToggleBusy(true);
    try {
      await patchSubscriberMe({ action });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update status");
    } finally {
      setToggleBusy(false);
    }
  }

  const status = me?.status ?? "inactive";
  const toggleLabel =
    status === "active" ? "Pause" : status === "paused" ? "Resume" : "—";
  const toggleDisabled = !me || toggleBusy || status === "inactive";

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <SubPageHeader title="Copy settings" />

        {loading && !me ? (
          <div className={styles.placeholder}>Loading…</div>
        ) : (
          <form className={styles.form} onSubmit={handleSubmit}>
            <div className={styles.section}>
              <span className={styles.label}>Copy mode</span>
              <div className={styles.segmented} role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "fixed"}
                  className={`${styles.segment} ${mode === "fixed" ? styles.segmentActive : ""}`}
                  onClick={() => setMode("fixed")}
                  disabled={busy}
                >
                  Fixed (USDT)
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "percentage"}
                  className={`${styles.segment} ${mode === "percentage" ? styles.segmentActive : ""}`}
                  onClick={() => setMode("percentage")}
                  disabled={busy}
                >
                  Percentage
                </button>
              </div>
              <p className={styles.hint}>
                {mode === "fixed"
                  ? "Each copied trade uses a fixed USDT notional, regardless of master size."
                  : "Each copied trade uses a percentage of your futures balance."}
              </p>
            </div>

            {mode === "fixed" ? (
              <div className={styles.section}>
                <span className={styles.label}>Fixed amount (USDT)</span>
                <input
                  className={styles.input}
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  value={fixedAmount}
                  onChange={(e) => setFixedAmount(e.target.value)}
                  placeholder="50"
                  disabled={busy}
                />
              </div>
            ) : (
              <div className={styles.section}>
                <span className={styles.label}>Percentage of balance</span>
                <input
                  className={styles.input}
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  min="0"
                  max="100"
                  value={percentage}
                  onChange={(e) => setPercentage(e.target.value)}
                  placeholder="10"
                  disabled={busy}
                />
              </div>
            )}

            <div className={styles.section}>
              <span className={styles.label}>Max position cap (USDT, optional)</span>
              <input
                className={styles.input}
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={maxPosition}
                onChange={(e) => setMaxPosition(e.target.value)}
                placeholder="No cap"
                disabled={busy}
              />
              <p className={styles.hint}>
                Leave empty to disable. When set, no single copied trade exceeds this notional.
              </p>
            </div>

            <div className={styles.toggleRow}>
              <div className={styles.toggleText}>
                <p className={styles.toggleTitle}>
                  {status === "active"
                    ? "Copy trading is active"
                    : status === "paused"
                      ? "Copy trading is paused"
                      : "Copy trading is inactive"}
                </p>
                <p className={styles.toggleSubtitle}>
                  {status === "active"
                    ? "New master trades will be copied to your account."
                    : status === "paused"
                      ? "Master trades are ignored until you resume."
                      : "Connect an API key and activate a subscription to start."}
                </p>
              </div>
              <button
                type="button"
                className={styles.toggleBtn}
                onClick={handleToggle}
                disabled={toggleDisabled}
              >
                {toggleBusy ? "…" : toggleLabel}
              </button>
            </div>

            {error && (
              <div className={styles.error} role="alert">
                <AlertTriangle size={16} aria-hidden />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              className={styles.primaryBtn}
              disabled={busy || !me}
            >
              {busy ? "Saving…" : "Save settings"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
