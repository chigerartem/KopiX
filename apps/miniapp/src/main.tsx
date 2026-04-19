/**
 * Entry point: mounts React, enables React Router, and wraps the tree in AppStateProvider.
 *
 * AppStateProvider — placeholder global state (subscription / API key flags) for future backend.
 * ApiKeysProvider lives inside App.tsx so it can wrap route content only.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AppStateProvider } from "@/contexts/AppStateContext";
import App from "@/App";
import "@/styles/global.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AppStateProvider>
        <App />
      </AppStateProvider>
    </BrowserRouter>
  </StrictMode>,
);
