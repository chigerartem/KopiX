/**
 * Dashboard subscription callout. State from AppStateContext until billing API exists.
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

type SubscriptionCardProps = {
  /** Dashboard-only: reopen CryptoBot checkout for pending invoice. */
  onPay?: () => void;
};

export function SubscriptionCard({ onPay }: SubscriptionCardProps) {
  const navigate = useNavigate();
  const { subscriptionStatus, subscriptionValidUntil } = useAppState();

  const isActive = subscriptionStatus === "active";
  const isPaymentPending = subscriptionStatus === "payment_pending";

  const handleActivate = () => {
    navigate("/subscription/setup");
  };

  const handlePay = () => {
    onPay?.();
  };

  const panelClass = `${styles.panel} ${isPaymentPending ? styles.panelPending : ""}`;

  return (
    <section
      className={styles.section}
      aria-label={
        isActive
          ? "Copy trading access"
          : isPaymentPending
            ? "Payment pending"
            : "Start copy trading"
      }
    >
      <div className={panelClass}>
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
          ) : isPaymentPending ? (
            <>
              <div className={styles.titleRow}>
                <span className={styles.pendingDot} aria-hidden />
                <h2 className={styles.title}>Payment pending</h2>
              </div>
              <p className={styles.subtitle}>
                Complete payment to start copying trades
              </p>
              <button type="button" className={styles.cta} onClick={handlePay}>
                Pay
              </button>
            </>
          ) : (
            <>
              <h2 className={styles.title}>Start copying trades</h2>
              <p className={styles.subtitle}>Activate access to begin</p>
              <button type="button" className={styles.cta} onClick={handleActivate}>
                Activate
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
