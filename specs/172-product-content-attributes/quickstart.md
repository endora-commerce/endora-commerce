# Quickstart: Product content attributes

How to see the feature working end to end, and how to prove the parts nobody sees. Commands
assume the repository root, Node 22 on `PATH`, and `pnpm run dev:infra` running.

## 0. Prepare

```bash
pnpm run build:packages                       # contracts, admin-kit and every module package changed
pnpm --filter backend run composer:generate   # migration + entity registries, docs sidebar
pnpm --filter backend run manifests:generate && pnpm install --lockfile-only
pnpm run setup                                # db:fresh, then module:install --all
pnpm run dev
```

## 1. Define (US1)

1. Admin → **Catalog → Attributes → New**. Key `buying_guide`, label EN "Buying guide", PL
   "Poradnik zakupowy", type **Page Builder content**.
2. Expect: no searchable / filterable / variant-axis / slider / comparable / quick-order / promo /
   price-rule / mass-edit / required / "Parametry" / per-channel controls; a note that the value
   is kept per language and that editing it requires the CMS module. Save.
3. Prove the API refusal:
   ```bash
   curl -sX PATCH "$API/api/v1/admin/catalog/attributes/buying_guide" -H "$AUTH" \
     -H 'content-type: application/json' -d '{"isSearchable":true}'
   # 400 VALIDATION_FAILED, details[0].path = "isSearchable"
   ```
4. **Catalog → Attribute sets → "Power tools"**: add `buying_guide`, drag it to position 3, save.
5. Generic custom fields: **Settings → Custom fields → Orders → New field** offers no Page Builder
   type; `POST /api/v1/admin/custom-fields/definitions` with `entityType: 'order'`,
   `valueType: 'page_builder'` → `400` (`value_type_unsupported`).

## 2. Author (US2)

1. Open a "Power tools" product → **Attributes** tab. The "Buying guide" card spans the grid:
   `EN empty · PL empty`, **Edit content**.
2. **Edit content** → `/catalog/products/<id>/content/buying_guide`. Build a heading + text + a
   library image in `en-US`; switch to `pl-PL`; with Translate configured (feature 151), use
   **Translate**; Save content.
3. Back on the product: `EN filled · PL filled`, "3 blocks · Choosing the right drill…".
4. **Audit log**: one "Product content updated" row naming the product, `attributeKey:
   buying_guide`, `languages: ["en-US","pl-PL"]` — no document.
5. Try to leave the editor with an unsaved edit → the unsaved-changes prompt.

## 3. See it (US3, US4)

1. Storefront `/pl/p/<slug>` → **Opis**: description paragraph, then the guide, no label heading.
   `curl -s "$STOREFRONT/pl/p/<slug>" | grep data-product-content` → present (SSR, SC-007).
2. Clear the product's plain description, reload → **Opis** still there with the guide only.
3. **Parametry** lists only attributes marked visible on the product page — by label, never a key.
   A product whose only values are hidden attributes shows no **Parametry** tab.
4. `GET /api/v1/catalog/products/<id>` (no `include`) is unchanged; with `?include=content` it
   carries `contentAttributes`. `GET /api/v1/external/catalog/products/<id>` never does.

## 4. Switch the CMS off and on (US5)

1. `/platform/modules` → CMS off.
2. Product attributes tab: the card keeps its chips and says editing requires the CMS module; the
   editing screen shows the notice, no canvas, no Save.
3. Storefront: no guide; the content-only product shows no **Opis**.
4. ```sql
   select md5(content::text) from product_content_values;   -- before and after: identical
   ```
5. CMS on → everything is back, no action needed.

## 5. Lifecycle (US6)

1. Duplicate the product → the copy's card shows the same chips.
2. Remove `buying_guide` from the set → nothing on the PDP, no card; add it back → it returns.
3. **Assets library**: delete the embedded image → blocked, "Product "…" — content "buying_guide"".
4. **Catalog → Attributes → buying_guide → Delete**: the dialog first says it is still in a set;
   after removing it from every set, it says "N products carry content for this attribute"; confirm.
5. Delete an ordinary attribute too (OR-5): a `select` attribute still on a product shows
   "N products hold a value" with no confirm. Once it is in no set and holds no value, confirm
   removes it with its options. A promotion condition on its key then stops matching, and the
   promotion itself is not deleted.

## 6. The suites

```bash
pnpm -r run typecheck && pnpm -r run lint
pnpm --filter backend run test:unit:fast
pnpm --filter '!backend' run test                         # contracts, catalog, cms, custom_fields, import_export, product_feeds co-located tests; admin; storefront
pnpm --filter backend exec vitest run test/contract/catalog/product-content.contract.test.ts \
  test/contract/catalog/content-attribute-definition.contract.test.ts \
  test/contract/catalog/product-content-exclusions.contract.test.ts \
  test/contract/custom_fields/page-builder-admissibility.contract.test.ts \
  test/contract/catalog/attribute-delete.contract.test.ts \
  test/contract/catalog/attributes-admin-v012.test.ts \
  test/contract/kernel/openapi-baseline.test.ts \
  test/integration/catalog/product-content-cms-off.test.ts \
  test/integration/catalog/attribute-delete-references.test.ts \
  test/integration/catalog/asset-references.test.ts
pnpm --filter backend exec vitest run test/contract/admin_users/permission-inventory.test.ts test/unit/_i18n/registered-bundles-shape.test.ts
pnpm --filter admin exec vitest run test/unit/palette-coverage.test.ts test/modules/catalog test/modules/cms
pnpm --filter backend run check:module-boundary && pnpm --filter backend run check:port-dependencies \
  && pnpm --filter backend run check:port-catches && pnpm --filter backend run composer:check \
  && pnpm --filter backend run manifests:check && pnpm --filter backend run check:module-docs \
  && pnpm --filter backend run check:docs-translations && pnpm --filter backend run i18n:hardcoded
pnpm run check:naming && pnpm run check:language
```

The contract and integration files run on `master` only in CI (D-198) — run them locally against
`pnpm run dev:infra:test` before asking for review.
