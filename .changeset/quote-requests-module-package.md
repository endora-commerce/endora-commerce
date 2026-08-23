---
'@endora-commerce/mod-quote-requests': minor
---

New package: the Quote Requests (RFQ) module, the second to leave `backend/src/modules/`
(feature 080, T040b).

Three subpaths, no root wildcard, every one of them compiled output (D-164):

- `@endora-commerce/mod-quote-requests` — the manifest. Isomorphic,
  `@endora-commerce/contracts` its only import, and where the generated manifest index reads
  the module's identity, settings, palette action and activation control from.
- `@endora-commerce/mod-quote-requests/backend` — `registerModule(ctx)`, the two ports it
  publishes (`quoteRequestReadPort`, `rfqService`), and the `entities` array the host's ORM
  registry spreads. **No entity class is exported by name** (D-168): the five
  `QuoteRequest*` classes are imported by the barrel to build that array and nothing else,
  so `import type { QuoteRequest } from '@endora-commerce/mod-quote-requests/backend'` does
  not compile in a consumer's tree, whoever the consumer is.
- `@endora-commerce/mod-quote-requests/migrations` — the `migrations` array the platform's
  package loader reads, plus the six migration classes by name for the host's migration
  registry. The names are contract in a way an entity class name is not: they are what
  `mikro_orm_migrations` persists, so every already-migrated database holds them as strings.

`@endora-commerce/platform` is a `peerDependency` (D-160.2), and so are `@mikro-orm/*`,
`fastify` and `zod`. Unlike `mod-blog` this package needs no `ioredis`: it holds no cache of
its own, and its BullMQ worker is registered through `ctx.worker`, which is the host's queue.

The manifest id stays `quote_requests` — identity of record for the lifecycle registry, the
settings store, the `rfqs:handle` permission code, the i18n bundle paths and the ownership of
all six migrations (D-142). The npm name is only how npm keeps names unique.

**What this package proves that `mod-blog` could not.** It ships six migrations rather than
one, so the per-module ordering chain has more than one link, and its `ctx.subscribe`
subscriber **writes** — `order.created.v1` completes the originating quote request — so a
test can tell a registered subscriber from an unregistered one, which is the obligation the
first module package left uncovered.
