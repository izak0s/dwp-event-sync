/**
 * Typed, validated configuration. Built once per request from the Worker bindings (`vars` in
 * wrangler.jsonc + secrets), so every "X is not configured" error surfaces here with a clear name
 * instead of as an undefined deep inside a client.
 */

export const ENV_KEYS = [
  "WP_BASE_URL",
  "WP_USERNAME",
  "WP_APP_PASSWORD",
  "SPACEBRING_CLIENT_ID",
  "SPACEBRING_CLIENT_SECRET",
  "SPACEBRING_LOCATION_REF",
  "SPACEBRING_EVENT_URL_BASE",
  "SPACEBRING_WEBHOOK_SECRET",
  "SITE_TIMEZONE",
  "WP_POST_STATUS",
] as const;

export const POST_STATUSES = ["publish", "private", "draft"] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

/** Raw Worker bindings. Everything is optional at the type level; `loadConfig` enforces presence. */
export type Env = Partial<Record<(typeof ENV_KEYS)[number], string>>;

export type Config = {
  wordpress: {
    baseUrl: string;
    username: string;
    appPassword: string;
    /** Status given to synced posts. `private` on staging keeps test events off the public site. */
    postStatus: PostStatus;
  };
  spacebring: {
    clientId: string;
    clientSecret: string;
    locationRef: string;
    eventUrlBase: string;
    /** Optional: without it the webhook route answers 500 (nothing else is affected). */
    webhookSecret?: string;
  };
  timeZone: string;
};

export class ConfigError extends Error {
  constructor(key: string, detail = "is not configured") {
    super(`${key} ${detail}`);
    this.name = "ConfigError";
  }
}

function postStatus(raw: string | undefined): PostStatus {
  const value = raw?.trim() || "publish";
  if (!(POST_STATUSES as readonly string[]).includes(value)) {
    throw new ConfigError("WP_POST_STATUS", `must be one of ${POST_STATUSES.join(", ")} (got "${value}")`);
  }
  return value as PostStatus;
}

export function loadConfig(env: Env): Config {
  const required = (key: keyof Env): string => {
    const value = env[key]?.trim();
    if (!value) throw new ConfigError(key);
    return value;
  };

  return {
    wordpress: {
      baseUrl: required("WP_BASE_URL"),
      username: required("WP_USERNAME"),
      appPassword: required("WP_APP_PASSWORD"),
      postStatus: postStatus(env.WP_POST_STATUS),
    },
    spacebring: {
      clientId: required("SPACEBRING_CLIENT_ID"),
      clientSecret: required("SPACEBRING_CLIENT_SECRET"),
      locationRef: required("SPACEBRING_LOCATION_REF"),
      eventUrlBase: required("SPACEBRING_EVENT_URL_BASE"),
      webhookSecret: env.SPACEBRING_WEBHOOK_SECRET?.trim() || undefined,
    },
    timeZone: env.SITE_TIMEZONE?.trim() || "Europe/Amsterdam",
  };
}
