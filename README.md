# dwp-event-sync

Cloudflare Worker (Hono) that syncs Spacebring events to the WordPress `evenement` Pods post type.
Spacebring webhooks (Svix-signed) trigger a re-sync of one event; a nightly cron (02:00 UTC) reconciles everything
(add/update only). Those two are the only triggers; there is no admin API.
See `docs/PLAN.md` for design decisions and field mapping.

## Environments

| env       | Worker                    | Spacebring network | WordPress                          | deployed by            |
|-----------|---------------------------|--------------------|------------------------------------|------------------------|
| `staging` | `dwp-event-sync-staging`  | SDK test network   | `https://werkplek.wptwantemp.nl`   | push to `main`         |
| `prod`    | `dwp-event-sync-prod`     | live network       | dev site for now (see below)       | git tag `v*`           |

Non-secret config (`WP_BASE_URL`, `WP_POST_STATUS`, `SITE_TIMEZONE`) lives in `wrangler.jsonc` under `env.<name>.vars`.
Staging writes posts as `private` so test events never show on the public site; prod writes `publish`.
Secrets are set once, by hand, per environment (see below) and never by CI.

## One-time setup (human)

### 1. Worker secrets (per environment)

Create `.secrets.<env>.json` (gitignored) with every key from `.dev.vars.example`:

```json
{
  "WP_USERNAME": "...",
  "WP_APP_PASSWORD": "...",
  "SPACEBRING_CLIENT_ID": "...",
  "SPACEBRING_CLIENT_SECRET": "...",
  "SPACEBRING_LOCATION_REF": "...",
  "SPACEBRING_EVENT_URL_BASE": "https://<network>.spacebring.com/suite/organizations/<locationId>/events",
  "SPACEBRING_WEBHOOK_SECRET": "whsec_..."
}
```

Then upload (requires `npx wrangler login`):

```sh
npm run secrets:staging   # or secrets:prod
```

Re-run the same command after changing a value; secrets apply within a few seconds, no redeploy needed.

### 2. Spacebring webhook endpoint (per network)

Network Settings → Developers → Webhooks → add endpoint
`https://dwp-event-sync-<env>.izak.workers.dev/webhooks/spacebring`, subscribe to
`event.created`, `event.updated`, `event.canceled`, `event.deleted`, and put its signing secret in
`SPACEBRING_WEBHOOK_SECRET` (step 1).

### 3. GitHub repository secrets (once)

- `CLOUDFLARE_API_TOKEN` — Cloudflare dashboard → My Profile → API Tokens → template "Edit Cloudflare Workers".
- `CLOUDFLARE_ACCOUNT_ID` — from `npx wrangler whoami`.

Optionally create GitHub environments `staging` and `production` and add required reviewers to `production`.

### 4. Production config

`env.prod.vars.WP_BASE_URL` in `wrangler.jsonc` still points at the dev site (`werkplek.wptwantemp.nl`) because the live
site does not exist yet. When it does: change that value, update `WP_USERNAME`/`WP_APP_PASSWORD` in `.secrets.prod.json`,
`npm run secrets:prod`, and tag a release. Steps 1–2 for `prod` (live Spacebring credentials + webhook) are needed before
the first `v*` tag either way.

## Releasing

```sh
git push origin main            # -> tests, deploy staging
git tag v1.0.0 && git push origin v1.0.0   # -> tests, deploy prod
```

## Local development

```sh
npm install
cp .dev.vars.example .dev.vars.staging   # fill in (test network + dev WordPress)
npm run dev                              # http://localhost:8799, uses .dev.vars.staging
npm test
npm run typecheck
npm run tail:staging                     # live logs of the deployed staging Worker
```

## Code layout

```
src/
  index.ts                composition root: config -> adapters -> SyncService -> app / cron
  config.ts               loadConfig(env): validated, typed Config; the only place that reads bindings
  domain/                 framework-free core
    ports.ts              EventSource (Spacebring side) and EventStore (WordPress side) interfaces
    evenement.ts          the WordPress post shape (EvenementPayload / EvenementPost)
    event-mapper.ts       Spacebring event -> EvenementPayload; scope + up-to-date rules (pure functions)
    sync-service.ts       SyncService: syncOne / reconcileAll / health against the two ports
  adapters/
    spacebring-event-source.ts   EventSource via @izak0s/spacebring-api
    wordpress-event-store.ts     EventStore via the WordPress REST API
  http/
    app.ts                createApp(serviceFactory): /health, per-request services, error mapping
    webhook-routes.ts     /webhooks/spacebring (Svix verification, type whitelist)
  lib/                    dates, logger
test/
  fakes.ts                in-memory EventSource / EventStore used by the service tests
```

## Routes

| Method | Path                     | Auth | Description                                                              |
|--------|--------------------------|------|--------------------------------------------------------------------------|
| GET    | `/health`                | none | Checks both credentials; `{ ok, checks: { source, store } }`, 200 or 503 |
| POST   | `/webhooks/spacebring`   | Svix | Spacebring webhook; re-syncs the referenced event (create/update/delete) |

Everything else is 404.

## Running a reconcile by hand

Run the cron locally against any environment's credentials (uses `.dev.vars.<env>`):

```sh
npx wrangler dev --env staging --port 8799 --test-scheduled
curl 'localhost:8799/__scheduled?cron=0+2+*+*+*'   # add/update every public event, deletes nothing
```

Use this for the first backfill of a new environment instead of waiting for 02:00 UTC.
