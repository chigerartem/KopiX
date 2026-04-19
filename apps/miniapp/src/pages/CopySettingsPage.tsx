/** Copy settings edit screen for active subscribers (post-purchase flow). */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { AlertTriangle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { BottomTabBar, type TabId } from "@/components/dashboard/BottomTabBar";
import { useActivePageRefresh } from "@/hooks/useActivePageRefresh";
import { SubPageHeader } from "@/components/layout/SubPageHeader";
import { useAppState } from "@/contexts/AppStateContext";
import { useApiKeys } from "@/contexts/ApiKeysContext";
import { useCopySettings } from "@/contexts/CopySettingsContext";
import {
  getUserCopySettings,
  updateUserCopySettings,
} from "@/services/api";
import styles from "./CopySettingsPage.module.css";

/** Allow only digits and a single decimal point while typing. */
function sanitizePercentChars(raw: string): string {
  let s = raw.replace(/[^\d.]/g, "");
  const dot = s.indexOf(".");
  if (dot !== -1) {
    s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, "");
  }
  return s;
}

export function CopySettingsPage() {
  const navigate = useNavigate();
  const {
    setSubscriptionStatus,
    setSubscriptionValidUntil,
    refreshSubscriptionStatus,
  } = useAppState();
  const { keys } = useApiKeys();
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
  const [hasActiveSubscription, setHasActiveSubscription] = useState(false);
  const [savedSnapshot, setSavedSnapshot] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => {
      setToast(null);
      toastTimer.current = null;
    }, 2200);
  }, []);

  const currentSnapshot = useMemo(
    () =>
      JSON.stringify({
        copyMode,
        proportionalPercent,
        fixedAmountUsdt,
        selectedApiKeyId,
      }),
    [copyMode, proportionalPercent, fixedAmountUsdt, selectedApiKeyId],
  );
  const hasUnsavedChanges =
    hasActiveSubscription && savedSnapshot !== "" && currentSnapshot !== savedSnapshot;

  useEffect(() => {
    if (selectedApiKeyId && !keys.some((k) => k.id === selectedApiKeyId)) {
      setSelectedApiKeyId(null);
    }
  }, [keys, selectedApiKeyId, setSelectedApiKeyId]);

  useEffect(() => {
    if (savedSnapshot !== "") return;
    setSavedSnapshot(currentSnapshot);
  }, [currentSnapshot, savedSnapshot]);

  useActivePageRefresh({
    refresh: async () => {
      try {
        const [status, copyData] = await Promise.all([
          refreshSubscriptionStatus(),
          getUserCopySettings(),
        ]);
        const isActive = status.state === "active";
        setHasActiveSubscription(isActive);
        setSubscriptionStatus(status.state);
        setSubscriptionValidUntil(status.activeTo);
        setCopyMode(copyData.settings.copyMode);
        setProportionalPercent(copyData.settings.proportionalPercent);
        setFixedAmountUsdt(copyData.settings.fixedAmountUsdt);
        setSavedSnapshot(
          JSON.stringify({
            copyMode: copyData.settings.copyMode,
            proportionalPercent: copyData.settings.proportionalPercent,
            fixedAmountUsdt: copyData.settings.fixedAmountUsdt,
            selectedApiKeyId,
          }),
        );
      } catch (err) {
        console.error("[CopySettings] failed to sync subscription status", err);
      }
    },
  });

  const selectedKeyName = useMemo(
    () => keys.find((k) => k.id === selectedApiKeyId)?.name ?? null,
    [keys, selectedApiKeyId],
  );

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

  const handleSelectKey = (id: string) => {
    if (!hasActiveSubscription) return;
    setSelectedApiKeyId(id);
    setApiKeyExpanded(false);
  };

  const handleAddKey = () => {
    if (!hasActiveSubscription) return;
    navigate("/api-keys/add", { state: { returnTo: "/copy-settings" } });
  };

  const handleSaveChanges = () => {
    if (!hasActiveSubscription || !hasUnsavedChanges) return;
    void updateUserCopySettings({
      copyMode,
      proportionalPercent,
      fixedAmountUsdt,
    })
      .then(() => {
        saveCopySettings();
        setSavedSnapshot(currentSnapshot);
        notify("Changes saved");
      })
      .catch((err) => {
        console.error("[CopySettings] failed to save", err);
        notify(err instanceof Error ? err.message : "Unable to save");
      });
  };

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <SubPageHeader title="Copy Settings" onBack={() => navigate("/dashboard")} />
        <p className={styles.pageMeta}>Copy settings</p>

        <div className={styles.stack}>
          {!hasActiveSubscription ? (
            <p className={styles.lockedMessage}>
              You need an active subscription to change settings
            </p>
          ) : null}

          <section
            className={styles.section}
            aria-labelledby="copy-mode-heading"
          >
            <h2 id="copy-mode-heading" className={styles.sectionTitle}>
              Copy mode
            </h2>
            <div
              className={styles.segment}
              role="tablist"
              aria-label="Copy mode"
            >
              <button
                type="button"
                role="tab"
                aria-selected={copyMode === "proportional"}
                className={`${styles.segmentBtn} ${copyMode === "proportional" ? styles.segmentBtnActive : ""}`}
                onClick={() => setCopyMode("proportional")}
                disabled={!hasActiveSubscription}
              >
                Proportional
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={copyMode === "fixed"}
                className={`${styles.segmentBtn} ${copyMode === "fixed" ? styles.segmentBtnActive : ""}`}
                onClick={() => setCopyMode("fixed")}
                disabled={!hasActiveSubscription}
              >
                Fixed
              </button>
            </div>

            {copyMode === "proportional" ? (
              <>
                <label className={styles.fieldLabel} htmlFor="pct-trade">
                  Percentage per trade
                </label>
                <div className={styles.inlineRow}>
                  <input
                    id="pct-trade"
                    className={styles.inlineInput}
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="10"
                    value={proportionalPercent}
                    onChange={handlePercentChange}
                    onBlur={handlePercentBlur}
                    aria-label="Percentage per trade"
                    disabled={!hasActiveSubscription}
                  />
                  <span className={styles.inlineSuffix} aria-hidden>
                    %
                  </span>
                </div>
                <div className={styles.helperRow}>
                  <AlertTriangle
                    className={styles.warningIcon}
                    size={11}
                    strokeWidth={2}
                    aria-hidden
                  />
                  <p className={styles.helperText}>
                    We do not recommend using more than 10% per trade.
                  </p>
                </div>
              </>
            ) : (
              <>
                <label className={styles.fieldLabel} htmlFor="amt-trade">
                  Amount per trade
                </label>
                <div className={styles.inlineRow}>
                  <input
                    id="amt-trade"
                    className={styles.inlineInput}
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="100"
                    value={fixedAmountUsdt}
                    onChange={(e) => setFixedAmountUsdt(e.target.value)}
                    aria-label="Amount per trade in USDT"
                    disabled={!hasActiveSubscription}
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
              onClick={() => {
                if (!hasActiveSubscription) return;
                toggleApiKeySection();
              }}
              aria-expanded={apiKeyExpanded}
              disabled={!hasActiveSubscription}
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
                    <button
                      type="button"
                      className={styles.linkBtn}
                      onClick={handleAddKey}
                      disabled={!hasActiveSubscription}
                    >
                      Add API Key
                    </button>
                  </>
                ) : (
                  keys.map((k) => (
                    <button
                      key={k.id}
                      type="button"
                      className={`${styles.keyRow} ${selectedApiKeyId === k.id ? styles.keyRowSelected : ""}`}
                      onClick={() => handleSelectKey(k.id)}
                      disabled={!hasActiveSubscription}
                    >
                      <span className={styles.keyRowName}>{k.name}</span>
                      <span className={styles.keyRowMark} aria-hidden />
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </section>

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primaryCta}
              onClick={handleSaveChanges}
              disabled={!hasActiveSubscription || !hasUnsavedChanges}
            >
              Save
            </button>
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
