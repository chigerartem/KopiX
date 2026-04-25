/**
 * Subscription status card on the dashboard.
 *
 * Active → green-tinted panel with expiry date.
 * Inactive → neutral panel + "Subscribe" CTA → /subscription/setup.
 */
import { useNavigate } from "react-router-dom";
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
  const navigate = useNavigate();
  const { subscriptionStatus, subscriptionValidUntil } = useAppState();

  const isActive = subscriptionStatus === "active";

  return (
    <section
      className={styles.section}
      aria-label={isActive ? "Copy trading access" : "No active subscription"}
    >
      <div className={`${styles.panel}${!isActive ? ` ${styles.panelInactive}` : ""}`}>
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
                Subscribe to start copying the master's trades.
              </p>
              <button
                type="button"
                className={styles.cta}
                onClick={() => navigate("/subscription/setup")}
              >
                Subscribe
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
