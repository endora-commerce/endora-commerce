# Quickstart — Pricing model v2 (feature 160)

How a developer brings the feature up locally and checks the owner's scenarios. Paths relative to
the repository root.

## 1. Bring a database up on the new model

```bash
pnpm run build:packages            # every package resolves at ./dist
pnpm run dev:infra                 # Postgres, Redis, Meilisearch
pnpm run setup                     # db:fresh, then module:install --all (conversion + HY seed)
pnpm --filter backend run cli demo seed   # the demo data, E1–E3 books included
```

`demo reset` only **withdraws** the demo data; on a database that already holds it, run
`demo reset` and then `demo seed` to restore the state below. The root `package.json` has no `cli`
script — the command is the backend's.

On a database that held the old model, `pnpm --filter backend run migration:up` runs the one-shot
conversion: Default-list brackets kept as base prices, every other price
list dropped (one a product feed is pinned to is retired as an empty, expired book instead — the
departure from N13, `research.md` R4), and the catalogue's `defaultPrice` and variant price override removed without
conversion (`contracts/conversion-and-removal.md`). A hand-made product with no Default bracket has no
price until you reseed the demo or enter a base price.

## 2. See the owner's scenarios

| Scenario | Buyer | Product | Expected (`specs/pricing/worked-examples.md`) |
| --- | --- | --- | --- |
| E1 | guest | *Screws 0200* (red, in Screws) | 120.00 |
| E2 | *Acme B2B (demo)* | *Screws 0200* | 80.00 |
| E3 | *Acme B2B (demo)* (VIP) | *Screws 0200* | 95.00 |

The scenarios are alternatives, priced on the `pl_retail` channel. After a seed E3's books are
active and E1's and E2's are drafts; to see E1 or E2, activate that scenario's books and move the
others' to draft. The demo books have fixed ids:

| Book | Id |
| --- | --- |
| E1 — red screws for everyone | `00000000-0000-4000-8000-0000000de101` |
| E2 — Acme B2B contract | `00000000-0000-4000-8000-0000000de201` |
| E3 — VIP customers | `00000000-0000-4000-8000-0000000de301` |
| E3 — Acme B2B terms | `00000000-0000-4000-8000-0000000de302` |

With `pnpm run dev` running, sign in (the admin API authenticates by the session cookie, not a
bearer token) and ask the explanation endpoint why:

```bash
curl -s -c /tmp/admin.jar -X POST localhost:3001/api/v1/auth/admin/login \
  -H 'content-type: application/json' -d '{"email":"admin@demo.local","password":"ChangeMe!123"}'

# the ids that are not fixed (DATABASE_URL of backend/.env; the .env.example default shown)
psql postgresql://b2b:b2b@localhost:5432/b2b -tA -c "select id from sales_channels where code = 'pl_retail'" \
  -c "select id from organizations where name = 'Acme B2B (demo)'" \
  -c "select id from products where sku = 'DEMO-SCREWS-0200'"

curl -s -b /tmp/admin.jar -X POST localhost:3001/api/v1/admin/price-books/resolve \
  -H 'content-type: application/json' \
  -d '{"salesChannelId":"<pl_retail>","buyer":{"organizationId":"<acme>"},
       "lines":[{"key":"l1","productId":"<screws-0200>","quantity":1}]}'
# → data[0]: price.amount "95.0000", explanation.tier "buyer", explanation.cell "org.product",
#   explanation.precedenceVersion 1, and the ranked explanation.candidates

# E1 instead (a guest is "buyer": {}): draft the E3 books, activate E1's
curl -s -b /tmp/admin.jar -X POST localhost:3001/api/v1/admin/price-books/<id>/draftify \
  -H 'content-type: application/json' -d '{}'
curl -s -b /tmp/admin.jar -X POST localhost:3001/api/v1/admin/price-books/<id>/activate \
  -H 'content-type: application/json' -d '{}'
# → guest: 120.0000, tier "catalogue"; with E2's book alone, Acme: 80.0000, tier "buyer"
```

## 3. Run the guards

The integration files need a database; the test Postgres is the fast one
(`specs/conventions/backend-test-suite.md`):

```bash
pnpm run dev:infra:test
export TEST_DATABASE_URL=postgresql://b2b:b2b@localhost:5441/b2b_test
pnpm --filter backend exec vitest run test/integration/price_lists/worked-examples/
pnpm --filter backend exec vitest run test/integration/price_lists/listing-prices-batch.test.ts \
  test/integration/price_lists/line-prices-batch.test.ts \
  test/integration/price_lists/price-surface-identity.test.ts \
  test/integration/carts/cart-read-equals-placement.test.ts \
  test/integration/price_lists/demo-scenarios.test.ts
pnpm --filter @endora-commerce/mod-price-lists exec vitest run   # rank table, validatePrecedence (exhaustive)
PERF_RUN=true pnpm --filter backend exec vitest run test/perf/price_lists/price-surface.bench.ts
```

The bench prints p95 per scenario against the 150 ms budget and the refresh latency against 60 s
(`contracts/price-surface.md` §5).

## 4. Where things live

| Concern | Path |
| --- | --- |
| Resolver (three tiers, rank table) | `packages/modules/price_lists/src/backend/services/` |
| Admin price-book API | `packages/modules/price_lists/src/backend/routes.price-books.ts` (`/api/v1/admin/price-books/…`) |
| Schemas | `packages/contracts/src/price-books.ts`, `price-lists.ts` |
| Surface worker | `packages/modules/price_lists/src/backend/workers/price-surface-worker.ts` |
| The one cart chain | `packages/modules/carts/src/backend/services/cart-line-pricing.ts` |
| Semantics and vectors | `specs/pricing/decision-record.md`, `specs/pricing/worked-examples.md` |
