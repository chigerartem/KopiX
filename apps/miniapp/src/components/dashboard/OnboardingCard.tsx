/**
 * Guided "Step N of 3" card shown on the dashboard until the subscriber
 * completes the setup flow (subscribe → connect BingX → set copy mode).
 *
 * The current step is derived in SubscriberContext from the server profile,
 * so this component is purely presentational — it renders one CTA pointing
 * at the next required screen.
 */
import { useNavigate } from "react-router-dom";
import { ArrowRight, CreditCard, KeyRound, Sliders } from "lucide-react";
import {
  ONBOARDING_TOTAL,
  stepIndex,
  type OnboardingStep,
} from "@/contexts/SubscriberContext";
import styles from "./OnboardingCard.module.css";

type StepCopy = {
  Icon: typeof CreditCard;
  title: string;
  body: string;
  cta: string;
  to: string;
};

const COPY: Record<Exclude<OnboardingStep, "done">, StepCopy> = {
  subscribe: {
    Icon: CreditCard,
    title: "Activate your subscription",
    body: "Pick a plan and pay with CryptoBot in USDT. Your subscription unlocks the rest of the setup.",
    cta: "Subscribe",
    to: "/subscription/setup",
  },
  api_key: {
    Icon: KeyRound,
    title: "Connect your BingX account",
    body: "Add a trade-only BingX API key (withdraw must be disabled) so KopiX can copy the master's trades to your account.",
    cta: "Add API key",
    to: "/api-keys/add",
  },
  copy_settings: {
    Icon: Sliders,
    title: "Set your copy mode",
    body: "Choose a fixed USDT size or a percentage of your balance for each copied trade. You can change this later.",
    cta: "Configure copy settings",
    to: "/copy-settings",
  },
};

export function OnboardingCard({ step }: { step: Exclude<OnboardingStep, "done"> }) {
  const navigate = useNavigate();
  const copy = COPY[step];
  const Icon = copy.Icon;
  const current = stepIndex(step);

  return (
    <section className={styles.card} aria-label="Setup">
      <div className={styles.head}>
        <span className={styles.iconWrap} aria-hidden>
          <Icon size={18} />
        </span>
        <div className={styles.headText}>
          <p className={styles.eyebrow}>
            Step {current} of {ONBOARDING_TOTAL}
          </p>
          <h2 className={styles.title}>{copy.title}</h2>
        </div>
      </div>

      <div className={styles.steps} aria-hidden>
        {Array.from({ length: ONBOARDING_TOTAL }).map((_, i) => {
          const idx = i + 1;
          const cls =
            idx < current
              ? `${styles.stepDot} ${styles.stepDotDone}`
              : idx === current
                ? `${styles.stepDot} ${styles.stepDotActive}`
                : styles.stepDot;
          return <span key={idx} className={cls} />;
        })}
      </div>

      <p className={styles.body}>{copy.body}</p>

      <button
        type="button"
        className={styles.cta}
        onClick={() => navigate(copy.to)}
      >
        <span>{copy.cta}</span>
        <ArrowRight size={16} aria-hidden />
      </button>
    </section>
  );
}
