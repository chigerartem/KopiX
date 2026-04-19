import { Wallet } from "lucide-react";
import styles from "./BalanceCard.module.css";

export type BalanceCardStats = {
  totalBalanceUsdt: number;
  pnlTodayUsdt: number;
  pnlTodayPct: number;
};

const DEFAULT_STATS: BalanceCardStats = {
  totalBalanceUsdt: 0,
  pnlTodayUsdt: 0,
  pnlTodayPct: 0,
};

type BalanceCardProps = {
  stats?: Partial<BalanceCardStats>;
};

function mergeDefaults(overrides?: Partial<BalanceCardStats>): BalanceCardStats {
  return { ...DEFAULT_STATS, ...overrides };
}

export function BalanceCard({ stats: statsProp }: BalanceCardProps) {
  const s = mergeDefaults(statsProp);
  const pnlUp = s.pnlTodayUsdt > 0;
  const pnlDown = s.pnlTodayUsdt < 0;
  const pnlTone = pnlUp ? styles.pnlUp : pnlDown ? styles.pnlDown : styles.pnlFlat;

  return (
    <section className={styles.card} aria-label="Balance">
      <p className={styles.labelRow}>
        <Wallet className={styles.labelIcon} size={15} strokeWidth={2} aria-hidden />
        <span className={styles.label}>Total Balance</span>
      </p>
      <p className={styles.balance}>
        {s.totalBalanceUsdt.toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}{" "}
        <span className={styles.unit}>USDT</span>
      </p>
      <p className={`${styles.pnl} ${pnlTone}`}>
        {s.pnlTodayUsdt > 0 ? "+" : ""}
        {s.pnlTodayUsdt.toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}{" "}
        USDT
        <span className={styles.pnlPct}>
          {" "}
          ({s.pnlTodayPct > 0 ? "+" : ""}
          {s.pnlTodayPct.toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
          %)
        </span>
      </p>
    </section>
  );
}
