import { isInScope, isUpToDate, toEvenementPayload, type MapperOptions } from "./event-mapper";
import type { EventSource, EventStore, SpacebringEvent } from "./ports";

export type SyncAction = "created" | "updated" | "unchanged" | "deleted" | "skipped";

export type SyncResult = {
  spacebringId: string;
  action: SyncAction;
  wpId?: number;
  reason?: string;
};

export type ReconcileReport = {
  spacebringTotal: number;
  inScope: number;
  results: SyncResult[];
  counts: Record<SyncAction, number>;
};

export type HealthReport = {
  ok: boolean;
  checks: { source: "ok" | "error"; store: "ok" | "error" };
  errors: { source?: unknown; store?: unknown };
};

/**
 * Keeps WordPress in step with Spacebring. Stateless: every call re-reads both sides, so it is
 * safe to run from a webhook and the cron at the same time.
 */
export class SyncService {
  constructor(
    private readonly source: EventSource,
    private readonly store: EventStore,
    private readonly mapper: MapperOptions,
  ) {}

  /** Re-syncs one event: creates, updates or deletes the WordPress post as Spacebring dictates. */
  async syncOne(spacebringId: string): Promise<SyncResult> {
    const event = await this.source.get(spacebringId);
    if (event === null) return this.remove(spacebringId, "not found in Spacebring");

    const wpId = (await this.store.index()).get(spacebringId);
    return this.apply(event, wpId);
  }

  /**
   * Creates or updates every public Spacebring event in WordPress. Never deletes: posts whose
   * event disappeared or went non-public are only removed through `syncOne` (webhook path).
   * Posts without a `spacebring_id` (created by hand) are never touched.
   */
  async reconcileAll(): Promise<ReconcileReport> {
    const [events, index] = await Promise.all([this.source.listAll(), this.store.index()]);

    const results: SyncResult[] = [];
    let inScope = 0;
    for (const event of events) {
      if (!isInScope(event)) continue;
      inScope++;
      results.push(await this.apply(event, index.get(event.id)));
    }

    return { spacebringTotal: events.length, inScope, results, counts: countActions(results) };
  }

  /** Verifies both sides are reachable with the configured credentials. */
  async health(): Promise<HealthReport> {
    const [source, store] = await Promise.allSettled([this.source.check(), this.store.check()]);
    const status = (r: PromiseSettledResult<void>) => (r.status === "fulfilled" ? "ok" : "error");
    const error = (r: PromiseSettledResult<void>) => (r.status === "rejected" ? r.reason : undefined);
    return {
      ok: source.status === "fulfilled" && store.status === "fulfilled",
      checks: { source: status(source), store: status(store) },
      errors: { source: error(source), store: error(store) },
    };
  }

  private async remove(spacebringId: string, reason: string): Promise<SyncResult> {
    const wpId = (await this.store.index()).get(spacebringId);
    if (wpId === undefined) return { spacebringId, action: "skipped", reason: "no WordPress post" };

    await this.store.delete(wpId);
    return { spacebringId, action: "deleted", wpId, reason };
  }

  private async apply(event: SpacebringEvent, wpId: number | undefined): Promise<SyncResult> {
    if (!isInScope(event)) {
      const reason = `visibility=${event.visibility}`;
      if (wpId === undefined) return { spacebringId: event.id, action: "skipped", reason };
      await this.store.delete(wpId);
      return { spacebringId: event.id, action: "deleted", wpId, reason };
    }

    const payload = toEvenementPayload(event, this.mapper);

    if (wpId === undefined) return { spacebringId: event.id, action: "created", wpId: await this.store.create(payload) };

    const current = await this.store.get(wpId);
    if (isUpToDate(current, payload)) return { spacebringId: event.id, action: "unchanged", wpId };

    await this.store.update(wpId, payload);
    return { spacebringId: event.id, action: "updated", wpId };
  }
}

function countActions(results: SyncResult[]): Record<SyncAction, number> {
  const counts: Record<SyncAction, number> = { created: 0, updated: 0, unchanged: 0, deleted: 0, skipped: 0 };
  for (const r of results) counts[r.action]++;
  return counts;
}
