import { useNavigate } from "react-router-dom";

export function PaymentSuccessPage() {
  const navigate = useNavigate();

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        gap: "1rem",
        padding: "2rem",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: "4rem" }}>✅</div>
      <h1 style={{ margin: 0, fontSize: "1.4rem", fontWeight: 700 }}>
        Оплата прошла!
      </h1>
      <p style={{ margin: 0, color: "var(--hint)", fontSize: "0.95rem" }}>
        Подписка активирована.
      </p>
      <button
        className="btn"
        style={{ maxWidth: 280 }}
        onClick={() => navigate("/")}
      >
        На главную
      </button>
    </div>
  );
}
