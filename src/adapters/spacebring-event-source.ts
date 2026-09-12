import { Spacebring, SpacebringError } from "@izak0s/spacebring-api";
import type { EventSource, SpacebringEvent } from "../domain/ports";

/** `EventSource` backed by the Spacebring API for one location. */
export class SpacebringEventSource implements EventSource {
  constructor(
    private readonly api: Spacebring,
    private readonly locationRef: string,
  ) {}

  static create(config: { clientId: string; clientSecret: string; locationRef: string }): SpacebringEventSource {
    const api = new Spacebring({ clientId: config.clientId, clientSecret: config.clientSecret });
    return new SpacebringEventSource(api, config.locationRef);
  }

  async get(spacebringId: string): Promise<SpacebringEvent | null> {
    try {
      return await this.api.events.get(spacebringId);
    } catch (err) {
      if (err instanceof SpacebringError && err.status === 404) return null;
      throw err;
    }
  }

  async check(): Promise<void> {
    await this.api.locations.get(this.locationRef);
  }

  async listAll(): Promise<SpacebringEvent[]> {
    const events: SpacebringEvent[] = [];
    let nextPageToken: string | undefined;
    do {
      const page = (await this.api.events.list({ locationRef: this.locationRef, limit: 100, nextPageToken })) as {
        events?: SpacebringEvent[];
        nextPageToken?: string;
      };
      events.push(...(page.events ?? []));
      nextPageToken = page.nextPageToken;
    } while (nextPageToken);
    return events;
  }
}
