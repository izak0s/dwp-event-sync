import type { Event } from "@izak0s/spacebring-api";
import { describe, expect, it } from "vitest";
import { descriptionToHtml, eventLink, isInScope, isUpToDate, normalizeEntities, toEvenementPayload } from "../src/domain/event-mapper";
import type { EvenementPost } from "../src/domain/evenement";

const opts = { eventUrlBase: "https://app.example.com/events/", timeZone: "Europe/Amsterdam", postStatus: "publish" as const };

const baseEvent = {
  id: "ev-1",
  title: "Lunch",
  description: "Kom **eten**",
  startDate: "2026-07-16T10:30:00.000Z",
  endDate: "2026-07-16T11:30:00.000Z",
  imageUrl: "https://cdn.example.com/img.jpg",
  media: [{ url: "https://cdn.example.com/media.jpg" }],
  venue: "Dakterras",
  visibility: "public",
  location: { id: "loc", title: "de Werkplek", timezoneId: "Europe/Amsterdam" },
} as unknown as Event;

describe("toEvenementPayload", () => {
  it("maps all fields", () => {
    expect(toEvenementPayload(baseEvent, opts)).toEqual({
      title: "Lunch",
      status: "publish",
      datum: "2026-07-16 12:30:00",
      einddatum: "2026-07-16 13:30:00",
      locatie: "Dakterras",
      spacebring_link: "https://app.example.com/events/ev-1",
      omschrijving: "<p>Kom <strong>eten</strong></p>",
      spacebring_id: "ev-1",
      geannuleerd: 0,
      afbeelding: "https://cdn.example.com/media.jpg",
    });
  });

  it("uses the configured post status", () => {
    expect(toEvenementPayload(baseEvent, { ...opts, postStatus: "private" }).status).toBe("private");
  });

  it("falls back to location title when venue is empty", () => {
    expect(toEvenementPayload({ ...baseEvent, venue: "  " } as Event, opts).locatie).toBe("de Werkplek");
  });

  it("prefers media[0].url over the deprecated imageUrl", () => {
    expect(toEvenementPayload(baseEvent, opts).afbeelding).toBe("https://cdn.example.com/media.jpg");
  });

  it("falls back to imageUrl when media is empty", () => {
    expect(toEvenementPayload({ ...baseEvent, media: [] } as Event, opts).afbeelding).toBe("https://cdn.example.com/img.jpg");
  });

  it("empty string when neither is set", () => {
    expect(toEvenementPayload({ ...baseEvent, media: [], imageUrl: undefined } as Event, opts).afbeelding).toBe("");
  });

  it("marks cancelled events", () => {
    expect(toEvenementPayload({ ...baseEvent, cancelDate: "2026-07-01T00:00:00Z" } as Event, opts).geannuleerd).toBe(1);
  });

  it("empty description -> empty string", () => {
    expect(toEvenementPayload({ ...baseEvent, description: undefined } as Event, opts).omschrijving).toBe("");
  });
});

describe("descriptionToHtml", () => {
  it("renders markdown links and line breaks", () => {
    expect(descriptionToHtml("[Site](https://x.nl)\nregel 2")).toBe('<p><a href="https://x.nl">Site</a><br>regel 2</p>');
  });

  it("unescapes backslash-escaped underscores inside bare URLs", () => {
    const md = "link: https://docs.google.com/forms/d/e/1FA\\_haV\\_Sev/viewform";
    expect(descriptionToHtml(md)).toBe(
      '<p>link: <a href="https://docs.google.com/forms/d/e/1FA_haV_Sev/viewform">https://docs.google.com/forms/d/e/1FA_haV_Sev/viewform</a></p>',
    );
  });

  it("keeps escaped underscores outside URLs literal", () => {
    expect(descriptionToHtml("snake\\_case\\_word")).toBe("<p>snake_case_word</p>");
  });

  it("bracketed link with escaped underscore still works", () => {
    expect(descriptionToHtml("[f](https://x.nl/a\\_b)")).toBe('<p><a href="https://x.nl/a_b">f</a></p>');
  });
});

describe("eventLink", () => {
  it("joins base and id without double slash", () => {
    expect(eventLink("https://a/b/", "x")).toBe("https://a/b/x");
    expect(eventLink("https://a/b", "x")).toBe("https://a/b/x");
  });
});

describe("isInScope", () => {
  it("public and not deleted", () => expect(isInScope(baseEvent)).toBe(true));
  it("rejects non-public", () => expect(isInScope({ ...baseEvent, visibility: "members" } as Event)).toBe(false));
  it("rejects deleted", () => expect(isInScope({ ...baseEvent, deleteDate: "2026-01-01T00:00:00Z" } as Event)).toBe(false));
});

describe("normalizeEntities", () => {
  it("drops zero padding and converts hex", () => {
    expect(normalizeEntities("a&#039;b &#x27;c &#39;d &amp;")).toBe("a&#39;b &#39;c &#39;d &amp;");
  });
});

describe("isUpToDate", () => {
  const payload = toEvenementPayload(baseEvent, opts);
  const post = {
    id: 1,
    slug: "lunch",
    status: "publish",
    link: "",
    modified_gmt: "",
    title: { rendered: "Lunch", raw: "Lunch" },
    datum: payload.datum,
    einddatum: payload.einddatum,
    locatie: payload.locatie,
    spacebring_link: payload.spacebring_link,
    omschrijving: payload.omschrijving,
    spacebring_id: payload.spacebring_id,
    geannuleerd: "0",
    afbeelding: payload.afbeelding,
  } as EvenementPost;

  it("true when identical", () => expect(isUpToDate(post, payload)).toBe(true));
  it("treats never-set geannuleerd ([]) as 0", () => expect(isUpToDate({ ...post, geannuleerd: [] }, payload)).toBe(true));
  it("ignores entity spelling differences in omschrijving", () => {
    const p = { ...payload, omschrijving: "<p>Todo&#39;s</p>" };
    expect(isUpToDate({ ...post, omschrijving: "<p>Todo&#039;s</p>" }, p)).toBe(true);
  });
  it("false when a field differs", () => expect(isUpToDate({ ...post, locatie: "Keuken" }, payload)).toBe(false));
  it("false when cancelled flag differs", () => expect(isUpToDate({ ...post, geannuleerd: "1" }, payload)).toBe(false));
});
