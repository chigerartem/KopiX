import { NavLink, Outlet, useLocation } from "react-router-dom";

const NAV_ITEMS = [
  { to: "/", label: "Главная", icon: "🏠" },
  { to: "/trades", label: "Сделки", icon: "📊" },
  { to: "/settings", label: "Настройки", icon: "⚙️" },
] as const;

export function Layout() {
  const location = useLocation();

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ flex: 1, overflowY: "auto", padding: "1rem" }}>
        <Outlet />
      </div>
      <nav
        style={{
          display: "flex",
          background: "var(--surface)",
          borderTop: "1px solid rgba(255,255,255,0.08)",
          position: "sticky",
          bottom: 0,
        }}
      >
        {NAV_ITEMS.map(({ to, label, icon }) => {
          const isActive =
            to === "/"
              ? location.pathname === "/"
              : location.pathname.startsWith(to);
          return (
            <NavLink
              key={to}
              to={to}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                padding: "0.6rem 0",
                textDecoration: "none",
                color: isActive ? "var(--button)" : "var(--hint)",
                fontSize: "0.7rem",
                gap: "0.2rem",
              }}
            >
              <span style={{ fontSize: "1.4rem" }}>{icon}</span>
              {label}
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}
