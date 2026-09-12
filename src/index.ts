/**
 * Composition root. Wires config -> adapters -> SyncService -> HTTP app / cron.
 * Everything else in `src/` receives its dependencies; nothing else reads `env` directly.
 */
import { SpacebringEventSource } from "./adapters/spacebring-event-source";
import { WordPressEventStore } from "./adapters/wordpress-event-store";
import { loadConfig, type Env } from "./config";
import { SyncService } from "./domain/sync-service";
import { createApp } from "./http/app";
import type { Services } from "./http/context";
import { errorFields, log } from "./lib/logger";

function createServices(env: Env): Services {
  const config = loadConfig(env);
  const sync = new SyncService(SpacebringEventSource.create(config.spacebring), new WordPressEventStore(config.wordpress), {
    eventUrlBase: config.spacebring.eventUrlBase,
    timeZone: config.timeZone,
    postStatus: config.wordpress.postStatus,
  });
  return { config, sync };
}

const app = createApp(createServices);

/** Nightly safety net for missed webhooks: add/update only, never deletes. */
async function scheduled(controller: ScheduledController, env: Env): Promise<void> {
  const started = Date.now();
  try {
    const report = await createServices(env).sync.reconcileAll();
    log.info({ op: "reconcile", trigger: "cron", cron: controller.cron, ms: Date.now() - started, counts: report.counts });
  } catch (err) {
    log.error({ op: "reconcile", trigger: "cron", cron: controller.cron, ...errorFields(err) });
    throw err;
  }
}

export default {
  fetch: app.fetch,
  scheduled,
} satisfies ExportedHandler<Env>;
