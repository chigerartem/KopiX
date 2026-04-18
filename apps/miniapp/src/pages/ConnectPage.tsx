import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createApi, ApiError } from "../api/client";
import { useTma } from "../hooks/useTma";
import { ErrorMessage } from "../components/ErrorMessage";

export function ConnectPage() {
  const { initData } = useTma();
  const navigate = useNavigate();

  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const api = createApi(initData);
      const result = await api.validateExchange({ apiKey, apiSecret });
      if (result.connected) {
        navigate("/");
      } else {
        setError("Ключи недействительны или нет доступа к фьючерсам");
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        setError("Ключи отклонены: убедитесь, что нет разрешения на вывод средств");
      } else {
        setError("Ошибка подключения. Попробуйте ещё раз");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <h2 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 700 }}>
        Подключить BingX
      </h2>

      <div
        style={{
          background: "rgba(68,153,233,0.1)",
          border: "1px solid rgba(68,153,233,0.3)",
          borderRadius: "0.5rem",
          padding: "0.75rem 1rem",
          color: "var(--hint)",
          fontSize: "0.85rem",
        }}
      >
        🔒 Ключи должны быть только для торговли. Разрешение на вывод средств недопустимо.
      </div>

      <form
        onSubmit={handleSubmit}
        style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
      >
        <div>
          <label
            style={{ display: "block", marginBottom: "0.4rem", color: "var(--hint)", fontSize: "0.85rem" }}
          >
            API Key
          </label>
          <input
            className="input"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            required
            autoComplete="off"
          />
        </div>

        <div>
          <label
            style={{ display: "block", marginBottom: "0.4rem", color: "var(--hint)", fontSize: "0.85rem" }}
          >
            API Secret
          </label>
          <input
            className="input"
            type="password"
            value={apiSecret}
            onChange={(e) => setApiSecret(e.target.value)}
            required
            autoComplete="off"
          />
        </div>

        {error && <ErrorMessage message={error} />}

        <button className="btn" type="submit" disabled={loading}>
          {loading ? "Проверяем..." : "Подключить"}
        </button>
      </form>
    </div>
  );
}
