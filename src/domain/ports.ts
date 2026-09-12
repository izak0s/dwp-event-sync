import type { Event } from "@izak0s/spacebring-api";
import type { EvenementPayload, EvenementPost } from "./evenement";

/**
 * Boundaries of the sync domain. `SyncService` only talks to these two interfaces; the
 * adapters in `src/adapters` implement them against the real Spacebring and WordPress APIs,
 * and the tests implement them with in-memory fakes.
 */

/** A Spacebring event as returned by the API. Re-exported so the domain has one name for it. */
export type SpacebringEvent = Event;

/** Where events come from. */
export interface EventSource {
  /** The event, or `null` when Spacebring does not know the id (deleted, or never existed). */
  get(spacebringId: string): Promise<SpacebringEvent | null>;
  /** Every event of the configured location, all visibilities, all pages. */
  listAll(): Promise<SpacebringEvent[]>;
  /** Cheapest authenticated call; rejects when credentials or configuration are wrong. */
  check(): Promise<void>;
}

/** Where events go. */
export interface EventStore {
  /** `spacebring_id` -> post id for every post that carries a `spacebring_id`. */
  index(): Promise<Map<string, number>>;
  get(postId: number): Promise<EvenementPost>;
  /** Returns the new post id. */
  create(payload: EvenementPayload): Promise<number>;
  update(postId: number, payload: EvenementPayload): Promise<void>;
  /** Permanent delete (no trash). */
  delete(postId: number): Promise<void>;
  /** Cheapest authenticated call; rejects when credentials or the post type are wrong. */
  check(): Promise<void>;
}
