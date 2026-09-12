import { Hono } from "hono";
import { Webhook, WebhookVerificationError } from "svix";
import { errorFields, log } from "../lib/logger";
import type { AppEnv } from "./context";

/** Webhook types this Worker acts on. Everything else is acknowledged and ignored. */
export const HANDLED_TYPES = new Set(["event.created", "event.updated", "event.canceled", "event.deleted"]);

/**
 * Pulls the Spacebring event id out of a webhook body. Spacebring documents the payload as
 * `{ type, event: {...} }`; the extra shapes are tolerated in case the envelope differs.
 */
export function extractEventId(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const b = body as Record<string, any>;
  return b.event?.id ?? b.data?.event?.id ?? b.data?.id ?? undefined;
}

export function extractEventType(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const b = body as Record<string, any>;
  return b.type ?? b.eventType ?? b.event_type ?? undefined;
}

/**
 * `POST /webhooks/spacebring`. Verifies the Svix signature
 * (https://www.spacebring.com/docs/webhooks/verifying), then re-syncs the referenced event from
 * the Spacebring API. The webhook is only a trigger: the API response decides whether the
 * WordPress post is created, updated or deleted. Runs synchronously so a failure returns 5xx and
 * Svix retries the delivery. Never echoes upstream error details: Svix stores response bodies.
 */
export function webhookRoutes(): Hono<AppEnv> {
  const hook = new Hono<AppEnv>();

  hook.post("/", async (c) => {
    const { config, sync } = c.get("services");
    const secret = config.spacebring.webhookSecret;
    if (!secret) return c.json({ error: "SPACEBRING_WEBHOOK_SECRET not configured" }, 500);

    const svixId = c.req.header("svix-id");
    const rawBody = await c.req.text();
    try {
      new Webhook(secret).verify(rawBody, {
        "svix-id": svixId ?? "",
        "svix-timestamp": c.req.header("svix-timestamp") ?? "",
        "svix-signature": c.req.header("svix-signature") ?? "",
      });
    } catch (err) {
      if (!(err instanceof WebhookVerificationError)) throw err;
      log.warn({ op: "webhook", reason: err.message, svixId });
      return c.json({ error: "invalid signature" }, 401);
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }

    const type = extractEventType(body);
    const eventId = extractEventId(body);

    // Other subscriptions (booking.*, event.ticket.*, ...) are not ours: acknowledge so Svix does
    // not retry, but log so a misconfigured endpoint is visible.
    if (type !== undefined && !HANDLED_TYPES.has(type)) {
      log.info({ op: "webhook", action: "ignored", type, svixId });
      return c.json({ action: "ignored", type });
    }
    if (type === undefined) log.warn({ op: "webhook", reason: "no type in payload", keys: Object.keys(body as object), svixId });
    if (!eventId) {
      log.warn({ op: "webhook", reason: "no event id", type, keys: Object.keys(body as object), svixId });
      return c.json({ error: "no event id in payload" }, 400);
    }

    try {
      const result = await sync.syncOne(eventId);
      log.info({ op: "webhook", type, svixId, ...result });
      return c.json({ received: true, action: result.action });
    } catch (err) {
      log.error({ op: "webhook", type, svixId, eventId, ...errorFields(err) });
      return c.json({ error: "sync_failed", svixId }, 500);
    }
  });

  return hook;
}
