declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        ready: () => void;
        expand: () => void;
        setHeaderColor?: (color: string) => void;
        setBackgroundColor?: (color: string) => void;
        version?: string;
        initData?: string;
        initDataUnsafe?: Record<string, unknown>;
        openTelegramLink?: (url: string) => void;
        openLink?: (url: string, options?: { try_instant_view?: boolean }) => void;
      };
    };
  }
}

/**
 * Opens a Telegram `t.me` / `telegram.me` URL.
 * In a Mini App uses `openTelegramLink` (Telegram client); otherwise a new browser tab.
 */
export function openTelegramUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return;
  const host = parsed.hostname.toLowerCase();
  const isTelegram =
    host === "t.me" ||
    host === "telegram.me" ||
    host === "telegram.dog" ||
    host.endsWith(".t.me");
  const href = parsed.toString();
  const tg = window.Telegram?.WebApp;
  if (isTelegram && tg?.openTelegramLink) {
    tg.openTelegramLink(href);
    return;
  }
  window.open(href, "_blank", "noopener,noreferrer");
}

/**
 * Opens an arbitrary URL. Inside Telegram WebApp uses `tg.openLink` so the
 * user stays in Telegram (external browser pop-up); falls back to a plain
 * new tab outside Telegram. For t.me links use `openTelegramUrl` instead.
 */
export function openLink(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return;
  const href = parsed.toString();
  const tg = window.Telegram?.WebApp;
  if (tg?.openLink) {
    tg.openLink(href);
    return;
  }
  window.open(href, "_blank", "noopener,noreferrer");
}

/** Opens `https://t.me/{username}` (channel or bot). */
export function openTelegramChannel(username: string): void {
  const clean = username.replace(/^@/, "").replace(/^\s+|\s+$/g, "");
  if (!clean) return;
  openTelegramUrl(`https://t.me/${clean}`);
}

const HEADER = "#121212";
const BG = "#121212";

export function initTelegramWebApp(): void {
  const tg = window.Telegram?.WebApp;
  if (!tg) return;
  tg.ready();
  tg.expand();
  tg.setHeaderColor?.(HEADER);
  tg.setBackgroundColor?.(BG);
}

export function getTelegramWebApp() {
  return window.Telegram?.WebApp ?? null;
}

export function getTelegramUserId(): string | null {
  const tg = getTelegramWebApp();
  const unsafe = tg?.initDataUnsafe;
  if (!unsafe || typeof unsafe !== "object") return null;
  const userRaw = (unsafe as Record<string, unknown>).user;
  if (!userRaw || typeof userRaw !== "object") return null;
  const idRaw = (userRaw as Record<string, unknown>).id;
  if (typeof idRaw === "string" || typeof idRaw === "number") {
    return String(idRaw);
  }
  return null;
}
