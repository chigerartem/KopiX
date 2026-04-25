import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Lock } from "lucide-react";
import { KOPIX_SUPPORT_TELEGRAM_URL } from "@/config/links";
import { useSubscriber } from "@/contexts/SubscriberContext";
import styles from "./DashboardSideMenu.module.css";

type DashboardSideMenuProps = {
  open: boolean;
  onClose: () => void;
};

/**
 * Side navigation drawer.
 *
 * Items are gated by the onboarding `step` derived in SubscriberContext:
 *   - "API keys" requires an active subscription
 *   - "Copy settings" requires both subscription + connected key
 *
 * Locked items are visibly disabled (opacity + lock icon) and tapping them
 * routes to whichever screen still owns the next required action, so the
 * user is funnelled through the flow rather than landing on a dead form.
 */
export function DashboardSideMenu({ open, onClose }: DashboardSideMenuProps) {
  const navigate = useNavigate();
  const { me, step } = useSubscriber();

  const hasSub = !!me && me.subscription?.status === "active";
  const hasKey = !!me?.hasExchangeConnected;

  function go(path: string) {
    onClose();
    navigate(path);
  }

  /** Tap on a locked item: route to the screen that owns the missing step. */
  function goRequired() {
    if (step === "subscribe") return go("/subscription/setup");
    if (step === "api_key") return go("/api-keys/add");
    return go("/copy-settings");
  }

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const apiKeysLocked = !hasSub;
  const copySettingsLocked = !hasSub || !hasKey;

  return (
    <div
      className={styles.root}
      data-open={open ? "true" : "false"}
      aria-hidden={!open}
      inert={!open ? true : undefined}
    >
      <div
        className={styles.backdrop}
        onClick={onClose}
        aria-hidden="true"
      />
      <nav className={styles.panel} aria-label="Menu">
        <ul className={styles.list}>
          <li>
            <button
              type="button"
              className={styles.item}
              onClick={() => go("/subscription/setup")}
            >
              <span>Subscription</span>
            </button>
          </li>
          <li>
            <button
              type="button"
              className={styles.item}
              onClick={apiKeysLocked ? goRequired : () => go("/api-keys")}
              aria-disabled={apiKeysLocked}
              data-locked={apiKeysLocked ? "true" : undefined}
            >
              <span>API keys</span>
              {apiKeysLocked && <Lock size={14} aria-hidden className={styles.lockIcon} />}
            </button>
          </li>
          <li>
            <button
              type="button"
              className={styles.item}
              onClick={copySettingsLocked ? goRequired : () => go("/copy-settings")}
              aria-disabled={copySettingsLocked}
              data-locked={copySettingsLocked ? "true" : undefined}
            >
              <span>Copy settings</span>
              {copySettingsLocked && <Lock size={14} aria-hidden className={styles.lockIcon} />}
            </button>
          </li>
          <li>
            <a
              className={styles.item}
              href={KOPIX_SUPPORT_TELEGRAM_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => onClose()}
            >
              <span>Support</span>
            </a>
          </li>
        </ul>
      </nav>
    </div>
  );
}
