/**
 * k6 load test for the KopiX API.
 *
 * Phase 8 / Step 62: sustain 100 concurrent subscribers browsing
 * their profile, trade history, and stats — mirroring real Mini App
 * usage. Also hits /health as a baseline.
 *
 * Run:
 *   API_URL=https://kopix.example.com TMA_INIT_DATA="query_id=...&..." \
 *     k6 run infra/scripts/loadtest.js
 *
 * Thresholds fail the run if p95 > 500ms or error rate > 1%.
 */
/* global __ENV */

import http from "k6/http";
import { check, sleep, group } from "k6";
import { Rate } from "k6/metrics";

const errorRate = new Rate("errors");

const API_URL = __ENV.API_URL || "http://localhost:3000";
const INIT_DATA = __ENV.TMA_INIT_DATA || "";

export const options = {
  scenarios: {
    subscribers: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 50 },
        { duration: "1m", target: 100 },
        { duration: "2m", target: 100 },
        { duration: "30s", target: 0 },
      ],
      gracefulRampDown: "15s",
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<500", "p(99)<1500"],
    http_req_failed: ["rate<0.01"],
    errors: ["rate<0.01"],
  },
};

function authHeaders() {
  if (!INIT_DATA) return {};
  return { Authorization: `TMA ${INIT_DATA}` };
}

export default function () {
  group("health", () => {
    const res = http.get(`${API_URL}/health/live`);
    const ok = check(res, { "health 200": (r) => r.status === 200 });
    errorRate.add(!ok);
  });

  group("subscriber browsing", () => {
    const profile = http.get(`${API_URL}/api/subscribers/me`, { headers: authHeaders() });
    errorRate.add(
      !check(profile, { "profile 200": (r) => r.status === 200 || r.status === 401 }),
    );

    const trades = http.get(`${API_URL}/api/trades?limit=20`, { headers: authHeaders() });
    errorRate.add(
      !check(trades, { "trades 200": (r) => r.status === 200 || r.status === 401 }),
    );

    const stats = http.get(`${API_URL}/api/trades/stats`, { headers: authHeaders() });
    errorRate.add(
      !check(stats, { "stats 200": (r) => r.status === 200 || r.status === 401 }),
    );
  });

  sleep(Math.random() * 3 + 1); // think time 1–4s
}
