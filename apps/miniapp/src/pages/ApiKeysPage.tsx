import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { MoreVertical } from "lucide-react";
import { SubPageHeader } from "@/components/layout/SubPageHeader";
import { BingXLogo } from "@/components/branding/BingXLogo";
import type { BingXApiKeyRecord } from "@/contexts/ApiKeysContext";
import { useApiKeys } from "@/contexts/ApiKeysContext";
import styles from "./ApiKeysPage.module.css";

const MENU_W = 168;
const MENU_H = 92;

type MenuState = { keyId: string; top: number; left: number };

export function ApiKeysPage() {
  const navigate = useNavigate();
  const { keys, removeKey } = useApiKeys();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BingXApiKeyRecord | null>(
    null,
  );

  const closeMenu = useCallback(() => setMenu(null), []);

  const openMenuForKey = useCallback(
    (keyId: string, triggerEl: HTMLElement) => {
      const r = triggerEl.getBoundingClientRect();
      let top = r.bottom + 6;
      let left = r.right - MENU_W;
      if (left < 8) left = 8;
      if (left + MENU_W > window.innerWidth - 8) {
        left = window.innerWidth - MENU_W - 8;
      }
      if (top + MENU_H > window.innerHeight - 8) {
        top = r.top - MENU_H - 6;
      }
      setMenu({ keyId, top, left });
    },
    [],
  );

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        t instanceof Element &&
        (t.closest("[data-api-key-menu]") ||
          t.closest("[data-api-key-menu-trigger]"))
      ) {
        return;
      }
      closeMenu();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu, closeMenu]);

  const handleEdit = (key: BingXApiKeyRecord) => {
    closeMenu();
    navigate(`/api-keys/${key.id}/edit`);
  };

  const handleDeleteClick = (key: BingXApiKeyRecord) => {
    closeMenu();
    setDeleteTarget(key);
  };

  const confirmDelete = async () => {
    if (deleteTarget) {
      await removeKey(deleteTarget.id);
      setDeleteTarget(null);
    }
  };

  useEffect(() => {
    if (!deleteTarget) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDeleteTarget(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [deleteTarget]);

  const menuKey = menu ? keys.find((k) => k.id === menu.keyId) : undefined;

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <SubPageHeader title="API Keys" />

        <p className={styles.subtitle}>BingX connections for your account.</p>

        <ul className={styles.list} aria-label="Connected API keys">
          {keys.length === 0 ? (
            <li className={styles.empty}>
              No API keys yet. Add one to get started.
            </li>
          ) : (
            keys.map((key) => (
              <li key={key.id} className={styles.listItem}>
                <div className={styles.keyCard}>
                  <button
                    type="button"
                    className={styles.menuTrigger}
                    data-api-key-menu-trigger
                    aria-label={`Actions for ${key.name}`}
                    aria-expanded={menu?.keyId === key.id}
                    aria-haspopup="menu"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (menu?.keyId === key.id) closeMenu();
                      else openMenuForKey(key.id, e.currentTarget);
                    }}
                  >
                    <MoreVertical size={20} strokeWidth={2} aria-hidden />
                  </button>
                  <BingXLogo size={44} className={styles.keyLogo} />
                  <div className={styles.keyBody}>
                    <p className={styles.keyName}>{key.name}</p>
                    <p className={styles.keyStatus}>
                      <span className={styles.statusDot} aria-hidden />
                      Connected
                    </p>
                  </div>
                </div>
              </li>
            ))
          )}
        </ul>

        <div className={styles.footer}>
          <button
            type="button"
            className={styles.addBtn}
            onClick={() => navigate("/api-keys/add")}
          >
            Add API Key
          </button>
        </div>
      </div>

      {menu && menuKey
        ? createPortal(
            <div
              className={styles.menu}
              data-api-key-menu
              role="menu"
              style={{
                top: menu.top,
                left: menu.left,
                width: MENU_W,
              }}
            >
              <button
                type="button"
                role="menuitem"
                className={styles.menuItem}
                onClick={() => handleEdit(menuKey)}
              >
                Edit
              </button>
              <button
                type="button"
                role="menuitem"
                className={`${styles.menuItem} ${styles.menuItemDanger}`}
                onClick={() => handleDeleteClick(menuKey)}
              >
                Delete
              </button>
            </div>,
            document.body,
          )
        : null}

      {deleteTarget
        ? createPortal(
            <div
              className={styles.confirmRoot}
              role="presentation"
              onClick={() => setDeleteTarget(null)}
            >
              <div
                className={styles.confirmCard}
                role="dialog"
                aria-modal="true"
                aria-labelledby="delete-api-key-title"
                onClick={(e) => e.stopPropagation()}
              >
                <h2 id="delete-api-key-title" className={styles.confirmTitle}>
                  Remove API key?
                </h2>
                <p className={styles.confirmText}>
                  &ldquo;{deleteTarget.name}&rdquo; will be removed from your
                  account.
                </p>
                <div className={styles.confirmActions}>
                  <button
                    type="button"
                    className={styles.confirmCancel}
                    onClick={() => setDeleteTarget(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className={styles.confirmDelete}
                    onClick={() => void confirmDelete()}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
