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

function checkAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): { ok: true; token: string } | { ok: false } {
  const secret = process.env["ADMIN_SECRET"];
  if (!secret) {
    void reply.status(503).send("ADMIN_SECRET is not configured on the server.");
    return { ok: false };
  }
  const token = (request.query as Record<string, string>)["token"];
  if (!token || token !== secret) {
    void reply
      .status(401)
      .header("Content-Type", "text/html; charset=utf-8")
      .send("<h2>401 — Неверный токен</h2><p>Добавьте ?token=ADMIN_SECRET в URL.</p>");
    return { ok: false };
  }
  return { ok: true, token };
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  // ─── GET /api/admin ─────────────────────────────────────────────────────────
  app.get("/api/admin", async (request, reply) => {
    const auth = checkAuth(request, reply);
    if (!auth.ok) return;
    const { token } = auth;

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

    /* broadcast */
    .broadcast{background:#1e293b;border-radius:10px;padding:24px;max-width:680px}
    .bc-row{display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap;align-items:center}
    .bc-row select{
      background:#0f172a;border:1px solid #334155;color:#e2e8f0;
      border-radius:6px;padding:7px 12px;font-size:13px;outline:none;flex:1;min-width:160px}
    .bc-count{color:#38bdf8;font-weight:600;font-size:13px;white-space:nowrap}
    textarea,input[type=url]{
      width:100%;background:#0f172a;border:1px solid #334155;color:#e2e8f0;
      border-radius:6px;padding:10px 12px;font-size:13px;outline:none;
      margin-bottom:10px;resize:vertical;font-family:inherit}
    textarea{min-height:110px}
    .bc-hint{color:#64748b;font-size:11px;margin-bottom:10px;margin-top:-6px}
    .send-btn{background:#3b82f6;color:#fff;border:none;border-radius:6px;
      padding:10px 24px;font-size:14px;font-weight:600;cursor:pointer}
    .send-btn:hover{background:#2563eb}
    .send-btn:disabled{background:#334155;color:#64748b;cursor:not-allowed}
    #bc-res{margin-top:12px;font-size:13px;font-weight:500}
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
    <div id="bc-res"></div>
  </div>

  <script>
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
        var resp = await fetch('/api/admin/broadcast?token=' + encodeURIComponent(TOK), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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

    const hasBingxFilter = body.filter?.hasBingx;
    const subStatusFilter = body.filter?.subStatus;

    // Build Prisma where clause (only BingX filter is expressible at DB level)
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

    // Apply subscription status filter in memory
    let targets = subscribers;
    if (subStatusFilter === "active") {
      targets = subscribers.filter((s) => s.subscriptions.length > 0);
    } else if (subStatusFilter === "none") {
      targets = subscribers.filter((s) => s.subscriptions.length === 0);
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

    await reply.send({ sent, failed, total: targets.length });
  });
}
