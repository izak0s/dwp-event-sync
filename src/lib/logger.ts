/** One JSON object per line, so Cloudflare's log viewer can filter on any field. */
type Fields = Record<string, unknown>;

const emit = (level: "info" | "warn" | "error", fields: Fields) => {
  const line = JSON.stringify({ level, ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
};

export const log = {
  info: (fields: Fields) => emit("info", fields),
  warn: (fields: Fields) => emit("warn", fields),
  error: (fields: Fields) => emit("error", fields),
};

/** Extracts what is worth logging from an unknown thrown value. */
export function errorFields(err: unknown): Fields {
  if (err instanceof Error) {
    const e = err as Error & { status?: number; body?: unknown };
    return { name: e.name, message: e.message, status: e.status, body: e.body, stack: e.stack };
  }
  return { message: String(err) };
}
