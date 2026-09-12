import type { EvenementPayload, EvenementPost } from "../src/domain/evenement";
import type { EventSource, EventStore, SpacebringEvent } from "../src/domain/ports";

/** Builds a minimal public Spacebring event; override any field. */
export function fakeEvent(id: string, extra: Partial<SpacebringEvent> = {}): SpacebringEvent {
  return {
    id,
    title: `Event ${id}`,
    startDate: "2026-07-16T10:00:00.000Z",
    endDate: "2026-07-16T11:00:00.000Z",
    visibility: "public",
    location: { id: "loc", title: "de Werkplek", timezoneId: "Europe/Amsterdam" },
    media: [],
    ...extra,
  } as SpacebringEvent;
}

/** Builds a WordPress post that carries a `spacebring_id`; override any field. */
export function fakePost(id: number, spacebringId: string, extra: Partial<EvenementPost> = {}): EvenementPost {
  return {
    id,
    slug: `post-${id}`,
    status: "publish",
    link: "",
    title: { rendered: "", raw: "" },
    modified_gmt: "",
    datum: "",
    einddatum: "",
    locatie: "",
    spacebring_link: "",
    omschrijving: "",
    spacebring_id: spacebringId,
    geannuleerd: [],
    afbeelding: "",
    ...extra,
  };
}

export class InMemoryEventSource implements EventSource {
  /** Set to make `check()` fail, simulating bad credentials. */
  checkError?: Error;
  constructor(public events: SpacebringEvent[] = []) {}
  async check() {
    if (this.checkError) throw this.checkError;
  }
  async get(id: string) {
    return this.events.find((e) => e.id === id) ?? null;
  }
  async listAll() {
    return this.events;
  }
}

/** Records every write so tests can assert on them. */
export class InMemoryEventStore implements EventStore {
  created: EvenementPayload[] = [];
  updated: { postId: number; payload: EvenementPayload }[] = [];
  deleted: number[] = [];
  private nextId = 1000;

  checkError?: Error;

  constructor(public posts: EvenementPost[] = []) {}

  async check() {
    if (this.checkError) throw this.checkError;
  }
  async index() {
    return new Map(this.posts.filter((p) => p.spacebring_id).map((p) => [p.spacebring_id, p.id]));
  }
  async get(postId: number) {
    const post = this.posts.find((p) => p.id === postId);
    if (!post) throw new Error(`no post ${postId}`);
    return post;
  }
  async create(payload: EvenementPayload) {
    this.created.push(payload);
    return this.nextId++;
  }
  async update(postId: number, payload: EvenementPayload) {
    this.updated.push({ postId, payload });
  }
  async delete(postId: number) {
    this.deleted.push(postId);
  }
}
