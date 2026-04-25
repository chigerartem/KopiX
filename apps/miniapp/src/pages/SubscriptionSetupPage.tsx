/**
 * /subscription/setup — pick a plan, open CryptoBot invoice in Telegram.
 *
 * Flow:
 *   1. GET /api/plans → list of active plans.
 *   2. POST /api/subscriptions/create-invoice {planId} → {invoiceId, botInvoiceUrl}.
 *   3. tg.openLink(botInvoiceUrl) → opens @CryptoBot chat with the invoice.
 *   4. Backend webhook activates the subscription on payment.
 *   5. User taps "Refresh status" → useSubscriber.refresh() picks up the new
 *      subscription row and the page navigates back to dashboard if active.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ExternalLink, RefreshCw } from "lucide-react";
import { SubPageHeader } from "@/components/layout/SubPageHeader";
import { useSubscriber } from "@/contexts/SubscriberContext";
import {
  createSubscriptionInvoice,
  getPlans,
  type Plan,
} from "@/services/api";
import { openLink } from "@/services/telegram";
import styles from "./SubscriptionSetupPage.module.css";

export function SubscriptionSetupPage() {
  const navigate = useNavigate();
  const { me, step, refresh } = useSubscriber();

  const [plans, setPlans] = useState<Plan[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await getPlans();
        if (cancelled) return;
        setPlans(list);
        if (list.length > 0) setSelectedPlanId(list[0].id);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load plans");
        }
      } finally {
        if (!cancelled) setPlansLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-advance once the subscription becomes active after a payment.
  // We only run this after the user has actually opened the invoice
  // (`pending`), so someone who already has an active subscription and
  // just wandered onto this page isn't yanked off immediately.
  //
  // Where we land depends on the rest of the onboarding state:
  //   - first-time setup → /api-keys/add (next required step)
  //   - renewal of a fully configured account → /dashboard
  useEffect(() => {
    if (!pending) return;
    if (me?.subscription?.status !== "active") return;
    if (step === "api_key") navigate("/api-keys/add", { replace: true });
    else if (step === "copy_settings") navigate("/copy-settings", { replace: true });
    else if (step === "done") navigate("/dashboard", { replace: true });
  }, [pending, me?.subscription?.status, step, navigate]);

  async function handlePay() {
    if (!selectedPlanId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const invoice = await createSubscriptionInvoice(selectedPlanId);
      if (!invoice.botInvoiceUrl) {
        throw new Error("Invoice URL missing");
      }
      openLink(invoice.botInvoiceUrl);
      setPending(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create invoice");
    } finally {
      setBusy(false);
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    setError(null);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <SubPageHeader title="Subscribe" />

        {plansLoading ? (
          <div className={styles.placeholder}>Loading plans…</div>
        ) : plans.length === 0 ? (
          <div className={styles.placeholder}>No plans available right now.</div>
        ) : (
          <>
            <p className={styles.intro}>
              Pick a plan and pay with CryptoBot in USDT. Your subscription activates
              automatically once the payment is confirmed.
            </p>

            <div className={styles.plans} role="radiogroup">
              {plans.map((plan) => {
                const active = plan.id === selectedPlanId;
                return (
                  <button
                    key={plan.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={`${styles.plan} ${active ? styles.planActive : ""}`}
                    onClick={() => setSelectedPlanId(plan.id)}
                    disabled={busy}
                  >
                    <div className={styles.planMain}>
                      <p className={styles.planName}>{plan.name}</p>
                      <p className={styles.planDuration}>
                        {plan.durationDays} day{plan.durationDays === 1 ? "" : "s"}
                      </p>
                    </div>
                    <span className={styles.planPrice}>
                      {plan.priceUsdt.toFixed(2)} USDT
                    </span>
                  </button>
                );
              })}
            </div>

            {pending && (
              <p className={styles.notice}>
                Invoice opened in CryptoBot. After payment is confirmed, tap{" "}
                <b>Refresh status</b> below — the subscription activates automatically.
              </p>
            )}

            {error && (
              <div className={styles.error} role="alert">
                <AlertTriangle size={16} aria-hidden />
                <span>{error}</span>
              </div>
            )}

            <button
              type="button"
              className={styles.primaryBtn}
              onClick={handlePay}
              disabled={!selectedPlanId || busy}
            >
              <ExternalLink size={18} aria-hidden />
              <span>{busy ? "Opening…" : "Pay with CryptoBot"}</span>
            </button>

            {pending && (
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={handleRefresh}
                disabled={refreshing}
              >
                <RefreshCw size={16} aria-hidden />
                <span>{refreshing ? "Checking…" : "Refresh status"}</span>
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
