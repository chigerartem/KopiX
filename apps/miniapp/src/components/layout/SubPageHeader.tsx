import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import styles from "./SubPageHeader.module.css";

type SubPageHeaderProps = {
  title: string;
  /** Optional right slot (e.g. close). Default: empty spacer for centered title. */
  right?: ReactNode;
  /** If set, back calls this instead of browser history −1. */
  onBack?: () => void;
};

export function SubPageHeader({ title, right, onBack }: SubPageHeaderProps) {
  const navigate = useNavigate();

  const handleBack = () => {
    if (onBack) onBack();
    else navigate(-1);
  };

  return (
    <header className={styles.header}>
      <button
        type="button"
        className={styles.back}
        onClick={handleBack}
        aria-label="Back"
      >
        <ChevronLeft size={22} strokeWidth={2} aria-hidden />
      </button>
      <h1 className={styles.title}>{title}</h1>
      {right != null ? (
        <div className={styles.right}>{right}</div>
      ) : (
        <span className={styles.spacer} aria-hidden />
      )}
    </header>
  );
}
