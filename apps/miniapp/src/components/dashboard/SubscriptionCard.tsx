/**
 * Read-only subscription status card.
 *
 * Shows active status + expiry date, or a hint to use the bot.
 * Subscription purchase is handled in the bot via /subscribe.
 */
import { useAppState } from "@/contexts/AppStateContext";
import styles from "./SubscriptionCard.module.css";

function formatValidUntil(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

export function SubscriptionCard() {
  const { subscriptionStatus, subscriptionValidUntil } = useAppState();

  const isActive = subscriptionStatus === "active";

  return (
    <section
      className={styles.section}
      aria-label={isActive ? "Copy trading access" : "No active subscription"}
    >
      <div className={styles.panel}>
        <div className={styles.body}>
          {isActive ? (
            <>
              <div className={styles.titleRow}>
                <span className={styles.statusDot} aria-hidden />
                <h2 className={styles.title}>Active</h2>
              </div>
              <p className={styles.subtitle}>
                Valid until:{" "}
                {subscriptionValidUntil
                  ? formatValidUntil(subscriptionValidUntil)
                  : "—"}
              </p>
            </>
          ) : (
            <>
              <h2 className={styles.title}>No subscription</h2>
              <p className={styles.subtitle}>
                Use /subscribe in the bot to activate
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
