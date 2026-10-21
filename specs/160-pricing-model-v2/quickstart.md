# Quickstart — Pricing model v2 (feature 160)

How a developer brings the feature up locally and checks the owner's scenarios. Paths relative to
the repository root.

## 1. Bring a database up on the new model

```bash
pnpm run build:packages            # every package resolves at ./dist
pnpm run dev:infra                 # Postgres, Redis, Meilisearch
pnpm run setup                     # db:fresh, then module:install --all (conversion + HY seed)
pnpm run cli demo reset            # withdraw the demo data, then load it again (E1–E3 books)
```

On a database that held the old model, `pnpm --filter backend run migration:up` runs the one-shot
conversion: base prices kept (Default brackets, `defaultPrice`, variant overrides), every other price
list dropped (`contracts/conversion-and-removal.md`). Nothing else needs converting — reseed the demo.

## 2. See the owner's scenarios

| Scenario | Buyer | Product | Expected (`specs/pricing/worked-examples.md`) |
| --- | --- | --- | --- |
| E1 | guest | *Screws 0200* (red, in Screws) | 120.00 |
| E2 | *Acme B2B (demo)* | *Screws 0200* | 80.00 |
| E3 | *Acme B2B (demo)* (VIP) | *Screws 0200* | 95.00 |

Ask the explanation endpoint why:

```bash
curl -s -X POST localhost:3001/api/v1/admin/price-books/resolve \
  -H 'authorization: Bearer <admin token>' -H 'content-type: application/json' \
  -d '{"salesChannelId":"<demo channel>","buyer":{"organizationId":"<acme>"},
       "lines":[{"key":"l1","productId":"<screws-0200>","quantity":1}]}'
# → price.amount "95.0000", explanation.tier "buyer", explanation.cell "org.product", precedenceVersion 1
```

## 3. Run the guards

```bash
pnpm --filter backend exec vitest run test/integration/price_lists/worked-examples.test.ts
pnpm --filter backend exec vitest run test/integration/price_lists/listing-prices-batch.test.ts \
  test/integration/price_lists/line-prices-batch.test.ts \
  test/integration/price_lists/price-surface-identity.test.ts \
  test/integration/carts/cart-read-equals-placement.test.ts
pnpm --filter @endora-commerce/mod-price-lists exec vitest run   # rank table, validatePrecedence (exhaustive)
PERF_RUN=true pnpm --filter backend exec vitest run test/perf/price_lists/price-surface.bench.ts
```

The bench prints p95 per scenario against the 150 ms budget and the refresh latency against 60 s
(`contracts/price-surface.md` §5).

## 4. Where things live

| Concern | Path |
| --- | --- |
| Resolver (three tiers, rank table) | `packages/modules/price_lists/src/backend/services/` |
| Admin price-book API | `packages/modules/price_lists/src/backend/routes.ts` (`/api/v1/admin/price-books/…`) |
| Schemas | `packages/contracts/src/price-books.ts`, `price-lists.ts` |
| Surface worker | `packages/modules/price_lists/src/backend/workers/price-surface-worker.ts` |
| The one cart chain | `packages/modules/carts/src/backend/services/cart-line-pricing.ts` |
| Semantics and vectors | `specs/pricing/decision-record.md`, `specs/pricing/worked-examples.md` |
