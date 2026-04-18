import { useEffect, useState } from "react";
import { createApi, SubscriberProfile } from "../api/client";
import { useTma } from "../hooks/useTma";
import { Spinner } from "../components/Spinner";
import { ErrorMessage } from "../components/ErrorMessage";

export function SettingsPage() {
  const { initData } = useTma();

  const [profile, setProfile] = useState<SubscriberProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [copyMode, setCopyMode] = useState<"fixed" | "percentage">("fixed");
  const [fixedAmount, setFixedAmount] = useState("");
  const [percentage, setPercentage] = useState("");
  const [maxPosition, setMaxPosition] = useState("");

  useEffect(() => {
    const api = createApi(initData);
    api
      .getProfile()
      .then((p) => {
        setProfile(p);
        setCopyMode(p.copyMode ?? "fixed");
        setFixedAmount(p.fixedAmount?.toString() ?? "");
        setPercentage(p.percentage?.toString() ?? "");
        setMaxPosition(p.maxPositionUsdt?.toString() ?? "");
      })
      .catch(() => setError("Не удалось загрузить настройки"))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const api = createApi(initData);
      const updated = await api.updateProfile({
        copyMode,
        fixedAmount: copyMode === "fixed" ? parseFloat(fixedAmount) || null : null,
        percentage: copyMode === "percentage" ? parseFloat(percentage) || null : null,
        maxPositionUsdt: maxPosition ? parseFloat(maxPosition) : null,
      });
      setProfile(updated);
      setSuccess(true);
    } catch {
      setError("Не удалось сохранить настройки");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(action: "pause" | "resume") {
    setToggling(true);
    setError(null);
    try {
      const api = createApi(initData);
      const updated = await api.updateProfile({ action });
      setProfile(updated);
    } catch {
      setError("Не удалось изменить статус");
    } finally {
      setToggling(false);
    }
  }

  if (loading) return <Spinner />;
  if (!profile) return <ErrorMessage message={error ?? "Нет данных"} />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <h2 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 700 }}>
        Настройки
      </h2>

      <form
        onSubmit={handleSave}
        style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
      >
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <div style={{ fontWeight: 600 }}>Режим копирования</div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            {(["fixed", "percentage"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setCopyMode(mode)}
                style={{
                  flex: 1,
                  padding: "0.5rem",
                  borderRadius: "0.5rem",
                  border: "1px solid",
                  borderColor: copyMode === mode ? "var(--button)" : "rgba(255,255,255,0.12)",
                  background: copyMode === mode ? "rgba(68,153,233,0.15)" : "transparent",
                  color: copyMode === mode ? "var(--button)" : "var(--hint)",
                  cursor: "pointer",
                  fontWeight: 600,
                  fontSize: "0.9rem",
                }}
              >
                {mode === "fixed" ? "Фиксированный" : "Процент"}
              </button>
            ))}
          </div>

          {copyMode === "fixed" && (
            <div>
              <label style={{ display: "block", marginBottom: "0.4rem", color: "var(--hint)", fontSize: "0.85rem" }}>
                Сумма (USDT)
              </label>
              <input
                className="input"
                type="number"
                min="1"
                step="any"
                value={fixedAmount}
                onChange={(e) => setFixedAmount(e.target.value)}
              />
            </div>
          )}

          {copyMode === "percentage" && (
            <div>
              <label style={{ display: "block", marginBottom: "0.4rem", color: "var(--hint)", fontSize: "0.85rem" }}>
                Процент от баланса (%)
              </label>
              <input
                className="input"
                type="number"
                min="1"
                max="100"
                step="any"
                value={percentage}
                onChange={(e) => setPercentage(e.target.value)}
              />
            </div>
          )}

          <div>
            <label style={{ display: "block", marginBottom: "0.4rem", color: "var(--hint)", fontSize: "0.85rem" }}>
              Макс. позиция (USDT, необязательно)
            </label>
            <input
              className="input"
              type="number"
              min="1"
              step="any"
              value={maxPosition}
              onChange={(e) => setMaxPosition(e.target.value)}
            />
          </div>
        </div>

        {error && <ErrorMessage message={error} />}
        {success && (
          <div
            style={{
              background: "rgba(63,185,80,0.12)",
              border: "1px solid var(--success)",
              borderRadius: "0.5rem",
              padding: "0.75rem 1rem",
              color: "var(--success)",
              fontSize: "0.9rem",
            }}
          >
            Настройки сохранены
          </div>
        )}

        <button className="btn" type="submit" disabled={saving}>
          {saving ? "Сохраняем..." : "Сохранить"}
        </button>
      </form>

      <div className="card" style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <div style={{ fontWeight: 600 }}>Статус копирования</div>
        <div style={{ color: "var(--hint)", fontSize: "0.85rem" }}>
          Текущий статус:{" "}
          <strong style={{ color: "var(--text)" }}>{profile.status}</strong>
        </div>
        {profile.status === "active" && (
          <button
            className="btn-danger"
            type="button"
            onClick={() => handleToggle("pause")}
            disabled={toggling}
          >
            {toggling ? "..." : "Поставить на паузу"}
          </button>
        )}
        {profile.status === "paused" && (
          <button
            className="btn"
            type="button"
            onClick={() => handleToggle("resume")}
            disabled={toggling}
          >
            {toggling ? "..." : "Возобновить копирование"}
          </button>
        )}
      </div>
    </div>
  );
}
