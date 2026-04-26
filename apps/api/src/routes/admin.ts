/**
 * GET  /api/admin?token=ADMIN_SECRET          — HTML admin panel
 * POST /api/admin/broadcast?token=ADMIN_SECRET — send broadcast via Telegram Bot API
 *
 * Protected by a static token from ADMIN_SECRET env var.
 * No sensitive data (keys, secrets) is ever included or returned.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
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

type AuthSource = "header" | "query";

/**
 * Append-only audit log for every privileged admin action. Stores the LAST
 * 8 chars of the admin secret used so we can attribute actions across
 * rotations without ever persisting the full secret a second time.
 */
async function audit(
  action: string,
  request: FastifyRequest,
  token: string,
  details?: Record<string, unknown>,
): Promise<void> {
  try {
    await prisma.adminAuditLog.create({
      data: {
        action,
        actorSuffix: token.slice(-8),
        ip: request.ip,
        details: (details ?? null) as never,
      },
    });
  } catch (err: unknown) {
    request.log.warn({ event: "admin.audit_failed", action, err: String(err) }, "Failed to write audit log");
  }
}

/**
 * Admin authentication.
 *
 *   - Authorization: Bearer <token>  (preferred — never logged by Caddy/nginx access logs)
 *   - ?token=<token>                 (browser-navigation fallback for the HTML page)
 *
 * The HTML GET endpoint accepts both so the operator can bookmark the URL.
 * Mutating endpoints (POST /broadcast, PATCH /plans/:id) require the header
 * so tokens never leak into proxy access logs or browser history.
 */
function checkAuth(
  request: FastifyRequest,
  reply: FastifyReply,
  opts: { allowQueryToken?: boolean } = {},
): { ok: true; token: string; source: AuthSource } | { ok: false } {
  const secret = process.env["ADMIN_SECRET"];
  if (!secret) {
    void reply.status(503).send("ADMIN_SECRET is not configured on the server.");
    return { ok: false };
  }

  const authHeader = request.headers["authorization"];
  let token: string | undefined;
  let source: AuthSource | undefined;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    token = authHeader.slice(7).trim();
    source = "header";
  } else if (opts.allowQueryToken) {
    token = (request.query as Record<string, string>)["token"];
    source = "query";
  }

  if (!token || token !== secret) {
    void reply
      .status(401)
      .header("Content-Type", "text/html; charset=utf-8")
      .send(
        opts.allowQueryToken
          ? "<h2>401 — Неверный токен</h2><p>Добавьте ?token=ADMIN_SECRET в URL.</p>"
          : "Unauthorized — provide Authorization: Bearer <ADMIN_SECRET>.",
      );
    return { ok: false };
  }

  return { ok: true, token, source: source! };
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  // ─── GET /api/admin ─────────────────────────────────────────────────────────
  app.get("/api/admin", async (request, reply) => {
    const auth = checkAuth(request, reply, { allowQueryToken: true });
    if (!auth.ok) return;
    const { token, source } = auth;
    if (source === "query") {
      request.log.warn(
        { event: "admin.auth.query_token", ip: request.ip },
        "Admin token passed via query string — prefer Authorization header",
      );
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
    const activeSubCount = subscribers.filter((s) => s.subscriptions.length > 0).length;
    const connectedCount = subscribers.filter((s) => s.apiKeyEncrypted !== null).length;

    // ── Financial metrics ──────────────────────────────────────────────────
    const allSubs = await prisma.subscription.findMany({
      include: { plan: true },
      orderBy: { startedAt: "asc" },
    });

    const nowDate = new Date();
    const startOfMonth = new Date(nowDate.getFullYear(), nowDate.getMonth(), 1);

    const activeSubs = allSubs.filter(
      (s) => s.status === "active" && s.expiresAt > nowDate,
    );
    const mrr = activeSubs.reduce((sum, s) => {
      const days = s.plan.durationDays > 0 ? s.plan.durationDays : 30;
      return sum + (Number(s.amountPaid ?? 0) / days) * 30;
    }, 0);
    const arr = mrr * 12;
    const arpu = activeSubs.length > 0 ? mrr / activeSubs.length : 0;

    const totalRevenue = allSubs.reduce((sum, s) => sum + Number(s.amountPaid ?? 0), 0);
    const monthRevenue = allSubs
      .filter((s) => s.startedAt >= startOfMonth)
      .reduce((sum, s) => sum + Number(s.amountPaid ?? 0), 0);
    const newUsersMonth = subscribers.filter((s) => s.createdAt >= startOfMonth).length;
    const churnMonth = allSubs.filter(
      (s) =>
        (s.status === "expired" || s.status === "cancelled") &&
        s.expiresAt >= startOfMonth &&
        s.expiresAt < nowDate,
    ).length;

    // Currency symbol (use currency from most recent subscription, default $)
    const currencySymbol =
      allSubs.length > 0 ? (allSubs[allSubs.length - 1]?.currency ?? allSubs[allSubs.length - 1]?.plan.currency ?? "$") : "$";
    const fmtCurrency = (n: number): string => {
      const sym = currencySymbol === "USD" || currencySymbol === "USDT" ? "$" : currencySymbol;
      if (n >= 1000) return `${sym}${(n / 1000).toFixed(1)}k`;
      return `${sym}${n.toFixed(0)}`;
    };

    // Monthly breakdown for the last 12 months
    const months12: Array<{ label: string; start: Date; end: Date }> = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(nowDate.getFullYear(), nowDate.getMonth() - i, 1);
      months12.push({
        label: d.toLocaleString("ru-RU", { month: "short", year: "2-digit" }),
        start: d,
        end: new Date(d.getFullYear(), d.getMonth() + 1, 1),
      });
    }
    const chartData = months12.map((m) => ({
      label: m.label,
      newUsers: subscribers.filter((s) => s.createdAt >= m.start && s.createdAt < m.end).length,
      revenue: allSubs
        .filter((s) => s.startedAt >= m.start && s.startedAt < m.end)
        .reduce((sum, s) => sum + Number(s.amountPaid ?? 0), 0),
      active: allSubs.filter(
        (s) => s.status !== "cancelled" && s.startedAt < m.end && s.expiresAt > m.start,
      ).length,
    }));
    const chartJson = JSON.stringify(chartData);

    // ── Plans ──────────────────────────────────────────────────────────────
    const plans = await prisma.plan.findMany({ orderBy: { price: "asc" } });
    const planRows = plans
      .map(
        (p) => `
        <tr id="plan-row-${esc(p.id)}">
          <td>${esc(p.id.slice(0, 8))}…</td>
          <td>${esc(p.name)}</td>
          <td id="plan-price-${esc(p.id)}">${Number(p.price).toFixed(2)}</td>
          <td>${esc(p.currency)}</td>
          <td>${p.durationDays} д.</td>
          <td id="plan-status-${esc(p.id)}">${p.isActive ? '<span style="color:#22c55e">✅ Активен</span>' : '<span style="color:#94a3b8">❌ Скрыт</span>'}</td>
          <td style="display:flex;gap:6px;flex-wrap:wrap">
            <button class="edit-price-btn"
              data-plan-id="${esc(p.id)}"
              data-plan-price="${Number(p.price)}"
              data-plan-name="${esc(p.name)}"
              onclick="openEditPrice(this.dataset.planId,Number(this.dataset.planPrice),this.dataset.planName)"
              style="background:#1d4ed8;color:#fff;border:none;border-radius:6px;padding:5px 14px;font-size:12px;cursor:pointer">
              Изменить цену
            </button>
            <button id="plan-toggle-${esc(p.id)}"
              data-plan-id="${esc(p.id)}"
              data-plan-active="${p.isActive ? 'true' : 'false'}"
              onclick="togglePlan(this.dataset.planId,this.dataset.planActive==='true')"
              style="background:${p.isActive ? '#7f1d1d' : '#14532d'};color:#fff;border:none;border-radius:6px;padding:5px 14px;font-size:12px;cursor:pointer">
              ${p.isActive ? 'Деактивировать' : 'Активировать'}
            </button>
          </td>
        </tr>`,
      )
      .join("");

    const rows = subscribers
      .map((s, i) => {
        const sub = s.subscriptions[0];
        const hasKey = s.apiKeyEncrypted !== null;
        const substatus = sub ? "active" : "none";
        const bingxAttr = hasKey ? "yes" : "no";
        const usernameAttr = s.telegramUsername
          ? s.telegramUsername.toLowerCase()
          : "";
        return `
        <tr data-tgid="${esc(String(s.telegramId))}"
            data-username="${esc(usernameAttr)}"
            data-bingx="${bingxAttr}"
            data-substatus="${substatus}"
            style="background:${i % 2 === 0 ? "#1e293b" : "#0f172a"}">
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
    const tokenJs = JSON.stringify(token);

    const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>KopiX Admin</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#0f172a;color:#e2e8f0;font-family:system-ui,sans-serif;padding:24px}
    h1{font-size:22px;margin-bottom:4px}
    h2{font-size:16px;margin-bottom:12px;color:#cbd5e1}
    .meta{color:#64748b;font-size:13px;margin-bottom:24px}
    .stats{display:flex;gap:16px;margin-bottom:24px;flex-wrap:wrap}
    .stat{background:#1e293b;border-radius:8px;padding:16px 24px;min-width:140px}
    .stat-val{font-size:32px;font-weight:700;color:#38bdf8}
    .stat-label{font-size:13px;color:#94a3b8;margin-top:4px}
    .stat-fin{background:#162032;border:1px solid #1e3a5f;border-radius:8px;padding:14px 20px;min-width:120px}
    .stat-fin .stat-val{font-size:24px;color:#34d399}
    .stat-fin .stat-label{font-size:12px;color:#94a3b8;margin-top:4px}
    .stat-churn .stat-val{color:#f87171}
    .chart-section{background:#1e293b;border-radius:10px;padding:20px 24px;margin-bottom:28px}
    .chart-section h2{margin-bottom:14px}
    .chart-tabs{display:flex;gap:8px;margin-bottom:18px;flex-wrap:wrap}
    .chart-tab{background:#0f172a;border:1px solid #334155;color:#94a3b8;
      border-radius:6px;padding:6px 16px;font-size:13px;cursor:pointer;transition:all .15s}
    .chart-tab:hover{border-color:#475569;color:#e2e8f0}
    .chart-tab.active{background:#1d4ed8;border-color:#1d4ed8;color:#fff}
    .section-title{font-size:13px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;
      margin-bottom:12px;margin-top:28px}

    /* filters */
    .filter-bar{display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap;align-items:center}
    .filter-bar input,.filter-bar select{
      background:#1e293b;border:1px solid #334155;color:#e2e8f0;
      border-radius:6px;padding:7px 12px;font-size:13px;outline:none}
    .filter-bar input{min-width:220px}
    .filter-bar button{background:#334155;color:#e2e8f0;border:none;
      border-radius:6px;padding:7px 14px;font-size:13px;cursor:pointer}
    .filter-bar button:hover{background:#475569}
    .filter-bar .vis{color:#64748b;font-size:13px;margin-left:4px}

    /* table */
    .table-wrap{overflow-x:auto;margin-bottom:40px}
    table{width:100%;border-collapse:collapse;font-size:13px}
    th{background:#0f172a;color:#94a3b8;text-align:left;padding:10px 12px;
       border-bottom:1px solid #1e293b;white-space:nowrap}
    td{padding:10px 12px;color:#e2e8f0;vertical-align:middle}
    a{color:#38bdf8;text-decoration:none}
    a:hover{text-decoration:underline}

    /* broadcast + dm panels */
    .panel-wrap{display:flex;flex-direction:column;gap:20px;max-width:680px}
    .broadcast{background:#1e293b;border-radius:10px;padding:24px}
    .bc-row{display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap;align-items:center}
    .bc-row select{
      background:#0f172a;border:1px solid #334155;color:#e2e8f0;
      border-radius:6px;padding:7px 12px;font-size:13px;outline:none;flex:1;min-width:160px}
    .bc-count{color:#38bdf8;font-weight:600;font-size:13px;white-space:nowrap}
    textarea,input[type=url],input[type=number]{
      background:#0f172a;border:1px solid #334155;color:#e2e8f0;
      border-radius:6px;padding:10px 12px;font-size:13px;outline:none;
      margin-bottom:10px;font-family:inherit}
    textarea{width:100%;resize:vertical;min-height:110px;display:block}
    input[type=url]{width:100%;display:block}
    input[type=number]{width:140px}
    .bc-hint{color:#64748b;font-size:11px;margin-bottom:10px;margin-top:-6px}
    .dm-row{display:flex;gap:10px;margin-bottom:14px;align-items:center;flex-wrap:wrap}
    .dm-label{color:#94a3b8;font-size:13px;white-space:nowrap;font-weight:600}
    .dm-preview{font-size:13px;color:#64748b}
    .send-btn{background:#3b82f6;color:#fff;border:none;border-radius:6px;
      padding:10px 24px;font-size:14px;font-weight:600;cursor:pointer}
    .send-btn:hover{background:#2563eb}
    .send-btn:disabled{background:#334155;color:#64748b;cursor:not-allowed}
    .res-line{margin-top:12px;font-size:13px;font-weight:500}
  </style>
</head>
<body>
  <h1>KopiX Admin</h1>
  <div class="meta">Обновлено: ${now} UTC · <a href="?token=${esc(token)}">Обновить</a></div>

  <div class="stats">
    <div class="stat"><div class="stat-val">${totalCount}</div><div class="stat-label">Всего пользователей</div></div>
    <div class="stat"><div class="stat-val">${connectedCount}</div><div class="stat-label">Подключили BingX</div></div>
    <div class="stat"><div class="stat-val">${activeSubCount}</div><div class="stat-label">Активных подписок</div></div>
  </div>

  <!-- ── Financial metrics ── -->
  <div class="section-title">Финансы</div>
  <div class="stats" style="margin-bottom:28px">
    <div class="stat-fin">
      <div class="stat-val">${fmtCurrency(mrr)}</div>
      <div class="stat-label">MRR</div>
    </div>
    <div class="stat-fin">
      <div class="stat-val">${fmtCurrency(arr)}</div>
      <div class="stat-label">ARR</div>
    </div>
    <div class="stat-fin">
      <div class="stat-val">${fmtCurrency(monthRevenue)}</div>
      <div class="stat-label">Выручка (мес.)</div>
    </div>
    <div class="stat-fin">
      <div class="stat-val">${fmtCurrency(totalRevenue)}</div>
      <div class="stat-label">Всего выручки</div>
    </div>
    <div class="stat-fin">
      <div class="stat-val">${fmtCurrency(arpu)}</div>
      <div class="stat-label">ARPU</div>
    </div>
    <div class="stat-fin">
      <div class="stat-val">${newUsersMonth}</div>
      <div class="stat-label">Новых (мес.)</div>
    </div>
    <div class="stat-fin stat-churn">
      <div class="stat-val">${churnMonth}</div>
      <div class="stat-label">Отток (мес.)</div>
    </div>
  </div>

  <!-- ── Charts ── -->
  <div class="chart-section">
    <h2>📊 Динамика — последние 12 месяцев</h2>
    <div class="chart-tabs">
      <button class="chart-tab active" onclick="setChart('users',this)">👤 Новые пользователи</button>
      <button class="chart-tab" onclick="setChart('revenue',this)">💰 Выручка</button>
      <button class="chart-tab" onclick="setChart('active',this)">📈 Активные подписки</button>
    </div>
    <canvas id="adminChart" style="max-height:300px"></canvas>
  </div>

  <!-- ── Plans ── -->
  <div class="section-title">Планы подписки</div>
  <div class="table-wrap" style="margin-bottom:28px">
    <table>
      <thead>
        <tr>
          <th>ID</th><th>Название</th><th>Цена</th><th>Валюта</th><th>Период</th><th>Статус</th><th></th>
        </tr>
      </thead>
      <tbody>
        ${planRows || '<tr><td colspan="7" style="text-align:center;padding:24px;color:#64748b">Планов пока нет</td></tr>'}
      </tbody>
    </table>
  </div>

  <!-- Edit price modal -->
  <div id="price-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:999;align-items:center;justify-content:center">
    <div style="background:#1e293b;border-radius:12px;padding:28px 32px;min-width:340px;max-width:440px;width:90%">
      <h2 style="margin-bottom:4px">Изменить цену</h2>
      <p id="modal-plan-name" style="color:#64748b;font-size:13px;margin-bottom:20px"></p>
      <label style="font-size:13px;color:#94a3b8;display:block;margin-bottom:6px">Новая цена (USDT)</label>
      <input id="modal-price-input" type="number" min="0.01" step="0.01"
        style="background:#0f172a;border:1px solid #334155;color:#e2e8f0;border-radius:6px;
               padding:10px 14px;font-size:16px;outline:none;width:100%;margin-bottom:20px">
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button onclick="closeEditPrice()"
          style="background:#334155;color:#e2e8f0;border:none;border-radius:6px;padding:9px 20px;font-size:13px;cursor:pointer">
          Отмена
        </button>
        <button id="modal-save-btn" onclick="savePrice()"
          style="background:#3b82f6;color:#fff;border:none;border-radius:6px;padding:9px 20px;font-size:13px;font-weight:600;cursor:pointer">
          Сохранить
        </button>
      </div>
      <div id="modal-res" style="margin-top:12px;font-size:13px;font-weight:500"></div>
    </div>
  </div>

  <!-- ── Filters ── -->
  <div class="filter-bar">
    <input id="s" type="text" placeholder="Поиск по TG ID или @username" oninput="ft()">
    <select id="f-sub" onchange="ft()">
      <option value="all">Все подписки</option>
      <option value="active">Активная</option>
      <option value="none">Нет подписки</option>
    </select>
    <select id="f-bingx" onchange="ft()">
      <option value="all">Любой BingX</option>
      <option value="yes">BingX ✅</option>
      <option value="no">BingX ❌</option>
    </select>
    <button onclick="rf()">Сбросить</button>
    <span class="vis">Показано: <b id="vis">${totalCount}</b> из ${totalCount}</span>
  </div>

  <!-- ── Table ── -->
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>#</th><th>TG ID</th><th>Username</th><th>Зарегистрирован</th>
          <th>BingX</th><th>Статус</th><th>Подписка</th><th>Истекает</th><th>Статус подп.</th>
        </tr>
      </thead>
      <tbody>
        ${rows || '<tr><td colspan="9" style="text-align:center;padding:32px;color:#64748b">Пользователей пока нет</td></tr>'}
      </tbody>
    </table>
  </div>

  <div class="panel-wrap">

  <!-- ── Direct Message ── -->
  <div class="broadcast">
    <h2>✉️ Личное сообщение</h2>

    <div class="dm-row">
      <span class="dm-label">#</span>
      <input id="dm-num" type="number" min="1" max="${totalCount}"
             placeholder="Номер из таблицы" oninput="lookupDm()">
      <span id="dm-preview" class="dm-preview">— введите номер строки</span>
    </div>

    <textarea id="dm-msg" placeholder="Текст сообщения. HTML: &lt;b&gt;жирный&lt;/b&gt;, &lt;i&gt;курсив&lt;/i&gt;"></textarea>
    <div class="bc-hint">HTML-теги: &lt;b&gt; &lt;i&gt; &lt;u&gt; &lt;s&gt; &lt;code&gt; &lt;pre&gt; &lt;a href="..."&gt; — как в Telegram</div>

    <input id="dm-photo" type="url" placeholder="URL фото (опционально)">

    <button id="dm-btn" class="send-btn" onclick="sendDm()">Отправить</button>
    <div id="dm-res" class="res-line"></div>
  </div>

  <!-- ── Broadcast ── -->
  <div class="broadcast">
    <h2>📢 Рассылка</h2>

    <div class="bc-row">
      <select id="bc-sub" onchange="cntBc()">
        <option value="all">Все пользователи</option>
        <option value="active">Активная подписка</option>
        <option value="none">Без подписки</option>
      </select>
      <select id="bc-bingx" onchange="cntBc()">
        <option value="all">Любой статус BingX</option>
        <option value="yes">BingX подключён ✅</option>
        <option value="no">BingX не подключён ❌</option>
      </select>
      <span class="bc-count">Получателей: <span id="bc-n">${totalCount}</span></span>
    </div>

    <textarea id="bc-msg" placeholder="Текст сообщения. Поддерживается HTML: &lt;b&gt;жирный&lt;/b&gt;, &lt;i&gt;курсив&lt;/i&gt;, &lt;a href=&quot;https://...&quot;&gt;ссылка&lt;/a&gt;"></textarea>
    <div class="bc-hint">HTML-теги: &lt;b&gt; &lt;i&gt; &lt;u&gt; &lt;s&gt; &lt;code&gt; &lt;pre&gt; &lt;a href="..."&gt; — как в Telegram</div>

    <input id="bc-photo" type="url" placeholder="URL фото (опционально, например https://i.imgur.com/xxx.jpg)">

    <button id="bc-btn" class="send-btn" onclick="sendBc()">Отправить рассылку</button>
    <div id="bc-res" class="res-line"></div>
  </div>

  </div><!-- /.panel-wrap -->

  <script>
    const CHART_DATA = ${chartJson};
    const CURRENCY_SYM = ${JSON.stringify(currencySymbol === "USD" || currencySymbol === "USDT" ? "$" : currencySymbol)};

    let adminChart = null;
    let activeChartType = 'users';

    const CHART_CONFIGS = {
      users: {
        label: 'Новых пользователей',
        color: '#38bdf8',
        fill: 'rgba(56,189,248,0.15)',
        getData: d => d.newUsers,
        yLabel: 'Пользователей',
      },
      revenue: {
        label: 'Выручка',
        color: '#34d399',
        fill: 'rgba(52,211,153,0.15)',
        getData: d => d.revenue,
        yLabel: 'Выручка (' + CURRENCY_SYM + ')',
      },
      active: {
        label: 'Активных подписок',
        color: '#a78bfa',
        fill: 'rgba(167,139,250,0.15)',
        getData: d => d.active,
        yLabel: 'Подписок',
      },
    };

    function buildChart(type) {
      const cfg = CHART_CONFIGS[type];
      const labels = CHART_DATA.map(d => d.label);
      const values = CHART_DATA.map(cfg.getData);
      const ctx = document.getElementById('adminChart').getContext('2d');

      if (adminChart) { adminChart.destroy(); adminChart = null; }

      adminChart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            type: type === 'active' ? 'line' : 'bar',
            label: cfg.label,
            data: values,
            backgroundColor: cfg.fill,
            borderColor: cfg.color,
            borderWidth: 2,
            borderRadius: type === 'active' ? 0 : 5,
            fill: type === 'active',
            tension: 0.35,
            pointRadius: 4,
            pointBackgroundColor: cfg.color,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          animation: { duration: 300 },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: function(ctx) {
                  const v = ctx.parsed.y;
                  if (type === 'revenue') return ' ' + CURRENCY_SYM + v.toFixed(2);
                  return ' ' + v;
                }
              }
            }
          },
          scales: {
            x: {
              grid: { color: 'rgba(255,255,255,0.05)' },
              ticks: { color: '#94a3b8', font: { size: 11 } },
            },
            y: {
              grid: { color: 'rgba(255,255,255,0.05)' },
              ticks: {
                color: '#94a3b8',
                font: { size: 11 },
                callback: function(v) {
                  if (type === 'revenue') return CURRENCY_SYM + v;
                  return v;
                }
              },
              title: { display: true, text: cfg.yLabel, color: '#64748b', font: { size: 11 } },
              beginAtZero: true,
            },
          },
        },
      });
    }

    function setChart(type, btn) {
      activeChartType = type;
      document.querySelectorAll('.chart-tab').forEach(function(b) { b.classList.remove('active'); });
      if (btn) btn.classList.add('active');
      buildChart(type);
    }

    document.addEventListener('DOMContentLoaded', function() {
      buildChart('users');
    });

    const TOK = ${tokenJs};

    // ── table filter ──────────────────────────────────────────────────────────
    function ft() {
      const s = document.getElementById('s').value.toLowerCase().trim();
      const sub = document.getElementById('f-sub').value;
      const bx = document.getElementById('f-bingx').value;
      let vis = 0;
      document.querySelectorAll('tbody tr[data-tgid]').forEach(function(r) {
        const ok = (!s || r.dataset.tgid.includes(s) || r.dataset.username.includes(s))
                && (sub === 'all' || r.dataset.substatus === sub)
                && (bx  === 'all' || r.dataset.bingx    === bx);
        r.style.display = ok ? '' : 'none';
        if (ok) vis++;
      });
      document.getElementById('vis').textContent = vis;
    }

    function rf() {
      document.getElementById('s').value = '';
      document.getElementById('f-sub').value = 'all';
      document.getElementById('f-bingx').value = 'all';
      ft();
    }

    // ── broadcast count preview ───────────────────────────────────────────────
    function cntBc() {
      const sub = document.getElementById('bc-sub').value;
      const bx  = document.getElementById('bc-bingx').value;
      let n = 0;
      document.querySelectorAll('tbody tr[data-tgid]').forEach(function(r) {
        if ((sub === 'all' || r.dataset.substatus === sub)
         && (bx  === 'all' || r.dataset.bingx    === bx)) n++;
      });
      document.getElementById('bc-n').textContent = n;
    }

    // ── direct message ────────────────────────────────────────────────────────
    var dmTgId = null;

    function lookupDm() {
      var num = parseInt(document.getElementById('dm-num').value);
      var preview = document.getElementById('dm-preview');
      dmTgId = null;

      if (!num || num < 1) {
        preview.textContent = '— введите номер строки';
        preview.style.color = '#64748b';
        return;
      }

      // Scan all rows (including filtered-out hidden ones) by first cell number
      var found = null;
      document.querySelectorAll('tbody tr[data-tgid]').forEach(function(r) {
        if (r.cells[0] && parseInt(r.cells[0].textContent) === num) found = r;
      });

      if (!found) {
        preview.textContent = '— пользователь #' + num + ' не найден';
        preview.style.color = '#ef4444';
        return;
      }

      dmTgId = found.dataset.tgid;
      var uname = found.dataset.username ? '@' + found.dataset.username : '';
      var label = uname ? uname + ' (ID: ' + dmTgId + ')' : 'ID: ' + dmTgId;
      preview.textContent = '→ ' + label;
      preview.style.color = '#22c55e';
    }

    async function sendDm() {
      if (!dmTgId) { alert('Введите номер пользователя из таблицы'); return; }
      var msg = document.getElementById('dm-msg').value.trim();
      if (!msg) { alert('Введите текст сообщения'); return; }

      var btn = document.getElementById('dm-btn');
      var res = document.getElementById('dm-res');
      btn.disabled = true;
      btn.textContent = 'Отправка…';
      res.textContent = '';

      try {
        var photo = document.getElementById('dm-photo').value.trim();
        var resp = await fetch('/api/admin/broadcast', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOK },
          body: JSON.stringify({ message: msg, photoUrl: photo || undefined, telegramId: dmTgId })
        });
        var data = await resp.json();
        if (resp.ok && data.sent > 0) {
          res.style.color = '#22c55e';
          res.textContent = '✅ Сообщение доставлено';
        } else if (resp.ok) {
          res.style.color = '#ef4444';
          res.textContent = '❌ Telegram не принял сообщение (пользователь заблокировал бота?)';
        } else {
          res.style.color = '#ef4444';
          res.textContent = '❌ Ошибка: ' + (data.error || resp.status);
        }
      } catch(e) {
        res.style.color = '#ef4444';
        res.textContent = '❌ ' + e.message;
      }

      btn.disabled = false;
      btn.textContent = 'Отправить';
    }

    // ── broadcast send ────────────────────────────────────────────────────────
    async function sendBc() {
      var msg = document.getElementById('bc-msg').value.trim();
      if (!msg) { alert('Введите текст сообщения'); return; }
      var n = parseInt(document.getElementById('bc-n').textContent) || 0;
      if (n === 0) { alert('Нет получателей с такими фильтрами'); return; }
      if (!confirm('Отправить сообщение ' + n + ' пользователям?')) return;

      var btn = document.getElementById('bc-btn');
      var res = document.getElementById('bc-res');
      btn.disabled = true;
      btn.textContent = 'Отправка…';
      res.textContent = '';
      res.style.color = '#e2e8f0';

      try {
        var photo = document.getElementById('bc-photo').value.trim();
        var body = {
          message: msg,
          photoUrl: photo || undefined,
          filter: {
            subStatus: document.getElementById('bc-sub').value,
            hasBingx:  document.getElementById('bc-bingx').value
          }
        };
        var resp = await fetch('/api/admin/broadcast', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOK },
          body: JSON.stringify(body)
        });
        var data = await resp.json();
        if (resp.ok) {
          res.style.color = '#22c55e';
          res.textContent = '✅ Отправлено: ' + data.sent
            + ' | Ошибок: ' + data.failed
            + ' | Всего: ' + data.total;
        } else {
          res.style.color = '#ef4444';
          res.textContent = '❌ Ошибка: ' + (data.error || resp.status);
        }
      } catch(e) {
        res.style.color = '#ef4444';
        res.textContent = '❌ ' + e.message;
      }

      btn.disabled = false;
      btn.textContent = 'Отправить рассылку';
    }
    // ── plan toggle active ────────────────────────────────────────────────────
    async function togglePlan(id, currentlyActive) {
      var btn = document.getElementById('plan-toggle-' + id);
      if (!btn) return;
      btn.disabled = true;
      btn.textContent = '…';
      try {
        var resp = await fetch('/api/admin/plans/' + encodeURIComponent(id), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOK },
          body: JSON.stringify({ isActive: !currentlyActive })
        });
        var data = await resp.json();
        if (resp.ok) {
          var newActive = data.isActive;
          // update status cell
          var statusCell = document.getElementById('plan-status-' + id);
          if (statusCell) statusCell.innerHTML = newActive
            ? '<span style="color:#22c55e">✅ Активен</span>'
            : '<span style="color:#94a3b8">❌ Скрыт</span>';
          // update button
          btn.dataset.planActive = newActive ? 'true' : 'false';
          btn.textContent = newActive ? 'Деактивировать' : 'Активировать';
          btn.style.background = newActive ? '#7f1d1d' : '#14532d';
        } else {
          alert('Ошибка: ' + (data.error || resp.status));
          btn.textContent = currentlyActive ? 'Деактивировать' : 'Активировать';
        }
      } catch(e) {
        alert('Ошибка: ' + e.message);
        btn.textContent = currentlyActive ? 'Деактивировать' : 'Активировать';
      }
      btn.disabled = false;
    }

    // ── plan price edit ───────────────────────────────────────────────────────
    var editingPlanId = null;

    function openEditPrice(id, currentPrice, planName) {
      editingPlanId = id;
      document.getElementById('modal-plan-name').textContent = planName;
      document.getElementById('modal-price-input').value = Number(currentPrice).toFixed(2);
      document.getElementById('modal-res').textContent = '';
      var m = document.getElementById('price-modal');
      m.style.display = 'flex';
      document.getElementById('modal-price-input').focus();
    }

    function closeEditPrice() {
      document.getElementById('price-modal').style.display = 'none';
      editingPlanId = null;
    }

    document.getElementById('price-modal').addEventListener('click', function(e) {
      if (e.target === this) closeEditPrice();
    });

    async function savePrice() {
      if (!editingPlanId) return;
      var raw = document.getElementById('modal-price-input').value.trim();
      var price = parseFloat(raw);
      if (isNaN(price) || price <= 0) {
        document.getElementById('modal-res').style.color = '#ef4444';
        document.getElementById('modal-res').textContent = '❌ Введите корректную цену > 0';
        return;
      }
      var btn = document.getElementById('modal-save-btn');
      var res = document.getElementById('modal-res');
      btn.disabled = true;
      btn.textContent = 'Сохраняем…';
      res.textContent = '';
      try {
        var resp = await fetch('/api/admin/plans/' + encodeURIComponent(editingPlanId), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOK },
          body: JSON.stringify({ price: price })
        });
        var data = await resp.json();
        if (resp.ok) {
          document.getElementById('plan-price-' + editingPlanId).textContent = Number(data.price).toFixed(2);
          res.style.color = '#22c55e';
          res.textContent = '✅ Цена обновлена';
          setTimeout(closeEditPrice, 800);
        } else {
          res.style.color = '#ef4444';
          res.textContent = '❌ ' + (data.error || resp.status);
        }
      } catch(e) {
        res.style.color = '#ef4444';
        res.textContent = '❌ ' + e.message;
      }
      btn.disabled = false;
      btn.textContent = 'Сохранить';
    }
  </script>
</body>
</html>`;

    await reply.header("Content-Type", "text/html; charset=utf-8").send(html);
  });

  // ─── POST /api/admin/broadcast ───────────────────────────────────────────
  app.post("/api/admin/broadcast", async (request, reply) => {
    const auth = checkAuth(request, reply);
    if (!auth.ok) return;

    const body = request.body as {
      message?: string;
      photoUrl?: string;
      /** Direct message: send to this specific Telegram ID only, skip filters. */
      telegramId?: string;
      filter?: { subStatus?: string; hasBingx?: string };
    };

    if (!body.message || typeof body.message !== "string" || !body.message.trim()) {
      await reply.status(400).send({ error: "message is required" });
      return;
    }

    const botToken = process.env["TELEGRAM_BOT_TOKEN"];
    if (!botToken) {
      await reply.status(503).send({ error: "TELEGRAM_BOT_TOKEN not configured" });
      return;
    }

    // ── Resolve target list ──────────────────────────────────────────────────
    let targets: Array<{ telegramId: bigint }>;

    if (body.telegramId) {
      // Direct message — single subscriber by Telegram ID
      const tgId = BigInt(body.telegramId);
      const sub = await prisma.subscriber.findFirst({ where: { telegramId: tgId } });
      if (!sub) {
        await reply.status(404).send({ error: "Subscriber not found" });
        return;
      }
      targets = [sub];
    } else {
      // Broadcast — apply filters
      const hasBingxFilter = body.filter?.hasBingx;
      const subStatusFilter = body.filter?.subStatus;

      const where: Record<string, unknown> = {};
      if (hasBingxFilter === "yes") where["apiKeyEncrypted"] = { not: null };
      if (hasBingxFilter === "no") where["apiKeyEncrypted"] = null;

      const subscribers = await prisma.subscriber.findMany({
        where,
        include: {
          subscriptions: {
            where: { status: "active", expiresAt: { gt: new Date() } },
            take: 1,
          },
        },
      });

      let filtered = subscribers;
      if (subStatusFilter === "active") {
        filtered = subscribers.filter((s) => s.subscriptions.length > 0);
      } else if (subStatusFilter === "none") {
        filtered = subscribers.filter((s) => s.subscriptions.length === 0);
      }
      targets = filtered;
    }

    const message = body.message.trim();
    const photoUrl = body.photoUrl?.trim() ?? "";
    let sent = 0;
    let failed = 0;

    for (const sub of targets) {
      try {
        const chatId = String(sub.telegramId);
        let res: Response;

        if (photoUrl) {
          res = await fetch(
            `https://api.telegram.org/bot${botToken}/sendPhoto`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: chatId,
                photo: photoUrl,
                caption: message,
                parse_mode: "HTML",
              }),
            },
          );
        } else {
          res = await fetch(
            `https://api.telegram.org/bot${botToken}/sendMessage`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: chatId,
                text: message,
                parse_mode: "HTML",
              }),
            },
          );
        }

        if (res.ok) {
          sent++;
        } else {
          failed++;
          app.log.warn(
            { chatId, status: res.status },
            "broadcast: failed to send to subscriber",
          );
        }
      } catch (err) {
        failed++;
        app.log.warn({ err }, "broadcast: exception sending to subscriber");
      }

      // ~20 msg/sec — well under Telegram's 30/sec global limit
      await new Promise((r) => setTimeout(r, 50));
    }

    await audit(
      body.telegramId ? "broadcast.dm" : "broadcast.bulk",
      request,
      auth.token,
      {
        targets: targets.length,
        sent,
        failed,
        ...(body.telegramId ? { telegramId: body.telegramId } : { filter: body.filter ?? null }),
        messagePreview: body.message?.slice(0, 200) ?? "",
        hasPhoto: Boolean(body.photoUrl),
      },
    );

    await reply.send({ sent, failed, total: targets.length });
  });

  // ─── PATCH /api/admin/plans/:id ─────────────────────────────────────────
  app.patch("/api/admin/plans/:id", async (request, reply) => {
    const auth = checkAuth(request, reply);
    if (!auth.ok) return;

    const { id } = request.params as { id: string };
    const body = request.body as { price?: unknown; isActive?: unknown };

    if (body.price === undefined && body.isActive === undefined) {
      await reply.status(400).send({ error: "provide price or isActive" });
      return;
    }

    const data: { price?: number; isActive?: boolean } = {};

    if (body.price !== undefined) {
      const price = Number(body.price);
      if (isNaN(price) || price <= 0) {
        await reply.status(400).send({ error: "price must be a positive number" });
        return;
      }
      data.price = price;
    }

    if (body.isActive !== undefined) {
      if (typeof body.isActive !== "boolean") {
        await reply.status(400).send({ error: "isActive must be a boolean" });
        return;
      }
      data.isActive = body.isActive;
    }

    const plan = await prisma.plan.findUnique({ where: { id } });
    if (!plan) {
      await reply.status(404).send({ error: "Plan not found" });
      return;
    }

    const updated = await prisma.plan.update({ where: { id }, data });

    await audit("plan.update", request, auth.token, {
      planId: id,
      changes: data,
      previous: { price: Number(plan.price), isActive: plan.isActive },
    });

    await reply.send({
      id: updated.id,
      name: updated.name,
      price: Number(updated.price),
      isActive: updated.isActive,
    });
  });
}
