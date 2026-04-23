import { Home, LineChart } from "lucide-react";
import styles from "./BottomTabBar.module.css";

const TABS = [
  { id: "home", label: "Home", Icon: Home },
  { id: "trades", label: "Trades", Icon: LineChart },
] as const;

export type TabId = (typeof TABS)[number]["id"];

type BottomTabBarProps = {
  active: TabId;
  onChange?: (id: TabId) => void;
};

export function BottomTabBar({ active, onChange }: BottomTabBarProps) {
  return (
    <div className={styles.barOuter}>
      <nav className={styles.bar} aria-label="Main navigation">
        {TABS.map(({ id, label, Icon }) => {
          const isActive = id === active;
          return (
            <button
              key={id}
              type="button"
              className={`${styles.tab} ${isActive ? styles.tabActive : ""}`}
              onClick={() => onChange?.(id)}
              aria-current={isActive ? "page" : undefined}
            >
              <Icon
                className={styles.icon}
                strokeWidth={isActive ? 2.25 : 1.85}
                size={22}
              />
              <span className={styles.label}>{label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
