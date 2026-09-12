import { describe, expect, it } from "vitest";
import { toPodsDateTime } from "../src/lib/dates";

const TZ = "Europe/Amsterdam";

describe("toPodsDateTime", () => {
  it("converts UTC to CEST (summer, +02:00)", () => {
    expect(toPodsDateTime("2026-07-16T10:30:00Z", TZ)).toBe("2026-07-16 12:30:00");
  });

  it("converts UTC to CET (winter, +01:00)", () => {
    expect(toPodsDateTime("2026-01-15T10:30:00Z", TZ)).toBe("2026-01-15 11:30:00");
  });

  it("rolls the date over midnight", () => {
    expect(toPodsDateTime("2026-07-16T22:30:00Z", TZ)).toBe("2026-07-17 00:30:00");
  });

  it("uses 24h clock without 24:00", () => {
    expect(toPodsDateTime("2026-01-15T23:00:00Z", TZ)).toBe("2026-01-16 00:00:00");
  });

  it("accepts Date objects", () => {
    expect(toPodsDateTime(new Date("2026-03-29T00:59:00Z"), TZ)).toBe("2026-03-29 01:59:00");
  });

  it("handles DST switch (2026-03-29 01:00 UTC becomes 03:00 CEST)", () => {
    expect(toPodsDateTime("2026-03-29T01:00:00Z", TZ)).toBe("2026-03-29 03:00:00");
  });

  it("throws on invalid input", () => {
    expect(() => toPodsDateTime("not a date", TZ)).toThrow("Invalid date");
  });
});
