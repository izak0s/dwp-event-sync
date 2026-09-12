import { describe, expect, it } from "vitest";
import { toEvenementPayload } from "../src/domain/event-mapper";
import { SyncService } from "../src/domain/sync-service";
import { fakeEvent, fakePost, InMemoryEventSource, InMemoryEventStore } from "./fakes";

const mapper = { eventUrlBase: "https://app/events", timeZone: "Europe/Amsterdam", postStatus: "publish" as const };

function setup(events = [] as ReturnType<typeof fakeEvent>[], posts = [] as ReturnType<typeof fakePost>[]) {
  const source = new InMemoryEventSource(events);
  const store = new InMemoryEventStore(posts);
  return { source, store, service: new SyncService(source, store, mapper) };
}

/** A WordPress post that already matches what the mapper would write for `event`. */
const postMatching = (id: number, event: ReturnType<typeof fakeEvent>) => {
  const p = toEvenementPayload(event, mapper);
  return fakePost(id, event.id, { ...p, title: { rendered: p.title, raw: p.title }, geannuleerd: p.geannuleerd ? "1" : "0" });
};

describe("SyncService.reconcileAll", () => {
  it("creates missing public events and skips non-public ones", async () => {
    const { store, service } = setup([fakeEvent("new"), fakeEvent("private", { visibility: "admins" })]);
    const report = await service.reconcileAll();
    expect(store.created.map((p) => p.spacebring_id)).toEqual(["new"]);
    expect(report.counts).toMatchObject({ created: 1, deleted: 0, skipped: 0 });
    expect(report.inScope).toBe(1);
  });

  it("updates changed posts and leaves matching ones alone", async () => {
    const same = fakeEvent("same");
    const changed = fakeEvent("changed", { title: "New title" });
    const { store, service } = setup([same, changed], [postMatching(1, same), postMatching(2, fakeEvent("changed"))]);
    const report = await service.reconcileAll();
    expect(store.updated.map((u) => u.postId)).toEqual([2]);
    expect(report.counts).toMatchObject({ updated: 1, unchanged: 1 });
  });

  it("never deletes: stale, non-public and manual posts all survive", async () => {
    const { store, service } = setup(
      [fakeEvent("a", { visibility: "members" })],
      [fakePost(1, ""), fakePost(3, "gone-from-spacebring"), fakePost(10, "a")],
    );
    const report = await service.reconcileAll();
    expect(store.deleted).toEqual([]);
    expect(report.counts).toMatchObject({ deleted: 0, created: 0, updated: 0 });
  });
});

describe("SyncService.health", () => {
  it("ok when both sides answer", async () => {
    const { service } = setup();
    expect(await service.health()).toMatchObject({ ok: true, checks: { source: "ok", store: "ok" } });
  });

  it("reports the failing side", async () => {
    const { source, service } = setup();
    source.checkError = new Error("401");
    const report = await service.health();
    expect(report).toMatchObject({ ok: false, checks: { source: "error", store: "ok" } });
    expect(report.errors.source).toBeInstanceOf(Error);
  });
});

describe("SyncService.syncOne", () => {
  it("creates when no post carries the spacebring_id", async () => {
    const { store, service } = setup([fakeEvent("x")], [fakePost(1, "")]);
    const result = await service.syncOne("x");
    expect(store.created).toHaveLength(1);
    expect(result).toMatchObject({ action: "created", wpId: 1000 });
  });

  it("updates an existing post", async () => {
    const { store, service } = setup([fakeEvent("x", { title: "changed" })], [postMatching(7, fakeEvent("x"))]);
    const result = await service.syncOne("x");
    expect(store.updated.map((u) => u.postId)).toEqual([7]);
    expect(result).toMatchObject({ action: "updated", wpId: 7 });
  });

  it("deletes the post when Spacebring no longer knows the event", async () => {
    const { store, service } = setup([], [fakePost(5, "gone")]);
    const result = await service.syncOne("gone");
    expect(store.deleted).toEqual([5]);
    expect(result).toMatchObject({ action: "deleted", wpId: 5, reason: "not found in Spacebring" });
  });

  it("deletes the post when the event stops being public", async () => {
    const { store, service } = setup([fakeEvent("m", { visibility: "members" })], [fakePost(6, "m")]);
    const result = await service.syncOne("m");
    expect(store.deleted).toEqual([6]);
    expect(result).toMatchObject({ action: "deleted", reason: "visibility=members" });
  });

  it("marks cancelled events instead of deleting them", async () => {
    const { store, service } = setup([fakeEvent("c", { cancelDate: "2026-07-01T00:00:00Z" })], [postMatching(8, fakeEvent("c"))]);
    const result = await service.syncOne("c");
    expect(result.action).toBe("updated");
    expect(store.updated[0].payload.geannuleerd).toBe(1);
    expect(store.deleted).toEqual([]);
  });

  it("skips unknown ids that have no post either", async () => {
    const { service } = setup();
    expect(await service.syncOne("nope")).toMatchObject({ action: "skipped", reason: "no WordPress post" });
  });
});
