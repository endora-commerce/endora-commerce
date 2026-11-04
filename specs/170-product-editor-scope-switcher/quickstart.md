# Quickstart: verifying the three-level scope model and the scope switcher

For a reviewer or builder checking 170 end to end on a dev stack. Commands follow `AGENTS.md`; which backend test
command to use is `specs/conventions/backend-test-suite.md`'s.

## 0. Prepare

```bash
git worktree add ../wt-170 -b <branch> origin/master     # or the feature worktree
bash ../wt-170/scripts/setup-worktree.sh
cd ../wt-170 && pnpm run build:packages
pnpm run dev:infra                                        # Postgres, Redis, Meilisearch
pnpm run setup                                            # db:fresh then module:install --all (runs every installHook)
```

**Migration clean-run on a 163-model database (SC-002).** Before pulling 170: `pnpm run setup` on `origin/master`,
load the demo data with `pnpm --filter backend run cli demo seed` (163-model rows: name maps in three languages, language URL keys, locale-only SEO rows, 163
channel tables). Then check out 170, `pnpm run build:packages`, `pnpm --filter backend run migration:up`. Expect: no error; `products.name` is `text`; the four
`*_scope_overrides` tables exist; `seo_meta_overrides` holds no product locale-only row;
`import_profiles` exists. Re-run migrate: nothing to do (FR-026). Automated by
`backend/test/integration/catalog/scope-model-migration.test.ts` and
`backend/test/integration/seo/product-meta-three-levels-migration.test.ts`.

## 1. Model (US2)

The demo's two channels, both offering `pl-PL` and `en-US`: **`pl_retail`** (PL Retail, the system default, public)
and **`pl_b2b_vip`** (PL B2B VIP, prices after sign-in). `pnpm --filter backend run cli demo seed` gives the scope
product **Drill X** (`DEMO-DRILL-X`, sold on both) these texts — the composition step *"the scope product's Channel
and Channel × language texts"*:

| Scope | name | description |
| --- | --- | --- |
| Global | Drill X | Cordless drill X: 18 V, two speeds, keyless chuck. |
| `pl_retail` (Channel) | — inherits Global | — inherits Global |
| `pl_retail` × pl-PL | **Wiertarka X** (own) | **Wiertarka akumulatorowa X: …** (own) |
| `pl_retail` × en-US | — inherits Global | — inherits Global |
| `pl_b2b_vip` (Channel) | **Drill X Pro** (own) | — inherits Global |
| `pl_b2b_vip` × pl-PL | **Wiertarka X Pro** (own) | **empty** (deliberately, `{"v": null}`) |
| `pl_b2b_vip` × en-US | — inherits "Drill X Pro" | — inherits Global |

`$RETAIL` and `$VIP` below are the two channels' ids (`GET /api/v1/admin/sales-channels`), `$P` Drill X's id.

```bash
curl "$ADMIN/api/v1/admin/catalog/products/$P/scoped-values?channelId=$RETAIL&languageCode=pl-PL"  # name.source = set, "Wiertarka X"
curl "$ADMIN/api/v1/admin/catalog/products/$P/scoped-values?channelId=$RETAIL&languageCode=en-US"  # name.source = inherited_global, "Drill X"
curl "$ADMIN/api/v1/admin/catalog/products/$P/scoped-values?channelId=$VIP&languageCode=en-US"     # name.source = inherited_channel, "Drill X Pro"
curl "$ADMIN/api/v1/admin/catalog/products/$P/scoped-values?channelId=$VIP&languageCode=pl-PL"     # description.source = set_empty
# Retail × en-US override
curl -X PUT -H 'content-type: application/json' $ADMIN/api/v1/admin/catalog/products/$P/scoped-values \
  -d '{"scope":{"channelId":"'$RETAIL'","languageCode":"en-US"},"version":"'$V'","changes":{"name":"Drill X (retail)"}}'
```

- `{"languageCode":"pl-PL"}` without a channel → `422 VALIDATION_FAILED` (US2 #4).
- `{"channelId":"$VIP"}` + `"changes":{"name":"Drill X Pro 2"}` → accepted, resolves at `pl_b2b_vip` × en-US
  (which inherits) and not at `pl_b2b_vip` × pl-PL, which keeps its own "Wiertarka X Pro" (US2 #5).
- `"changes":{"audience":{…}}` at C×L → `422 FIELD_NOT_AT_SCOPE` (US2 #8).
- `"changes":{"description":null}` at `pl_retail` × pl-PL → description `set_empty`; `pl_retail` × en-US still the
  Global description (US2 #9) — the seeded `pl_b2b_vip` × pl-PL row is the same state.
- `"changes":{"description":{"inherit":true}}` at `pl_b2b_vip` × pl-PL → back to the Global description.
- `"changes":{"name":null}` → `422 SCOPED_VALUE_INVALID` `required_empty` (US6 #8).

## 2. Readers (US3)

Storefront on `pl_retail` with `Accept-Language: en-US` → PDP, listing, search, compare and basket line show "Drill
X"; with `pl-PL` → "Wiertarka X"; on `pl_b2b_vip`, signed in as `buyer@demo-org.example`, `en-US` → "Drill X Pro"
and `pl-PL` → "Wiertarka X Pro" with no description. Search on `pl_retail` for "drill" as a Polish shopper: Drill X
is not found, its Polish name being "Wiertarka X" (FR-033); "wiertarka" finds it, and "drill" in `en-US` finds it.
`pnpm --filter backend exec vitest run backend/test/unit/catalog/no-per-language-product-maps.test.ts` prints its
read line and passes.

## 3. PIM and CSV (US4)

- Create an import profile (Import / export → Import profiles): `pl_PL → [pl_retail × pl-PL, pl_b2b_vip × pl-PL]`,
  source language for Global `en_US`.
- Import `specs/170-product-editor-scope-switcher/fixtures/demo-scoped-import.csv` (dry run first) — three demo
  products, a locale column per source language and per-scope columns at Channel and at Channel × language:

  ```csv
  sku,name[en_US],name[pl_PL],name[de_DE],name@pl_b2b_vip,description@pl_retail/pl-PL,description@pl_b2b_vip/pl-PL
  DEMO-DRILL-X,Drill X,Wiertarka X,Bohrmaschine X,Drill X Pro,Wiertarka akumulatorowa X: 18 V.,NULL
  DEMO-BOLTS-0001,,Śruby 0001,Schrauben 0001,INHERIT,INHERIT,
  DEMO-WRENCHES-0002,Wrenches 0002,,,Wrenches 0002 VIP,\NULL,INHERIT
  ```

  Expect: the dry run's per-column counts (`name@pl_b2b_vip`: 1 `INHERIT`; `description@pl_retail/pl-PL`:
  1 `INHERIT`; `description@pl_b2b_vip/pl-PL`: 1 `NULL`, 1 `INHERIT`) and **one** `unmapped_locale` warning for
  `de_DE` naming 2 products. After Apply: `name[pl_PL]` lands at both pl-PL targets (Drill X's VIP × pl-PL name
  becomes "Wiertarka X"); `DEMO-BOLTS-0001` keeps its Global name (empty cell = no change) and inherits at the VIP
  channel and at retail × pl-PL; `DEMO-WRENCHES-0002`'s retail × pl-PL description is the text `NULL` (`\NULL`), its
  VIP × pl-PL description inherits; Drill X's VIP × pl-PL description stays deliberately empty. Cell semantics per
  `contracts/write-encoding.md`; the file is held to the header grammar and the demo's channels by
  `backend/test/unit/catalog/quickstart-import-fixture.test.ts`.
- Export products, re-import the file unchanged with any profile: report 0 changes (FR-114).

## 4. Editor (US5–US12)

Open `/catalog/products/$P` (Drill X):

1. Switch to PL B2B VIP × Polish — the banner reads "Changes apply only to PL B2B VIP × Polish", every tab shows
   values at that scope with sources (name own, description deliberately empty); there is no other scope selector
   anywhere (SC-006).
2. Name: untick "Use value from PL B2B VIP", type "Wiertarka X2", switch to PL Retail → Save / Discard / Stay dialog.
   Save → one audit entry (Audit log, object Product) listing every changed field with scope.
3. Stage an SEO title and an alt text, Save → both written, one audit entry. Switch SEO off on `/platform/modules`,
   reload → no SEO tab, no error.
4. As an admin with `catalog:read` only: every control read-only, no Save / Archive / Duplicate / Delete, SEO visible.
5. Scopes tab: "Edit at PL B2B VIP × Polish" opens the editor there; a cell's "URL key" link focuses the field.

## 5. Tests to run (targeted; full suite is CI's)

```bash
pnpm --filter @endora-commerce/contracts exec vitest run src/product-scope-model.test.ts src/scoped-write-encoding.test.ts src/pim-locale-mapping.test.ts src/pim-field-path.test.ts
pnpm --filter backend exec vitest run test/contract/catalog/scoped-values-*.test.ts test/integration/catalog/scope-model-migration.test.ts
pnpm --filter backend exec vitest run test/contract/import_export test/integration/import_export
pnpm --filter backend exec vitest run test/integration/search/language-restricted-match.test.ts
pnpm --filter admin exec vitest run test/modules/catalog/product-editor-scope-*.test.tsx test/modules/catalog/product-editor-f1-f2-regression.test.tsx
pnpm --filter '!backend' run test   # packages, incl. admin-kit ScopedField and page-builder-admin
```

## Measurements

Recorded by the measurement tasks in `tasks.md` (Polish phase):

| Measure | Before | After |
| --- | --- | --- |
| Search index bytes per channel, perf fixture, 1 language | not measured at T003 (no search fixture in `backend/test/perf/`); T139 measures it on base `4b670e6a4` | not measured at T139 (2026-11-03, S2): `backend/test/perf/` still holds no fixture that reaches Meilisearch, and a Before/After pair needs one written against both the pre-170 and the 170 indexer plus a second checkout at `4b670e6a4` — a measurement block of its own. Still not measured at T139 (2026-11-04, measurement block): the same reason holds — no perf fixture reaches Meilisearch, and writing one that both indexers accept was out of the block's scope |
| Search index bytes per channel, perf fixture, 3 languages | as above | not measured at T139, as above |
| Search p95 query latency, 3 languages | as above | not measured at T139, as above |
| Editor scope switch: requests / p95 server time (SC-012) | 6–8 requests; p95 not measured at T003 (needs the dev stack); not measurable on base `4b670e6a4` at T139 — the `scoped-values` route does not exist there | **1 request** (`GET …/scoped-values`, one per switch). Server time measured at T139 (2026-11-04, tip `e0934fefa`) through `app.inject` on the backend test app, own test Postgres, host load 2.6–4.0: one product on two channels (`pl-PL`, `en-US`) with own C, C×L and empty-C×L values, 6 scopes (G, C, C×L ×2, second C, its C×L) read 50 times each after a warm-up — **switch p50 36.2 ms, p95 47.3 ms (n = 300)**; the admin product detail `GET …/products/:id`, same run, p50 16.8 ms, p95 25.5 ms (n = 50). The 170 editor's page load itself opens with the same `GET …/scoped-values` (plus categories, attribute sets and the editor preference), so a switch is a strict subset of a page load: SC-012 holds. Browser render time not measured |
| Storefront listing p95 with C×L overrides on 20% of products (163 SC-004 bench) | medians, corpus 20 000, 7 repeats, local test Postgres, 2026-10-30: default 1st page unscoped 145.3 / scoped 135.4 ms; default 2nd page 146.8 / 148.7 ms; `sort=name` 1st 256.5 / 261.5 ms; `sort=name` 2nd 364.7 / 390.2 ms (×1.070); free text 284.1 / 283.7 ms. **Re-measured at T139** on `4b670e6a4` (2026-11-04, 5 runs alternating with After, table below), median of 5 run medians, unscoped / scoped: default 1st 178.1 / 173.2 ms; default 2nd 171.4 / 177.5 ms; `sort=name` 1st 312.7 / 341.6 ms; `sort=name` 2nd 468.0 / 507.5 ms; free text 364.1 / 382.8 ms. Its own 10 % gate failed in 2 of 5 runs (`sort=name` up to ×1.238) | **passes** — T139, 2026-11-04, tip `e0934fefa`, corpus 20 000, 7 repeats, 5 runs alternating with Before on an idle host (1-min load 2.6–4.1 on 8 CPUs), own test Postgres per side, Meilisearch unreachable on both (`MEILISEARCH_URL=http://127.0.0.1:1`). Median of 5 run medians, unscoped / scoped: default 1st 205.0 / 176.3 ms; default 2nd 188.7 / 175.9 ms; `sort=name` 1st 250.7 / 269.8 ms; `sort=name` 2nd 321.2 / 347.7 ms; free text 310.1 / 317.9 ms. Median scoped/unscoped ratio: ×0.868, ×0.932, ×1.094, ×1.099, ×1.047 — every scenario within +10 %. Single runs crossed the gate in 3 of 5 (max ×1.152, `sort=name` 2nd), against 2 of 5 on Before (max ×1.238): at 7 repeats one run is noise-bound on both sides. Against Before, the scoped medians are +1.8 %, -0.9 %, -21 %, -31 % and -17 %. The S2 run of 2026-11-03 (×1.56 / ×1.74 on `sort=name` at load 55–80) is cleared. Caveat: the bench inserts `jsonb_build_object('en-US', …)` into `products.name`/`description`, which are `text` on 170, so After's Global names are the literal string `{"en-US": "Perf scoped N"}` (accepted silently); bench left unchanged to keep method parity |

**T139 listing runs** (2026-11-04, `cd backend && PERF_RUN=true MEILISEARCH_URL=http://127.0.0.1:1 MEILISEARCH_HOST=http://127.0.0.1:1 TEST_DATABASE_URL=… REDIS_URL=… BACKEND_TEST_WORKERS=1 pnpm exec vitest run test/perf/catalog/listing-scoped-availability.bench.ts`; Before in a throwaway worktree at `4b670e6a4` on Postgres 5449 / Redis 6399, After on Postgres 5448 / Redis 6398; the bench file is identical on both sides). Cells are unscoped / scoped medians in ms, with the ratio; "Gate" is the bench's own per-run 10 % check.

| Run (order) | Side | Load before / after (1-min) | default 1st | default 2nd | `sort=name` 1st | `sort=name` 2nd | free text | Gate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Before `4b670e6a4` run 1 | 5.64 / 3.11 | 150.1 / 144.5 (×0.963) | 149.7 / 145.3 (×0.970) | 274.8 / 266.7 (×0.971) | 410.9 / 403.8 (×0.983) | 302.3 / 306.4 (×1.013) | pass |
| 2 | After `e0934fefa` run 1 | 2.94 / 2.59 | 192.2 / 170.0 (×0.885) | 176.5 / 164.4 (×0.931) | 238.8 / 262.1 (×1.098) | 298.1 / 322.4 (×1.082) | 279.6 / 292.7 (×1.047) | pass |
| 3 | Before `4b670e6a4` run 2 | 2.62 / 2.74 | 164.4 / 173.2 (×1.053) | 166.2 / 177.5 (×1.068) | 288.5 / 357.3 (×1.238) | 471.6 / 548.7 (×1.163) | 364.1 / 387.3 (×1.064) | fail |
| 4 | After `e0934fefa` run 2 | 2.74 / 2.80 | 205.0 / 164.2 (×0.801) | 227.3 / 169.0 (×0.743) | 264.5 / 252.8 (×0.956) | 331.7 / 330.3 (×0.996) | 298.1 / 292.9 (×0.982) | pass |
| 5 | Before `4b670e6a4` run 3 | 2.80 / 2.63 | 178.1 / 172.7 (×0.970) | 182.3 / 168.5 (×0.924) | 312.7 / 332.1 (×1.062) | 462.3 / 507.5 (×1.098) | 361.4 / 382.8 (×1.059) | pass |
| 6 | After `e0934fefa` run 3 | 2.63 / 3.07 | 197.7 / 185.9 (×0.940) | 189.1 / 180.3 (×0.954) | 273.7 / 295.9 (×1.081) | 330.9 / 372.8 (×1.127) | 310.1 / 336.9 (×1.086) | fail |
| 7 | After `e0934fefa` run 4 | 2.90 / 3.10 | 212.3 / 176.3 (×0.831) | 188.7 / 175.9 (×0.932) | 246.6 / 269.8 (×1.094) | 321.2 / 370.1 (×1.152) | 311.0 / 350.3 (×1.126) | fail |
| 8 | Before `4b670e6a4` run 4 | 3.10 / 3.93 | 183.5 / 178.6 (×0.973) | 171.4 / 181.4 (×1.058) | 321.3 / 342.9 (×1.067) | 474.5 / 506.9 (×1.068) | 365.5 / 373.3 (×1.021) | pass |
| 9 | After `e0934fefa` run 5 | 3.93 / 4.12 | 214.9 / 186.5 (×0.868) | 180.8 / 184.2 (×1.019) | 250.7 / 284.9 (×1.137) | 316.4 / 347.7 (×1.099) | 311.6 / 317.9 (×1.020) | fail |
| 10 | Before `4b670e6a4` run 5 | 4.12 / 2.61 | 229.3 / 185.6 (×0.810) | 180.9 / 178.0 (×0.984) | 321.5 / 341.6 (×1.063) | 468.0 / 527.9 (×1.128) | 365.0 / 400.9 (×1.098) | fail |
