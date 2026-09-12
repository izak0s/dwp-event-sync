import { marked } from "marked";
import { toPodsDateTime } from "../lib/dates";
import type { EvenementPayload, EvenementPost } from "./evenement";
import type { SpacebringEvent } from "./ports";

export type MapperOptions = {
  /** Public event URL prefix; the event id is appended. */
  eventUrlBase: string;
  /** IANA timezone the WordPress site runs in. */
  timeZone: string;
  /** Status for synced posts (`publish` on prod, `private` on staging). */
  postStatus: EvenementPayload["status"];
};

/** Only public, non-deleted events belong on the public website. */
export function isInScope(event: SpacebringEvent): boolean {
  return event.visibility === "public" && !event.deleteDate;
}

export function eventLink(eventUrlBase: string, eventId: string): string {
  return `${eventUrlBase.replace(/\/+$/, "")}/${eventId}`;
}

/**
 * Spacebring escapes markdown punctuation in descriptions (`foo\_bar`). CommonMark unescapes that in
 * text and in `[text](url)` destinations, but GFM autolinks (bare `https://…`) keep the backslash,
 * producing `%5C_` in the href. Strip those escapes inside bare URLs before parsing.
 */
export function unescapeBareUrls(markdown: string): string {
  return markdown.replace(/https?:\/\/[^\s<>()]+/g, (url) => url.replace(/\\([_*~#\\])/g, "$1"));
}

/** Spacebring descriptions are Markdown; Pods `omschrijving` holds HTML. */
export function descriptionToHtml(markdown: string | undefined): string {
  if (!markdown) return "";
  return (marked.parse(unescapeBareUrls(markdown), { async: false, gfm: true, breaks: true }) as string).trim();
}

export function toEvenementPayload(event: SpacebringEvent, opts: MapperOptions): EvenementPayload {
  return {
    title: event.title,
    status: opts.postStatus,
    datum: toPodsDateTime(event.startDate, opts.timeZone),
    einddatum: toPodsDateTime(event.endDate, opts.timeZone),
    locatie: event.venue?.trim() || event.location?.title || "",
    spacebring_link: eventLink(opts.eventUrlBase, event.id),
    omschrijving: descriptionToHtml(event.description),
    spacebring_id: event.id,
    geannuleerd: event.cancelDate ? 1 : 0,
    // `imageUrl` is deprecated in the Spacebring API in favour of `media[0].url`; keep it as fallback.
    afbeelding: event.media?.[0]?.url ?? event.imageUrl ?? "",
  };
}

/**
 * Canonicalises numeric character references so `&#39;` (marked) and `&#039;` (WordPress) compare
 * equal. Hex refs become decimal, leading zeros are dropped.
 */
export function normalizeEntities(html: string): string {
  return html
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => `&#${parseInt(hex, 16)};`)
    .replace(/&#0*(\d+);/g, "&#$1;");
}

/** True when the WordPress post already holds what `payload` would write (modulo entity spelling). */
export function isUpToDate(post: EvenementPost, payload: EvenementPayload): boolean {
  const same = (a: string, b: string) => normalizeEntities(a) === normalizeEntities(b);
  const title = post.title.raw ?? post.title.rendered;
  const cancelled = post.geannuleerd === "1" ? 1 : 0;
  return (
    same(title, payload.title) &&
    post.status === payload.status &&
    post.datum === payload.datum &&
    post.einddatum === payload.einddatum &&
    same(post.locatie, payload.locatie) &&
    post.spacebring_link === payload.spacebring_link &&
    same(post.omschrijving, payload.omschrijving) &&
    post.spacebring_id === payload.spacebring_id &&
    cancelled === payload.geannuleerd &&
    post.afbeelding === payload.afbeelding
  );
}
