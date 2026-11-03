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
| Search index bytes per channel, perf fixture, 1 language | not measured at T003 (no search fixture in `backend/test/perf/`); T139 measures it on base `4b670e6a4` | not measured at T139 (2026-11-03, S2): `backend/test/perf/` still holds no fixture that reaches Meilisearch, and a Before/After pair needs one written against both the pre-170 and the 170 indexer plus a second checkout at `4b670e6a4` — a measurement block of its own |
| Search index bytes per channel, perf fixture, 3 languages | as above | not measured at T139, as above |
| Search p95 query latency, 3 languages | as above | not measured at T139, as above |
| Editor scope switch: requests / p95 server time (SC-012) | 6–8 requests; p95 not measured at T003 (needs the dev stack) — T139 on base `4b670e6a4` | 1 request; p95 not measured at T139 (2026-11-03, S2): needs the dev stack and the admin, not run on this host |
| Storefront listing p95 with C×L overrides on 20% of products (163 SC-004 bench) | medians, corpus 20 000, 7 repeats, local test Postgres, 2026-10-30: default 1st page unscoped 145.3 / scoped 135.4 ms; default 2nd page 146.8 / 148.7 ms; `sort=name` 1st 256.5 / 261.5 ms; `sort=name` 2nd 364.7 / 390.2 ms (×1.070); free text 284.1 / 283.7 ms | **inconclusive** — two runs on branch tip `239fc2500`, corpus 20 000, 7 repeats, local test Postgres (S2 container), Meilisearch unreachable (`MEILISEARCH_URL=http://127.0.0.1:1`, Postgres fallback as at Before), 2026-11-03, on a host whose load average was 55–80 on 8 CPUs from parallel work. Run 1: default 1st page unscoped 558.4 / scoped 676.7 ms (×1.212); default 2nd page 579.5 / 613.8 ms (×1.059); `sort=name` 1st 635.4 / 991.5 ms (×1.560); `sort=name` 2nd 760.1 / 1323.9 ms (×1.742); free text 1297.9 / 1176.3 ms (×0.906) — the bench's 10 % gate failed on three scenarios. Run 2, load falling to 36: 448.1 / 304.4 ms (×0.679); 440.3 / 263.2 ms (×0.598); 485.6 / 425.2 ms (×0.876); 581.2 / 451.1 ms (×0.776); 622.8 / 418.4 ms (×0.672) — gate passed. Absolute times are 2–4× the Before column, so neither run compares with it; re-measure on an idle host |
