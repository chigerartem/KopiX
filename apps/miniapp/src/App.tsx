/**
 * Root application shell and route table.
 *
 * Miniapp is a read-only dashboard:
 *   / → splash → /dashboard (balance, subscription status, open trades)
 *   /trades      → full trades list
 *
 * API key connection, copy settings, and subscription purchase are handled
 * entirely in the Telegram bot (/connect, /mode, /subscribe).
 */
import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { initTelegramWebApp } from "@/services/telegram";
import { SplashPage } from "@/pages/SplashPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { TradesPage } from "@/pages/TradesPage";
import styles from "./App.module.css";

export default function App() {
  useEffect(() => {
    initTelegramWebApp();
  }, []);

  return (
    <div className={styles.viewport}>
      <div className={styles.frame}>
        <Routes>
          <Route path="/" element={<SplashPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/trades" element={<TradesPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </div>
  );
}
