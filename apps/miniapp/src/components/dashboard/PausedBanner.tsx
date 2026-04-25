/**
 * Banner shown above dashboard widgets when the subscriber is fully set up
 * (sub + key + copy params) but `subscriber.status === "paused"` — engine
 * filters those out, so without this notice the user would think trades
 * were being copied when they aren't.
 *
 * Most common path here: user disconnected then reconnected their BingX key
 * (DELETE /api/exchange/credentials sets status to "paused"), or paused
 * manually from /copy-settings and forgot.
 */
import { useState } from "react";
import { Pause, Play } from "lucide-react";
import { useSubscriber } from "@/contexts/SubscriberContext";
import { patchSubscriberMe } from "@/services/api";
import styles from "./PausedBanner.module.css";

export function PausedBanner() {
  const { refresh } = useSubscriber();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleResume() {
    setBusy(true);
    setError(null);
    try {
      await patchSubscriberMe({ action: "resume" });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resume");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.banner} aria-label="Copy trading paused">
      <span className={styles.iconWrap} aria-hidden>
        <Pause size={16} />
      </span>
      <div className={styles.text}>
        <p className={styles.title}>Copy trading is paused</p>
        <p className={styles.subtitle}>
          New master trades will be ignored until you resume.
        </p>
        {error && <p className={styles.error} role="alert">{error}</p>}
      </div>
      <button
        type="button"
        className={styles.action}
        onClick={handleResume}
        disabled={busy}
      >
        <Play size={14} aria-hidden />
        <span>{busy ? "Resuming…" : "Resume"}</span>
      </button>
    </section>
  );
}
