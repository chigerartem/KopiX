/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface TelegramWebApp {
  initData: string;
  initDataUnsafe: {
    user?: {
      id: number;
      first_name: string;
      last_name?: string;
      username?: string;
    };
  };
  colorScheme: "light" | "dark";
  ready(): void;
  expand(): void;
  close(): void;
  openInvoice(url: string, callback?: (status: string) => void): void;
}

interface Window {
  Telegram?: {
    WebApp: TelegramWebApp;
  };
}
