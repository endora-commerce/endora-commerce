---
'@endora-commerce/mod-google-analytics': minor
---

New package: the Google Analytics module, the third to leave `backend/src/modules/`
(feature 080, T040b).

Three subpaths, no root wildcard, every one of them compiled output (D-164):

- `@endora-commerce/mod-google-analytics` — the manifest. Isomorphic,
  `@endora-commerce/contracts` its only import, and where the generated manifest index reads
  the module's identity, its eight settings, its two palette actions and its activation
  control (`google_analytics.module_enabled`) from.
- `@endora-commerce/mod-google-analytics/backend` — `registerModule(ctx)` and the `entities`
  array the host's ORM registry spreads. **`GaCustomEvent` is not exported by name** (D-168):
  the barrel imports it to build that array and nothing else, so
  `import type { GaCustomEvent } from '@endora-commerce/mod-google-analytics/backend'` does
  not compile in a consumer's tree, whoever the consumer is. Nothing is lost by that — the
  table's one cross-module edge is a foreign key into `sales_channels`, and a foreign key
  needs the table, never the owner's class (D-169).
- `@endora-commerce/mod-google-analytics/migrations` — the `migrations` array the platform's
  package loader reads, plus `Migration20260715T171116GoogleAnalyticsInit` by name for the
  host's migration registry. One class, which is the case most likely to tempt an author into
  publishing the class alone: a missing `migrations` array makes the loader refuse the package
  outright at boot.

`@endora-commerce/platform` is a `peerDependency` (D-160.2), and so are
`@endora-commerce/contracts`, `@mikro-orm/*`, `fastify` and `zod`. This is the first module
package to take **`bullmq`** as a peer, and it takes `ioredis` with it: the module builds its
own `Queue` and `Worker` for server-side GA4 delivery and receives the connection from the
host under `moduleQueueRedis`.

The manifest id stays `google_analytics` — identity of record for the lifecycle registry, the
settings store, the `google_analytics:read` / `google_analytics:write` permission codes, the
i18n bundle paths and the ownership of its migration (D-142). The npm name is only how npm
keeps names unique.

**What this package proves that the first two could not.** It is the first with a real BullMQ
consumer: `blog` has none and `quote_requests`' `RfqExpiryWorker` is a plain `sweep()`, which
is why neither needed `bullmq`. `ctx.worker` is `defineModuleWorker`, and a packaged module
that registered its worker outside that seam would leave the platform's stop switch attached
to nothing while every existing test stayed green.
`backend/test/integration/google_analytics/packaged-worker.test.ts` composes the package with
a real Redis and measures both halves: a job the packaged producer enqueues is consumed, and
`pauseWorkersFor('google_analytics')` reaches that worker and stops it.
