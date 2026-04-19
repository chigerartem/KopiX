import { useLayoutEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { BingXLogo } from "@/components/branding/BingXLogo";
import { useApiKeys } from "@/contexts/ApiKeysContext";
import {
  BINGX_BROKER_ID,
  BINGX_BROKER_NAME,
  postCredentials,
  updateCredentials,
} from "@/services/api";
import styles from "./ApiKeysAddPage.module.css";

export function ApiKeysAddPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { keyId } = useParams<{ keyId: string }>();
  const returnTo =
    (location.state as { returnTo?: string } | null)?.returnTo ?? "/api-keys";
  const isEdit = Boolean(keyId);

  const { keys, refreshKeys } = useApiKeys();
  const [keyName, setKeyName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [secret, setSecret] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const existing = useMemo(() => {
    if (!keyId) return undefined;
    return keys.find((k) => k.id === keyId);
  }, [keyId, keys]);

  useLayoutEffect(() => {
    if (!keyId) {
      setKeyName("");
      setApiKey("");
      setSecret("");
      return;
    }
    if (!existing) {
      navigate("/api-keys", { replace: true });
      return;
    }
    setKeyName(existing.name);
    setApiKey("");
    setSecret("");
  }, [keyId, existing, navigate]);

  const canSubmit =
    keyName.trim() !== "" && apiKey.trim() !== "" && secret.trim() !== "";

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <div className={styles.topBar}>
          <button
            type="button"
            className={styles.back}
            onClick={() => navigate(-1)}
            aria-label="Back"
          >
            <ChevronLeft size={22} strokeWidth={2} aria-hidden />
          </button>
        </div>

        <div className={styles.brandBlock}>
          <BingXLogo size={64} className={styles.heroLogo} />
          <h1 className={styles.connectTitle}>
            {isEdit ? "Edit BingX API" : "Connect BingX API"}
          </h1>
        </div>

        <form
          className={styles.form}
          onSubmit={async (e) => {
            e.preventDefault();
            if (!canSubmit) return;
            setSubmitError(null);
            if (isEdit && keyId) {
              setIsSubmitting(true);
              try {
                await updateCredentials(keyId, {
                  name: keyName.trim(),
                  apiKey: apiKey.trim(),
                  apiSecret: secret.trim(),
                });
                await refreshKeys();
                navigate(returnTo, { replace: true });
              } catch (err) {
                const msg =
                  err instanceof Error && err.message
                    ? err.message
                    : "Failed to update API key";
                setSubmitError(msg);
              } finally {
                setIsSubmitting(false);
              }
              return;
            }
            setIsSubmitting(true);
            try {
              const payload = {
                name: keyName.trim(),
                apiKey: apiKey.trim(),
                apiSecret: secret.trim(),
                brokerName: BINGX_BROKER_NAME,
                brokerId: BINGX_BROKER_ID,
                type: "apiKey",
              } as const;
              await postCredentials(payload);
              await refreshKeys();
              navigate(returnTo, { replace: true });
            } catch (err) {
              const msg =
                err instanceof Error && err.message
                  ? err.message
                  : "Failed to add API key";
              setSubmitError(msg);
            } finally {
              setIsSubmitting(false);
            }
          }}
        >
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="bingx-key-name">
              Key name
            </label>
            <input
              id="bingx-key-name"
              className={styles.fieldInput}
              placeholder="Name this connection"
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
              autoComplete="off"
            />
          </div>

          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="bingx-api-key">
              API key
            </label>
            <input
              id="bingx-api-key"
              className={styles.fieldInput}
              placeholder="Paste API key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="bingx-secret">
              Secret key
            </label>
            <input
              id="bingx-secret"
              type="password"
              className={styles.fieldInput}
              placeholder="Paste secret key"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          {submitError ? (
            <p role="alert" className={styles.helperText}>
              {submitError}
            </p>
          ) : null}

          <div className={styles.footer}>
            <button
              type="submit"
              className={styles.submit}
              disabled={!canSubmit || isSubmitting}
            >
              {isSubmitting
                ? "Saving..."
                : isEdit
                  ? "Save Changes"
                  : "Add API Key"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
