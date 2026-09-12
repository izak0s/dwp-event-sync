import type { Config, Env } from "../config";
import type { SyncService } from "../domain/sync-service";

/** What a request handler needs, built per request from the bindings (see `src/index.ts`). */
export type Services = {
  config: Config;
  sync: SyncService;
};

export type ServiceFactory = (env: Env) => Services;

/** Hono generics for every router in this app. */
export type AppEnv = {
  Bindings: Env;
  Variables: { services: Services };
};
