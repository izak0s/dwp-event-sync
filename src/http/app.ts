import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { ConfigError } from "../config";
import { errorFields, log } from "../lib/logger";
import type { AppEnv, ServiceFactory } from "./context";
import { webhookRoutes } from "./webhook-routes";

/** Builds the HTTP app. `createServices` runs once per request. */
export function createApp(createServices: ServiceFactory): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    c.set("services", createServices(c.env));
    await next();
  });

  // Liveness + credential check for both sides. Public: only source/store ok|error, no vendor names, no details.
  app.get("/health", async (c) => {
    const report = await c.get("services").sync.health();
    if (!report.ok) {
      log.error({
        op: "health",
        checks: report.checks,
        source: report.errors.source && errorFields(report.errors.source),
        store: report.errors.store && errorFields(report.errors.store),
      });
    }
    return c.json({ ok: report.ok, checks: report.checks }, report.ok ? 200 : 503);
  });

  app.route("/webhooks/spacebring", webhookRoutes());

  // The webhook route handles sync errors itself; this catches everything else (config, Hono
  // internals) without leaking details to the caller.
  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    log.error({ op: "http", path: c.req.path, ...errorFields(err) });
    return c.json({ error: err instanceof ConfigError ? "config_error" : "internal_error" }, 500);
  });

  return app;
}
