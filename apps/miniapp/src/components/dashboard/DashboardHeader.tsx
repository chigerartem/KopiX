import { Menu } from "lucide-react";
import { BrandLogoImage } from "@/components/branding/BrandLogoImage";
import styles from "./DashboardHeader.module.css";

type DashboardHeaderProps = {
  onMenuClick: () => void;
};

/**
 * Top bar: menu (left), centered logo (KopiX).
 */
export function DashboardHeader({ onMenuClick }: DashboardHeaderProps) {
  return (
    <header className={styles.header}>
      <button
        type="button"
        className={styles.menuBtn}
        onClick={onMenuClick}
        aria-label="Open menu"
      >
        <Menu className={styles.menuIcon} size={22} strokeWidth={2} aria-hidden />
      </button>
      <div className={styles.logoWrap}>
        <BrandLogoImage variant="header" />
      </div>
      <span className={styles.headerSpacer} aria-hidden />
    </header>
  );
}
