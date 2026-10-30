# Quickstart: verifying the three-level scope model and the scope switcher

For a reviewer or builder checking 168 end to end on a dev stack. Commands follow `AGENTS.md`; which backend test
command to use is `specs/conventions/backend-test-suite.md`'s.

## 0. Prepare

```bash
git worktree add ../wt-168 -b <branch> origin/master     # or the feature worktree
bash ../wt-168/scripts/setup-worktree.sh
cd ../wt-168 && pnpm run build:packages
pnpm run dev:infra                                        # Postgres, Redis, Meilisearch
pnpm run setup                                            # db:fresh then module:install --all (runs every installHook)
```

**Migration clean-run on a 163-model database (SC-002).** Before pulling 168: `pnpm run setup` on `origin/master`,
load the demo data with `pnpm --filter backend run cli demo seed` (163-model rows: name maps in three languages, language URL keys, locale-only SEO rows, 163
channel tables). Then check out 168, `pnpm run build:packages`, `pnpm --filter backend run migration:up`. Expect: no error; `products.name` is `text`; the four
`*_scope_overrides` tables exist; `seo_meta_overrides` holds no product locale-only row;
`import_profiles` exists. Re-run migrate: nothing to do (FR-026). Automated by
`backend/test/integration/catalog/scope-model-migration.test.ts` and
`backend/test/integration/seo/product-meta-three-levels-migration.test.ts`.

## 1. Model (US2)

Seeded by the rewritten catalog demo: product "Drill X" in channels **B2B PL** (pl) and **Sklep PL** (pl), Global
name "Drill X".

```bash
# B2B PL × pl override
curl -X PUT -H 'content-type: application/json' $ADMIN/api/v1/admin/catalog/products/$P/scoped-values \
  -d '{"scope":{"channelId":"'$B2B'","languageCode":"pl"},"version":"'$V'","changes":{"name":"Wiertarka X"}}'
curl "$ADMIN/api/v1/admin/catalog/products/$P/scoped-values?channelId=$B2B&languageCode=pl"   # name.source = set
curl "$ADMIN/api/v1/admin/catalog/products/$P/scoped-values?channelId=$SKLEP&languageCode=pl" # inherited_global, "Drill X"
```

- `{"languageCode":"pl"}` without a channel → `422 VALIDATION_FAILED` (US2 #4).
- `{"channelId":"$B2B"}` + `"changes":{"name":"Drill X B2B"}` → accepted, resolves at B2B PL × every language (US2 #5).
- `"changes":{"audience":{…}}` at C×L → `422 FIELD_NOT_AT_SCOPE` (US2 #8).
- `"changes":{"description":null}` at B2B PL × pl → description `set_empty`; Sklep PL × pl still the Global description (US2 #9).
- `"changes":{"name":null}` → `422 SCOPED_VALUE_INVALID` `required_empty` (US6 #8).

## 2. Readers (US3)

Storefront at Sklep PL with `Accept-Language: pl` → PDP, listing, search, compare, basket line show "Drill X"; at
B2B PL → "Wiertarka X". Search at Sklep PL for "drill" with a Polish shopper and a product whose Polish name is
"Wiertarka X": not found (FR-033). `pnpm --filter backend exec vitest run
backend/test/unit/catalog/no-per-language-product-maps.test.ts` prints its read line and passes.

## 3. PIM and CSV (US4)

- Create an import profile (Import / export → Import profiles): `pl_PL → [B2B PL × pl, Sklep PL × pl]`, source
  language for Global `en_US`.
- Import a file with `sku,name[en_US],name[pl_PL],name[de_DE],description@B2B-PL/pl` and rows using empty, `NULL`,
  `INHERIT`, `\NULL`: report shows one `unmapped_locale` warning for `de_DE`; the Polish name at both targets; the
  description cell semantics per `contracts/write-encoding.md`.
- Export products, re-import the file unchanged with any profile: report 0 changes (FR-114).

## 4. Editor (US5–US12)

Open `/catalog/products/$P`:

1. Switch to B2B PL × Polish — the banner reads "Changes apply only to B2B PL × Polish", every tab shows values at
   that scope with sources; there is no other scope selector anywhere (SC-006).
2. Name: untick "Use value from B2B PL", type "Wiertarka X2", switch to Sklep PL → Save / Discard / Stay dialog.
   Save → one audit entry (Audit log, object Product) listing every changed field with scope.
3. Stage an SEO title and an alt text, Save → both written, one audit entry. Switch SEO off on `/platform/modules`,
   reload → no SEO tab, no error.
4. As an admin with `catalog:read` only: every control read-only, no Save / Archive / Duplicate / Delete, SEO visible.
5. Scopes tab: "Edit at B2B PL × Polish" opens the editor there; a cell's "URL key" link focuses the field.

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
| Search index bytes per channel, perf fixture, 1 language | not measured at T003 (no search fixture in `backend/test/perf/`); T139 measures it on base `4b670e6a4` | _to record_ |
| Search index bytes per channel, perf fixture, 3 languages | as above | _to record_ |
| Search p95 query latency, 3 languages | as above | _to record_ |
| Editor scope switch: requests / p95 server time (SC-012) | 6–8 requests; p95 not measured at T003 (needs the dev stack) — T139 on base `4b670e6a4` | 1 request, _to record_ |
| Storefront listing p95 with C×L overrides on 20% of products (163 SC-004 bench) | medians, corpus 20 000, 7 repeats, local test Postgres, 2026-10-30: default 1st page unscoped 145.3 / scoped 135.4 ms; default 2nd page 146.8 / 148.7 ms; `sort=name` 1st 256.5 / 261.5 ms; `sort=name` 2nd 364.7 / 390.2 ms (×1.070); free text 284.1 / 283.7 ms | _to record_ |
