/**
 * /subscription/setup — show the plan, open CryptoBot invoice.
 *
 * Flow:
 *   1. GET /api/plans → list active plans.
 *   2. User taps "Pay with CryptoBot".
 *   3. POST /api/subscriptions/create-invoice {planId} → {botInvoiceUrl}.
 *   4. tg.openLink(botInvoiceUrl) → opens @CryptoBot invoice.
 *   5. Backend webhook activates subscription; user taps "Refresh" to proceed.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Check, RefreshCw, Zap } from "lucide-react";
import { SubPageHeader } from "@/components/layout/SubPageHeader";
import { useSubscriber } from "@/contexts/SubscriberContext";
import {
  createSubscriptionInvoice,
  getPlans,
  type Plan,
} from "@/services/api";
import { openLink } from "@/services/telegram";
import styles from "./SubscriptionSetupPage.module.css";

const PLAN_FEATURES = [
  "Auto-copy master trades in real time",
  "Fixed or percentage position sizing",
  "Pause & resume anytime",
  "Trade notifications in Telegram",
];

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
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Failed to load plans");
      } finally {
        if (!cancelled) setPlansLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Auto-advance once subscription becomes active after payment.
  useEffect(() => {
    if (!pending) return;
    if (me?.subscription?.status !== "active") return;
    if (step === "api_key") navigate("/api-keys/add", { replace: true });
    else if (step === "copy_settings") navigate("/copy-settings", { replace: true });
    else navigate("/dashboard", { replace: true });
  }, [pending, me?.subscription?.status, step, navigate]);

  const selectedPlan = plans.find((p) => p.id === selectedPlanId) ?? null;

  async function handlePay() {
    if (!selectedPlanId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const invoice = await createSubscriptionInvoice(selectedPlanId);
      if (!invoice.botInvoiceUrl) throw new Error("Invoice URL missing");
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
          <div className={styles.placeholder}>Loading…</div>
        ) : plans.length === 0 ? (
          <div className={styles.placeholder}>No plans available right now.</div>
        ) : (
          <>
            {/* Plan cards */}
            <div className={styles.plans}>
              {plans.map((plan) => {
                const active = plan.id === selectedPlanId;
                const perDay = plan.durationDays > 0
                  ? (plan.priceUsdt / plan.durationDays).toFixed(2)
                  : null;
                return (
                  <button
                    key={plan.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={`${styles.planCard} ${active ? styles.planCardActive : ""}`}
                    onClick={() => setSelectedPlanId(plan.id)}
                    disabled={busy}
                  >
                    {/* Header row */}
                    <div className={styles.planHeader}>
                      <div className={styles.planMeta}>
                        <span className={styles.planName}>{plan.name}</span>
                        <span className={styles.planDuration}>
                          {plan.durationDays} days
                        </span>
                      </div>
                      <div className={styles.planPricing}>
                        <span className={styles.planPrice}>
                          {plan.priceUsdt.toFixed(2)}
                          <span className={styles.planCurrency}> USDT</span>
                        </span>
                        {perDay && (
                          <span className={styles.planPerDay}>
                            ~{perDay} / day
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Features — only show on the selected card */}
                    {active && (
                      <ul className={styles.features}>
                        {PLAN_FEATURES.map((f) => (
                          <li key={f} className={styles.feature}>
                            <Check size={13} className={styles.featureIcon} aria-hidden />
                            {f}
                          </li>
                        ))}
                      </ul>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Pending notice */}
            {pending && (
              <div className={styles.notice}>
                Invoice opened in CryptoBot. After payment is confirmed, tap{" "}
                <b>Refresh</b> — your subscription activates automatically.
              </div>
            )}

            {/* Error */}
            {error && (
              <div className={styles.error} role="alert">
                <AlertTriangle size={15} aria-hidden />
                <span>{error}</span>
              </div>
            )}

            {/* CTA */}
            <button
              type="button"
              className={styles.payBtn}
              onClick={handlePay}
              disabled={!selectedPlan || busy}
            >
              <Zap size={17} aria-hidden />
              <span>
                {busy
                  ? "Opening…"
                  : selectedPlan
                  ? `Pay ${selectedPlan.priceUsdt.toFixed(2)} USDT with CryptoBot`
                  : "Pay with CryptoBot"}
              </span>
            </button>

            {pending && (
              <button
                type="button"
                className={styles.refreshBtn}
                onClick={handleRefresh}
                disabled={refreshing}
              >
                <RefreshCw size={15} aria-hidden />
                <span>{refreshing ? "Checking…" : "Refresh status"}</span>
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
