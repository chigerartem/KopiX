/**
 * GET /admin?token=ADMIN_SECRET
 *
 * Simple HTML admin panel — shows all subscribers with their status,
 * BingX connection, and subscription info. Protected by a static token
 * from the ADMIN_SECRET env variable. No sensitive data (keys, secrets)
 * is ever included.
 *
 * Usage: open https://kopix.online/admin?token=YOUR_SECRET in any browser.
 */

import type { FastifyInstance } from "fastify";
import { createPrismaClient } from "@kopix/db";

const prisma = createPrismaClient();

function esc(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmt(date: Date | null | undefined): string {
  if (!date) return "—";
  return date.toISOString().slice(0, 10);
}

function statusBadge(status: string): string {
  const colors: Record<string, string> = {
    active: "#22c55e",
    inactive: "#94a3b8",
    paused: "#f59e0b",
    suspended: "#ef4444",
    expired: "#94a3b8",
  };
  const color = colors[status] ?? "#94a3b8";
  return `<span style="background:${color};color:#fff;padding:2px 8px;border-radius:4px;font-size:12px">${esc(status)}</span>`;
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/admin", async (request, reply) => {
    const secret = process.env["ADMIN_SECRET"];
    if (!secret) {
      await reply.status(503).send("ADMIN_SECRET is not configured on the server.");
      return;
    }

    const token = (request.query as Record<string, string>)["token"];
    if (!token || token !== secret) {
      await reply
        .status(401)
        .header("Content-Type", "text/html; charset=utf-8")
        .send("<h2>401 — Неверный токен</h2><p>Добавьте ?token=ADMIN_SECRET в URL.</p>");
      return;
    }

    const subscribers = await prisma.subscriber.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        subscriptions: {
          where: { status: "active", expiresAt: { gt: new Date() } },
          orderBy: { expiresAt: "desc" },
          take: 1,
          include: { plan: true },
        },
      },
    });

    const totalCount = subscribers.length;
    const activeSubCount = subscribers.filter((s) =>
      s.subscriptions.length > 0,
    ).length;
    const connectedCount = subscribers.filter(
      (s) => s.apiKeyEncrypted !== null,
    ).length;

    const rows = subscribers
      .map((s, i) => {
        const sub = s.subscriptions[0];
        const hasKey = s.apiKeyEncrypted !== null;
        return `
        <tr style="background:${i % 2 === 0 ? "#1e293b" : "#0f172a"}">
          <td>${i + 1}</td>
          <td>${esc(String(s.telegramId))}</td>
          <td>${s.telegramUsername ? `@${esc(s.telegramUsername)}` : "—"}</td>
          <td>${fmt(s.createdAt)}</td>
          <td style="text-align:center">${hasKey ? "✅" : "❌"}</td>
          <td>${statusBadge(s.status)}</td>
          <td>${sub ? esc(sub.plan.name) : "—"}</td>
          <td>${sub ? fmt(sub.expiresAt) : "—"}</td>
          <td>${statusBadge(sub?.status ?? "none")}</td>
        </tr>`;
      })
      .join("");

    const now = new Date().toLocaleString("ru-RU", { timeZone: "UTC" });

    const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>KopiX Admin</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0 }
    body { background: #0f172a; color: #e2e8f0; font-family: system-ui, sans-serif; padding: 24px }
    h1 { font-size: 22px; margin-bottom: 4px }
    .meta { color: #64748b; font-size: 13px; margin-bottom: 24px }
    .stats { display: flex; gap: 16px; margin-bottom: 24px; flex-wrap: wrap }
    .stat { background: #1e293b; border-radius: 8px; padding: 16px 24px; min-width: 140px }
    .stat-val { font-size: 32px; font-weight: 700; color: #38bdf8 }
    .stat-label { font-size: 13px; color: #94a3b8; margin-top: 4px }
    .table-wrap { overflow-x: auto }
    table { width: 100%; border-collapse: collapse; font-size: 13px }
    th { background: #0f172a; color: #94a3b8; text-align: left; padding: 10px 12px; border-bottom: 1px solid #1e293b; white-space: nowrap }
    td { padding: 10px 12px; color: #e2e8f0; vertical-align: middle }
    .refresh { margin-bottom: 16px }
    a { color: #38bdf8; text-decoration: none }
    a:hover { text-decoration: underline }
  </style>
</head>
<body>
  <h1>KopiX Admin</h1>
  <div class="meta">Обновлено: ${now} UTC · <a href="?token=${esc(token)}">Обновить</a></div>

  <div class="stats">
    <div class="stat">
      <div class="stat-val">${totalCount}</div>
      <div class="stat-label">Всего пользователей</div>
    </div>
    <div class="stat">
      <div class="stat-val">${connectedCount}</div>
      <div class="stat-label">Подключили BingX</div>
    </div>
    <div class="stat">
      <div class="stat-val">${activeSubCount}</div>
      <div class="stat-label">Активных подписок</div>
    </div>
  </div>

  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>TG ID</th>
          <th>Username</th>

          <th>Зарегистрирован</th>
          <th>BingX</th>
          <th>Статус</th>
          <th>Подписка</th>
          <th>Истекает</th>
          <th>Статус подп.</th>
        </tr>
      </thead>
      <tbody>
        ${rows || '<tr><td colspan="10" style="text-align:center;padding:32px;color:#64748b">Пользователей пока нет</td></tr>'}
      </tbody>
    </table>
  </div>
</body>
</html>`;

    await reply.header("Content-Type", "text/html; charset=utf-8").send(html);
  });
}
