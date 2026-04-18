import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createApi, Plan, SubscriberProfile, ApiError } from "../api/client";
import { useTma } from "../hooks/useTma";
import { Spinner } from "../components/Spinner";
import { ErrorMessage } from "../components/ErrorMessage";

export function SubscribePage() {
  const { initData, openInvoice } = useTma();
  const navigate = useNavigate();

  const [plans, setPlans] = useState<Plan[]>([]);
  const [profile, setProfile] = useState<SubscriberProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [buyingId, setBuyingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const api = createApi(initData);
    Promise.all([api.getPlans(), api.getProfile()])
      .then(([p, pr]) => {
        setPlans(p);
        setProfile(pr);
      })
      .catch(() => setError("Не удалось загрузить планы"))
      .finally(() => setLoading(false));
  }, []);

  async function handleBuy(plan: Plan) {
    setBuyingId(plan.id);
    setError(null);
    try {
      const api = createApi(initData);
      const invoice = await api.createInvoice(plan.id);
      openInvoice(invoice.miniAppInvoiceUrl, (status) => {
        if (status === "paid") {
          navigate("/payment-success");
        }
      });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(`Ошибка создания счёта (${err.status})`);
      } else {
        setError("Не удалось создать счёт. Попробуйте ещё раз");
      }
    } finally {
      setBuyingId(null);
    }
  }

  if (loading) return <Spinner />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <h2 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 700 }}>
        Подписка
      </h2>

      {profile?.subscription && (
        <div className="card" style={{ color: "var(--hint)", fontSize: "0.9rem" }}>
          Текущий план: <strong style={{ color: "var(--text)" }}>{profile.subscription.planName}</strong>
        </div>
      )}

      {error && <ErrorMessage message={error} />}

      {plans.map((plan) => (
        <div key={plan.id} className="card" style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <div style={{ fontWeight: 700, fontSize: "1rem" }}>{plan.name}</div>
          <div style={{ color: "var(--hint)", fontSize: "0.85rem" }}>
            {plan.durationDays} дн. · {plan.price} {plan.currency}
          </div>
          <button
            className="btn"
            onClick={() => handleBuy(plan)}
            disabled={buyingId !== null}
          >
            {buyingId === plan.id ? "Создаём счёт..." : `Купить — ${plan.price} ${plan.currency}`}
          </button>
        </div>
      ))}
    </div>
  );
}
