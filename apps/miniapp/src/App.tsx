import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { DashboardPage } from "./pages/DashboardPage";
import { ConnectPage } from "./pages/ConnectPage";
import { SubscribePage } from "./pages/SubscribePage";
import { TradesPage } from "./pages/TradesPage";
import { SettingsPage } from "./pages/SettingsPage";
import { PaymentSuccessPage } from "./pages/PaymentSuccessPage";

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/connect" element={<ConnectPage />} />
        <Route path="/subscribe" element={<SubscribePage />} />
        <Route path="/trades" element={<TradesPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
      <Route path="/payment-success" element={<PaymentSuccessPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
