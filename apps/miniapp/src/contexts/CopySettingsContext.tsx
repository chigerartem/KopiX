/**
 * Copy settings form state + localStorage persistence (no backend).
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { getTelegramWebApp } from "@/services/telegram";

export type CopyMode = "proportional" | "fixed";

const BASE_STORAGE_KEY = "kopix_copy_settings_v1";

type StoredV1 = {
  v: 1;
  copyMode: CopyMode;
  proportionalPercent: string;
  fixedAmountUsdt: string;
  selectedApiKeyId: string | null;
};

const DEFAULTS: Omit<StoredV1, "v"> = {
  copyMode: "proportional",
  proportionalPercent: "10",
  fixedAmountUsdt: "100",
  selectedApiKeyId: null,
};

function normalizePercentString(raw: string): string {
  if (raw === "" || raw === ".") return "1";
  const n = Number.parseFloat(raw);
  if (Number.isNaN(n)) return "1";
  return String(Math.min(100, Math.max(1, n)));
}

function getScopedStorageKey(): string {
  const tg = getTelegramWebApp();
  const unsafe = tg?.initDataUnsafe;
  const userRaw =
    unsafe && typeof unsafe === "object"
      ? (unsafe as Record<string, unknown>).user
      : null;
  const user =
    userRaw && typeof userRaw === "object"
      ? (userRaw as Record<string, unknown>)
      : null;
  const idRaw = user?.id;
  const id = typeof idRaw === "number" || typeof idRaw === "string"
    ? String(idRaw)
    : "";
  return id ? `${BASE_STORAGE_KEY}_${id}` : BASE_STORAGE_KEY;
}

function readStored(storageKey: string): Omit<StoredV1, "v"> {
  if (typeof window === "undefined") return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return { ...DEFAULTS };
    const o = JSON.parse(raw) as Partial<StoredV1>;
    if (!o || o.v !== 1) return { ...DEFAULTS };
    const copyMode: CopyMode =
      o.copyMode === "fixed" ? "fixed" : "proportional";
    return {
      copyMode,
      proportionalPercent:
        typeof o.proportionalPercent === "string"
          ? o.proportionalPercent
          : DEFAULTS.proportionalPercent,
      fixedAmountUsdt:
        typeof o.fixedAmountUsdt === "string"
          ? o.fixedAmountUsdt
          : DEFAULTS.fixedAmountUsdt,
      selectedApiKeyId:
        typeof o.selectedApiKeyId === "string"
          ? o.selectedApiKeyId
          : o.selectedApiKeyId === null
            ? null
            : DEFAULTS.selectedApiKeyId,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function writeStored(storageKey: string, payload: Omit<StoredV1, "v">) {
  if (typeof window === "undefined") return;
  try {
    const data: StoredV1 = { v: 1, ...payload };
    localStorage.setItem(storageKey, JSON.stringify(data));
  } catch {
    /* ignore */
  }
}

type CopySettingsContextValue = {
  copyMode: CopyMode;
  setCopyMode: (m: CopyMode) => void;
  proportionalPercent: string;
  setProportionalPercent: (v: string) => void;
  fixedAmountUsdt: string;
  setFixedAmountUsdt: (v: string) => void;
  selectedApiKeyId: string | null;
  setSelectedApiKeyId: (id: string | null) => void;
  apiKeyExpanded: boolean;
  setApiKeyExpanded: (open: boolean) => void;
  toggleApiKeySection: () => void;
  /** Normalize percent, update state, persist all fields (edit mode + checkout draft). */
  saveCopySettings: () => void;
};

const CopySettingsContext = createContext<CopySettingsContextValue | null>(
  null,
);

export function CopySettingsProvider({ children }: { children: ReactNode }) {
  const storageKey = getScopedStorageKey();
  const initial = useMemo(() => readStored(storageKey), [storageKey]);

  const [copyMode, setCopyMode] = useState<CopyMode>(() => initial.copyMode);
  const [proportionalPercent, setProportionalPercent] = useState(
    () => initial.proportionalPercent,
  );
  const [fixedAmountUsdt, setFixedAmountUsdt] = useState(
    () => initial.fixedAmountUsdt,
  );
  const [selectedApiKeyId, setSelectedApiKeyId] = useState<string | null>(
    () => initial.selectedApiKeyId,
  );
  const [apiKeyExpanded, setApiKeyExpanded] = useState(true);

  const toggleApiKeySection = useCallback(() => {
    setApiKeyExpanded((v) => !v);
  }, []);

  const saveCopySettings = useCallback(() => {
    const pct = normalizePercentString(proportionalPercent);
    setProportionalPercent(pct);
    const payload = {
      copyMode,
      proportionalPercent: pct,
      fixedAmountUsdt,
      selectedApiKeyId,
    };
    writeStored(storageKey, payload);
  }, [
    copyMode,
    proportionalPercent,
    fixedAmountUsdt,
    selectedApiKeyId,
    storageKey,
  ]);

  const value = useMemo(
    () => ({
      copyMode,
      setCopyMode,
      proportionalPercent,
      setProportionalPercent,
      fixedAmountUsdt,
      setFixedAmountUsdt,
      selectedApiKeyId,
      setSelectedApiKeyId,
      apiKeyExpanded,
      setApiKeyExpanded,
      toggleApiKeySection,
      saveCopySettings,
    }),
    [
      copyMode,
      proportionalPercent,
      fixedAmountUsdt,
      selectedApiKeyId,
      apiKeyExpanded,
      toggleApiKeySection,
      saveCopySettings,
    ],
  );

  return (
    <CopySettingsContext.Provider value={value}>
      {children}
    </CopySettingsContext.Provider>
  );
}

export function useCopySettings(): CopySettingsContextValue {
  const ctx = useContext(CopySettingsContext);
  if (!ctx) {
    throw new Error("useCopySettings must be used within CopySettingsProvider");
  }
  return ctx;
}
