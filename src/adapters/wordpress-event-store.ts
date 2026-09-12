import type { EvenementPayload, EvenementPost } from "../domain/evenement";
import type { EventStore } from "../domain/ports";

export type WordPressErrorBody = {
  code: string;
  message: string;
  data?: { status?: number; [key: string]: unknown };
};

export class WordPressError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: WordPressErrorBody | string,
    public readonly method: string,
    public readonly path: string,
  ) {
    const detail = typeof body === "string" ? body : `${body.code}: ${body.message}`;
    super(`WordPress ${method} ${path} -> ${status} (${detail})`);
    this.name = "WordPressError";
  }
}

const POST_TYPE = "evenement";
const PAGE_SIZE = 100;

/** `EventStore` backed by the WordPress REST API (`/wp/v2/evenement`, Pods fields enabled for REST). */
export class WordPressEventStore implements EventStore {
  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor(config: { baseUrl: string; username: string; appPassword: string }) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    // Application Passwords are shown with spaces; WordPress accepts them with or without.
    const password = config.appPassword.replace(/\s+/g, "");
    this.authHeader = `Basic ${btoa(`${config.username}:${password}`)}`;
  }

  async index(): Promise<Map<string, number>> {
    const index = new Map<string, number>();
    for (let page = 1; ; page++) {
      const posts = await this.request<Pick<EvenementPost, "id" | "spacebring_id">[]>("GET", `/${POST_TYPE}`, {
        query: { context: "edit", status: "any", page: String(page), per_page: String(PAGE_SIZE), _fields: "id,spacebring_id" },
      });
      for (const post of posts) if (post.spacebring_id) index.set(post.spacebring_id, post.id);
      if (posts.length < PAGE_SIZE) return index;
    }
  }

  get(postId: number): Promise<EvenementPost> {
    return this.request<EvenementPost>("GET", `/${POST_TYPE}/${postId}`, { query: { context: "edit" } });
  }

  async create(payload: EvenementPayload): Promise<number> {
    const post = await this.request<EvenementPost>("POST", `/${POST_TYPE}`, { body: payload });
    return post.id;
  }

  async update(postId: number, payload: EvenementPayload): Promise<void> {
    await this.request("POST", `/${POST_TYPE}/${postId}`, { body: payload });
  }

  async delete(postId: number): Promise<void> {
    await this.request("DELETE", `/${POST_TYPE}/${postId}`, { query: { force: "true" } });
  }

  async check(): Promise<void> {
    // `context=edit` forces authentication; a wrong post type or missing Pods REST setup 404s.
    await this.request("GET", `/${POST_TYPE}`, { query: { context: "edit", per_page: "1", _fields: "id" } });
  }

  private async request<T>(method: string, path: string, opts: { query?: Record<string, string>; body?: unknown } = {}): Promise<T> {
    const url = new URL(`${this.baseUrl}/wp-json/wp/v2${path}`);
    for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);

    const res = await fetch(url, {
      method,
      headers: {
        Authorization: this.authHeader,
        Accept: "application/json",
        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });

    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // non-JSON body (e.g. an HTML error page) — keep the raw text
    }

    if (!res.ok) throw new WordPressError(res.status, parsed as WordPressErrorBody | string, method, path);
    return parsed as T;
  }
}
