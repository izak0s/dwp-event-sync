/**
 * Formats an instant (ISO 8601 / Date) as a Pods datetime string `YYYY-MM-DD HH:MM:SS`
 * in the given IANA timezone. Spacebring returns UTC ISO strings; Pods stores site-local time.
 */
export function toPodsDateTime(input: string | Date, timeZone: string): string {
  const date = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${String(input)}`);

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}
