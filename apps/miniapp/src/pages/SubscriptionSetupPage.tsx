import { useCallback, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { BottomTabBar, type TabId } from "@/components/dashboard/BottomTabBar";
import { SubPageHeader } from "@/components/layout/SubPageHeader";
import { useAppState } from "@/contexts/AppStateContext";
import { useApiKeys } from "@/contexts/ApiKeysContext";
import { useCopySettings } from "@/contexts/CopySettingsContext";
import { useActivePageRefresh } from "@/hooks/useActivePageRefresh";
import {
  getClientConfig,
  getUserCopySettings,
  startSubscriptionPayment,
  updateUserCopySettings,
} from "@/services/api";
import styles from "./CopySettingsPage.module.css";

function sanitizePercentChars(raw: string): string {
  let s = raw.replace(/[^\d.]/g, "");
  const dot = s.indexOf(".");
  if (dot !== -1) {
    s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, "");
  }
  return s;
}

function getIsoAfterDays(days: number): string {
  const now = new Date();
  now.setDate(now.getDate() + days);
  return now.toISOString();
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function SubscriptionSetupPage() {
  const navigate = useNavigate();
  const { keys } = useApiKeys();
  const {
    setSubscriptionStatus,
    setSubscriptionValidUntil,
    refreshSubscriptionStatus,
  } = useAppState();
  const {
    copyMode,
    setCopyMode,
    proportionalPercent,
    setProportionalPercent,
    fixedAmountUsdt,
    setFixedAmountUsdt,
    selectedApiKeyId,
    setSelectedApiKeyId,
    apiKeyExpanded,
    setApiKeyExpanded,
    toggleApiKeySection,
    saveCopySettings,
  } = useCopySettings();

  const [toast, setToast] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasActiveSubscription, setHasActiveSubscription] = useState(false);
  const [subscriptionPrice, setSubscriptionPrice] = useState(1);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => {
      setToast(null);
      toastTimer.current = null;
    }, 2400);
  }, []);

  const selectedKeyName = useMemo(
    () => keys.find((k) => k.id === selectedApiKeyId)?.name ?? null,
    [keys, selectedApiKeyId],
  );

  const startIso = useMemo(() => new Date().toISOString(), []);
  const endIso = useMemo(() => getIsoAfterDays(30), []);

  useActivePageRefresh({
    refresh: async () => {
      const [status, copyData, clientConfig] = await Promise.all([
        refreshSubscriptionStatus(),
        getUserCopySettings(),
        getClientConfig(),
      ]);
      setSubscriptionStatus(status.state);
      setSubscriptionValidUntil(status.activeTo);
      setHasActiveSubscription(status.state === "active");
      setSubscriptionPrice(clientConfig.subscriptionPrice);
      setCopyMode(copyData.settings.copyMode);
      setProportionalPercent(copyData.settings.proportionalPercent);
      setFixedAmountUsdt(copyData.settings.fixedAmountUsdt);
      saveCopySettings();
    },
  });

  const subscriptionPriceLabel = `${subscriptionPrice} USDT`;

  const handlePercentChange = (e: ChangeEvent<HTMLInputElement>) => {
    setProportionalPercent(sanitizePercentChars(e.target.value));
  };

  const handlePercentBlur = () => {
    if (proportionalPercent === "" || proportionalPercent === ".") {
      setProportionalPercent("1");
      return;
    }
    const n = Number.parseFloat(proportionalPercent);
    if (Number.isNaN(n)) setProportionalPercent("1");
    else setProportionalPercent(String(Math.min(100, Math.max(1, n))));
  };

  const handleAddKey = () => {
    navigate("/api-keys/add", { state: { returnTo: "/subscription/setup" } });
  };

  const handleStartPayment = async () => {
    if (!selectedApiKeyId) {
      notify("Connect and select API key first");
      return;
    }
    setIsSubmitting(true);
    try {
      await updateUserCopySettings({
        copyMode,
        proportionalPercent,
        fixedAmountUsdt,
      });
      saveCopySettings();

      const { payUrl } = await startSubscriptionPayment({
        accountSubscriptionType: "standart",
      });
      if (!payUrl) {
        const status = await refreshSubscriptionStatus({ force: true });
        setSubscriptionStatus(status.state);
        setSubscriptionValidUntil(status.activeTo);
        if (status.state === "active") {
          notify("Subscription activated");
          navigate("/dashboard");
          return;
        }
        notify("Unable to activate subscription");
        return;
      }
      window.location.href = payUrl;
    } catch (err) {
      console.error("[SubscriptionSetup] start payment failed", err);
      notify(err instanceof Error ? err.message : "Unable to start payment");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <SubPageHeader title="Activate Subscription" onBack={() => navigate("/dashboard")} />
        <p className={styles.pageMeta}>Setup copy trading and payment</p>

        <div className={styles.stack}>
          <section className={styles.section} aria-labelledby="copy-mode-heading">
            <h2 id="copy-mode-heading" className={styles.sectionTitle}>
              Copy mode
            </h2>
            <div className={styles.segment} role="tablist" aria-label="Copy mode">
              <button
                type="button"
                role="tab"
                aria-selected={copyMode === "proportional"}
                className={`${styles.segmentBtn} ${copyMode === "proportional" ? styles.segmentBtnActive : ""}`}
                onClick={() => setCopyMode("proportional")}
              >
                Proportional
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={copyMode === "fixed"}
                className={`${styles.segmentBtn} ${copyMode === "fixed" ? styles.segmentBtnActive : ""}`}
                onClick={() => setCopyMode("fixed")}
              >
                Fixed
              </button>
            </div>

            {copyMode === "proportional" ? (
              <>
                <label className={styles.fieldLabel} htmlFor="pct-trade-setup">
                  Percentage per trade
                </label>
                <div className={styles.inlineRow}>
                  <input
                    id="pct-trade-setup"
                    className={styles.inlineInput}
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="10"
                    value={proportionalPercent}
                    onChange={handlePercentChange}
                    onBlur={handlePercentBlur}
                  />
                  <span className={styles.inlineSuffix} aria-hidden>
                    %
                  </span>
                </div>
                <div className={styles.helperRow}>
                  <AlertTriangle className={styles.warningIcon} size={11} strokeWidth={2} aria-hidden />
                  <p className={styles.helperText}>
                    We do not recommend using more than 10% per trade.
                  </p>
                </div>
              </>
            ) : (
              <>
                <label className={styles.fieldLabel} htmlFor="amt-trade-setup">
                  Amount per trade
                </label>
                <div className={styles.inlineRow}>
                  <input
                    id="amt-trade-setup"
                    className={styles.inlineInput}
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="100"
                    value={fixedAmountUsdt}
                    onChange={(e) => setFixedAmountUsdt(e.target.value)}
                  />
                  <span className={styles.inlineSuffix} aria-hidden>
                    USDT
                  </span>
                </div>
              </>
            )}
          </section>

          <section className={styles.section} aria-label="API key selection">
            <button
              type="button"
              className={styles.apiRow}
              onClick={toggleApiKeySection}
              aria-expanded={apiKeyExpanded}
            >
              <span className={styles.apiRowLabel}>API Key</span>
              <span
                className={`${styles.apiRowValue} ${selectedKeyName ? styles.apiRowValueSelected : ""}`}
              >
                {selectedKeyName ?? "Not selected"}
              </span>
              <span className={styles.apiRowChevron} aria-hidden>
                ›
              </span>
            </button>

            {apiKeyExpanded ? (
              <div className={styles.pickerPanel}>
                {keys.length === 0 ? (
                  <>
                    <p className={styles.emptyHint}>No API keys added</p>
                    <button type="button" className={styles.linkBtn} onClick={handleAddKey}>
                      Add API Key
                    </button>
                  </>
                ) : (
                  keys.map((k) => (
                    <button
                      key={k.id}
                      type="button"
                      className={`${styles.keyRow} ${selectedApiKeyId === k.id ? styles.keyRowSelected : ""}`}
                      onClick={() => {
                        setSelectedApiKeyId(k.id);
                        setApiKeyExpanded(false);
                      }}
                    >
                      <span className={styles.keyRowName}>{k.name}</span>
                      <span className={styles.keyRowMark} aria-hidden />
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </section>

          <section className={styles.section} aria-label="Subscription details">
            <h2 className={styles.sectionTitle}>Subscription</h2>
            <div className={styles.subGrid}>
              <div className={styles.subItem}>
                <span className={styles.subMuted}>Plan</span>
                <span className={styles.subStrong}>Monthly</span>
              </div>
              <div className={styles.subItem}>
                <span className={styles.subMuted}>Price</span>
                <span className={styles.subStrong}>{subscriptionPriceLabel}</span>
              </div>
              <div className={styles.subItem}>
                <span className={styles.subMuted}>Start date</span>
                <span className={styles.subStrong}>{formatDate(startIso)}</span>
              </div>
              <div className={styles.subItem}>
                <span className={styles.subMuted}>End date</span>
                <span className={styles.subStrong}>{formatDate(endIso)}</span>
              </div>
              <div className={styles.subItem}>
                <span className={styles.subMuted}>Payment method</span>
                <span className={styles.subStrong}>CryptoBot</span>
              </div>
            </div>
          </section>

          <div className={styles.actions}>
            {hasActiveSubscription ? (
              <button
                type="button"
                className={styles.primaryCta}
                onClick={() => navigate("/copy-settings")}
              >
                Open Copy Settings
              </button>
            ) : (
              <button
                type="button"
                className={styles.primaryCta}
                onClick={handleStartPayment}
                disabled={isSubmitting}
              >
                {isSubmitting ? "Processing..." : "Start & Pay"}
              </button>
            )}
          </div>
        </div>
      </div>

      {toast ? (
        <div className={styles.toast} role="status">
          {toast}
        </div>
      ) : null}

      <BottomTabBar
        active="home"
        onChange={(id: TabId) => {
          if (id === "home") navigate("/dashboard");
          else if (id === "trades") navigate("/trades");
        }}
      />
    </div>
  );
}

