import { Webhook } from "svix";
import { describe, expect, it, vi } from "vitest";
import type { Config } from "../src/config";
import type { SyncResult } from "../src/domain/sync-service";
import { createApp } from "../src/http/app";
import { extractEventId, extractEventType } from "../src/http/webhook-routes";

const secret = "whsec_" + Buffer.from("test-secret-key-0123456789").toString("base64");

const config = { spacebring: { webhookSecret: secret } } as Config;

/** App whose SyncService is a stub; `syncOne` records calls and returns `result` (or throws). */
function makeApp(behaviour: SyncResult | Error = { spacebringId: "ev-1", action: "updated", wpId: 42 }) {
  const syncOne = vi.fn(async (id: string) => {
    if (behaviour instanceof Error) throw behaviour;
    return { ...behaviour, spacebringId: id };
  });
  const health = vi.fn(async () => ({ ok: true, checks: { source: "ok", store: "ok" }, errors: {} }));
  const app = createApp(() => ({ config, sync: { syncOne, health } as never }));
  return { app, syncOne, health };
}

function signedRequest(body: string, opts: { secret?: string; id?: string; ts?: Date } = {}) {
  const id = opts.id ?? "msg_1";
  const ts = opts.ts ?? new Date();
  return new Request("http://x/webhooks/spacebring", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "svix-id": id,
      "svix-timestamp": String(Math.floor(ts.getTime() / 1000)),
      "svix-signature": new Webhook(opts.secret ?? secret).sign(id, ts, body),
    },
    body,
  });
}

describe("POST /webhooks/spacebring", () => {
  const body = JSON.stringify({ type: "event.updated", event: { id: "ev-1", title: "x" } });

  it("verifies signature and syncs the event", async () => {
    const { app, syncOne } = makeApp();
    const res = await app.request(signedRequest(body), undefined, {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, action: "updated" });
    expect(syncOne).toHaveBeenCalledWith("ev-1");
  });

  it("hides upstream errors from the sender and returns 500 so Svix retries", async () => {
    const wpError = Object.assign(new Error("WordPress POST /evenement -> 500 (rest_cannot_create)"), {
      name: "WordPressError",
      status: 500,
      body: { code: "rest_cannot_create", message: "Sorry, you are not allowed" },
    });
    const { app } = makeApp(wpError);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await app.request(signedRequest(body), undefined, {});
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toEqual({ error: "sync_failed", svixId: "msg_1" });
    expect(JSON.stringify(json)).not.toContain("rest_cannot_create");
    expect(errorSpy.mock.calls[0][0]).toContain("rest_cannot_create");
    errorSpy.mockRestore();
  });

  it("rejects a bad signature with 401 and does not sync", async () => {
    const { app, syncOne } = makeApp();
    const other = "whsec_" + Buffer.from("other-secret").toString("base64");
    const res = await app.request(signedRequest(body, { secret: other }), undefined, {});
    expect(res.status).toBe(401);
    expect(syncOne).not.toHaveBeenCalled();
  });

  it("rejects a tampered body", async () => {
    const { app } = makeApp();
    const tampered = new Request(signedRequest(body), { body: body + " " });
    expect((await app.request(tampered, undefined, {})).status).toBe(401);
  });

  it("rejects missing headers", async () => {
    const { app } = makeApp();
    const res = await app.request("http://x/webhooks/spacebring", { method: "POST", body }, {});
    expect(res.status).toBe(401);
  });

  it("rejects stale timestamps", async () => {
    const { app } = makeApp();
    const res = await app.request(signedRequest(body, { ts: new Date(Date.now() - 10 * 60 * 1000) }), undefined, {});
    expect(res.status).toBe(401);
  });

  it("acknowledges and ignores non-event webhook types", async () => {
    const { app, syncOne } = makeApp();
    for (const type of ["booking.created", "event.ticket.created", "membership.updated"]) {
      const res = await app.request(signedRequest(JSON.stringify({ type, event: { id: "should-not-sync" } })), undefined, {});
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ action: "ignored", type });
    }
    expect(syncOne).not.toHaveBeenCalled();
  });

  it.each(["event.created", "event.updated", "event.canceled", "event.deleted"])("handles %s", async (type) => {
    const { app, syncOne } = makeApp();
    const res = await app.request(signedRequest(JSON.stringify({ type, event: { id: "ev-9" } })), undefined, {});
    expect(res.status).toBe(200);
    expect(syncOne).toHaveBeenCalledWith("ev-9");
  });

  it("still syncs when type is missing but event.id is present", async () => {
    const { app, syncOne } = makeApp();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await app.request(signedRequest(JSON.stringify({ event: { id: "ev-untyped" } })), undefined, {});
    expect(res.status).toBe(200);
    expect(syncOne).toHaveBeenCalledWith("ev-untyped");
    warnSpy.mockRestore();
  });

  it("400 when payload has no event id", async () => {
    const { app, syncOne } = makeApp();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await app.request(signedRequest(JSON.stringify({ type: "event.updated" })), undefined, {});
    expect(res.status).toBe(400);
    expect(syncOne).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("500 when secret not configured", async () => {
    const app = createApp(() => ({ config: { ...config, spacebring: {} } as Config, sync: {} as never }));
    const res = await app.request(signedRequest(body), undefined, {});
    expect(res.status).toBe(500);
  });
});

describe("GET /health", () => {
  it("200 with per-side status when credentials work", async () => {
    const { app } = makeApp();
    const res = await app.request("http://x/health", {}, {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, checks: { source: "ok", store: "ok" } });
  });

  it("503 and no error details when a side fails", async () => {
    const { app, health } = makeApp();
    health.mockResolvedValueOnce({
      ok: false,
      checks: { source: "ok", store: "error" },
      errors: { store: new Error("WordPress GET /evenement -> 401 (rest_forbidden)") },
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await app.request("http://x/health", {}, {});
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ ok: false, checks: { source: "ok", store: "error" } });
    expect(text).not.toContain("rest_forbidden");
    expect(text).not.toMatch(/wordpress|spacebring/i);
    expect(errorSpy.mock.calls[0][0]).toContain("rest_forbidden");
    errorSpy.mockRestore();
  });
});

describe("unknown routes", () => {
  it("404 for anything but /health and the webhook", async () => {
    const { app } = makeApp();
    expect((await app.request("http://x/admin/sync/all", { method: "POST" }, {})).status).toBe(404);
  });
});

describe("extractEventId / extractEventType", () => {
  it("reads documented shape { type, event: { id } }", () => {
    expect(extractEventId({ type: "event.updated", event: { id: "a" } })).toBe("a");
    expect(extractEventType({ type: "event.updated", event: { id: "a" } })).toBe("event.updated");
  });
  it("tolerates { data: { event: { id } } } and { data: { id } }", () => {
    expect(extractEventId({ data: { event: { id: "b" } } })).toBe("b");
    expect(extractEventId({ data: { id: "c" } })).toBe("c");
  });
  it("returns undefined for junk", () => {
    expect(extractEventId(null)).toBeUndefined();
    expect(extractEventId("x")).toBeUndefined();
    expect(extractEventId({})).toBeUndefined();
  });
});
