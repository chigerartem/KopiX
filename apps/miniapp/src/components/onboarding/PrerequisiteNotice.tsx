/**
 * Inline gate shown when a page is reached out of onboarding order.
 *
 * E.g. /copy-settings without an active subscription renders one of these
 * pointing the user back to /subscription/setup.
 */
import { useNavigate } from "react-router-dom";
import { ArrowRight, Lock } from "lucide-react";
import styles from "./PrerequisiteNotice.module.css";

export type PrerequisiteNoticeProps = {
  title: string;
  body: string;
  cta: string;
  to: string;
};

export function PrerequisiteNotice({ title, body, cta, to }: PrerequisiteNoticeProps) {
  const navigate = useNavigate();

  return (
    <section className={styles.card} aria-live="polite">
      <div className={styles.head}>
        <span className={styles.iconWrap} aria-hidden>
          <Lock size={18} />
        </span>
        <h2 className={styles.title}>{title}</h2>
      </div>
      <p className={styles.body}>{body}</p>
      <button type="button" className={styles.cta} onClick={() => navigate(to)}>
        <span>{cta}</span>
        <ArrowRight size={16} aria-hidden />
      </button>
    </section>
  );
}
