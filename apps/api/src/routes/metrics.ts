import type { FastifyInstance } from "fastify";
import { Registry, collectDefaultMetrics, Counter, Histogram } from "prom-client";

const registry = new Registry();
collectDefaultMetrics({ register: registry });

export const httpRequestDuration = new Histogram({
  name: "kopix_api_http_request_duration_seconds",
  help: "HTTP request latency in seconds",
  labelNames: ["method", "route", "status_code"] as const,
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
  registers: [registry],
});

export const httpRequestsTotal = new Counter({
  name: "kopix_api_http_requests_total",
  help: "Total HTTP requests processed",
  labelNames: ["method", "route", "status_code"] as const,
  registers: [registry],
});

export async function metricsRoutes(app: FastifyInstance): Promise<void> {
  // Record latency for every request
  app.addHook("onResponse", (request, reply, done) => {
    const route = request.routeOptions?.url ?? request.url;
    httpRequestDuration
      .labels(request.method, route, String(reply.statusCode))
      .observe(reply.elapsedTime / 1000);
    httpRequestsTotal.inc({
      method: request.method,
      route,
      status_code: String(reply.statusCode),
    });
    done();
  });

  app.get("/metrics", async (_request, reply) => {
    const metrics = await registry.metrics();
    await reply
      .header("Content-Type", registry.contentType)
      .send(metrics);
  });
}
