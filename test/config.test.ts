import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config";

const full = {
  WP_BASE_URL: "https://wp.example",
  WP_USERNAME: "u",
  WP_APP_PASSWORD: "p",
  SPACEBRING_CLIENT_ID: "id",
  SPACEBRING_CLIENT_SECRET: "secret",
  SPACEBRING_LOCATION_REF: "loc",
  SPACEBRING_EVENT_URL_BASE: "https://app/events",
};

describe("loadConfig", () => {
  it("builds a config from complete bindings with defaults", () => {
    const config = loadConfig(full);
    expect(config.wordpress).toEqual({ baseUrl: "https://wp.example", username: "u", appPassword: "p", postStatus: "publish" });
    expect(config.spacebring.locationRef).toBe("loc");
    expect(config.spacebring.webhookSecret).toBeUndefined();
    expect(config.timeZone).toBe("Europe/Amsterdam");
  });

  it("names the missing key", () => {
    expect(() => loadConfig({ ...full, SPACEBRING_CLIENT_SECRET: "" })).toThrow(ConfigError);
    expect(() => loadConfig({ ...full, WP_APP_PASSWORD: undefined })).toThrow("WP_APP_PASSWORD is not configured");
  });

  it("accepts a valid WP_POST_STATUS and rejects others", () => {
    expect(loadConfig({ ...full, WP_POST_STATUS: "private" }).wordpress.postStatus).toBe("private");
    expect(() => loadConfig({ ...full, WP_POST_STATUS: "hidden" })).toThrow('WP_POST_STATUS must be one of publish, private, draft (got "hidden")');
  });

  it("trims values and honours overrides", () => {
    const config = loadConfig({ ...full, SITE_TIMEZONE: " UTC ", SPACEBRING_WEBHOOK_SECRET: " whsec_x " });
    expect(config.timeZone).toBe("UTC");
    expect(config.spacebring.webhookSecret).toBe("whsec_x");
  });
});
