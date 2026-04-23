import { useEffect } from "react";
import { KOPIX_SUPPORT_TELEGRAM_URL } from "@/config/links";
import styles from "./DashboardSideMenu.module.css";

type DashboardSideMenuProps = {
  open: boolean;
  onClose: () => void;
};

export function DashboardSideMenu({ open, onClose }: DashboardSideMenuProps) {
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
            <a
              className={styles.item}
              href={KOPIX_SUPPORT_TELEGRAM_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => onClose()}
            >
              Support
            </a>
          </li>
        </ul>
      </nav>
    </div>
  );
}
