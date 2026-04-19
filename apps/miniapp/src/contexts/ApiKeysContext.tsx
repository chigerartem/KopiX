import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { deleteCredentials, getCredentialsList } from "@/services/api";

export type BingXApiKeyRecord = {
  id: string;
  name: string;
  status: "connected";
}

type ApiKeysContextValue = {
  keys: BingXApiKeyRecord[];
  refreshKeys: () => Promise<void>;
  removeKey: (id: string) => Promise<void>;
};

const ApiKeysContext = createContext<ApiKeysContextValue | null>(null);

export function ApiKeysProvider({ children }: { children: ReactNode }) {
  const [keys, setKeys] = useState<BingXApiKeyRecord[]>([]);

  const refreshKeys = useCallback(async () => {
    const list = await getCredentialsList();
    setKeys(
      list
        .filter((x) => x.brokerAccountId)
        .map((x) => ({
          id: x.brokerAccountId,
          name: x.accountLabel || x.brokerName || "BingX",
          status: "connected" as const,
        })),
    );
  }, []);

  const removeKey = useCallback(
    async (id: string) => {
      await deleteCredentials(id);
      await refreshKeys();
    },
    [refreshKeys],
  );

  useEffect(() => {
    void refreshKeys();
  }, [refreshKeys]);

  const value = useMemo(
    () => ({
      keys,
      refreshKeys,
      removeKey,
    }),
    [keys, refreshKeys, removeKey],
  );

  return (
    <ApiKeysContext.Provider value={value}>{children}</ApiKeysContext.Provider>
  );
}

export function useApiKeys() {
  const ctx = useContext(ApiKeysContext);
  if (!ctx) {
    throw new Error("useApiKeys must be used within ApiKeysProvider");
  }
  return ctx;
}
