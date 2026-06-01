# b2b-platform Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-05-05

## Active Technologies
- TypeScript 5.x (strict mode) na Node.js LTS (≥ 22.17, jak w README po update foundation 001). + bez nowych runtime — wszystkie wymagane już są: (002-catalog-module)
- PostgreSQL — nowe tabele `attribute_sets`, `attribute_set_attributes` (bridge), `gallery_items`, `gallery_item_labels` (bridge etykiet), `product_attachments`, `attachment_types`, `product_links`, `grouped_items`, `bundle_slots`, `bundle_slot_options`. Migracje generowane standardową ścieżką MikroORM (`pnpm --filter backend run migration:generate`). Zmiany w `products`: dodanie kolumn `attributeSetId` (FK), `downloadAssetId` (FK nullable, virtual), `downloadUrl` (varchar nullable, virtual), rozszerzenie enuma `type`. Zmiana enuma `valueType` w `product_attributes` (dodanie `multiselect`, `price`) + nowa kolumna `displayAsSlider` (bool). (002-catalog-module)
- TypeScript 5.x strict; Node.js LTS ≥ 22.17 per repo `README` and engines field in `backend/package.json`. + Existing stack only — Fastify, MikroORM, Zod, Vitest, ioredis, BullMQ-class queues. **No new runtime dependency** is justified for this feature. (004-settings-module)
- PostgreSQL — five new tables introduced via a single MikroORM migration (`005_settings_init.ts`): (004-settings-module)
- TypeScript 5.x strict; Node.js LTS ≥ 22.17 per repo `README` and engines field in `backend/package.json`. + Existing stack only — Fastify, MikroORM, Zod, Vitest, ioredis, BullMQ-class queues. **No new runtime dependency** is justified for this feature. (005-sales-channels)
- PostgreSQL — one MikroORM migration (`025_sales_channels_promote.ts`): (005-sales-channels)
- TypeScript 5.x (strict) on Node.js LTS ≥ 22.17, per `backend/package.json` engines and the project README. + Fastify, MikroORM (PostgreSQL driver), Zod (boundary validation), Meilisearch JS client, ioredis, BullMQ-class queues, Next.js (storefront) and React (admin) — **no new runtime dependency**. (006-search-module)
- PostgreSQL — one new MikroORM migration (`026_search_phrase_records_init.ts`) creating `search_phrase_records` and its indexes; no other schema change. Meilisearch (existing) hosts the per-channel `products_<channel_code>` indexes; `search.llm.enabled=true` attaches a Meilisearch embedder per channel index. (006-search-module)
- TypeScript 5.x (strict) on Node.js LTS ≥ 22.17, per `backend/package.json` engines and the project README. + Fastify, MikroORM (PostgreSQL driver), Zod (boundary validation), ioredis, BullMQ-class queues, Next.js (storefront), React (admin) — **plus** one new dependency, `pdfmake`, used exclusively by the comparison-PDF service. No other addition. (007-compare-module)
- PostgreSQL — three new MikroORM migrations: (007-compare-module)
- TypeScript 5.x (strict) on Node.js LTS ≥ 22.17. + Fastify, MikroORM (PostgreSQL driver), Zod, ioredis, BullMQ-class repeating jobs, Next.js (storefront), React + Vite (admin) — **no new runtime dependency**. (008-quote-requests)
- PostgreSQL via MikroORM. New migration `028_quote_requests_workflow.ts` (next available number after the existing `027_*` from feature 007) introduces: (008-quote-requests)
- TypeScript 5.x (strict) on Node.js LTS ≥ 22.17. + Fastify, MikroORM (PostgreSQL driver), Zod, ioredis, BullMQ-class jobs, Next.js (storefront), React + Vite (admin). One new dependency under consideration for Excel parsing — see `research.md` § R8. CSV is handled by Node-native streaming utilities, no extra dep. (010-inventory-module)
- PostgreSQL via MikroORM. New migration `030_inventory_workflow.ts` (next available after `029_quote_requests_workflow.ts`) introduces: (010-inventory-module)
- TypeScript 5.x (strict) on Node.js LTS ≥ 22.17. + Fastify, MikroORM (PostgreSQL driver), Zod, ioredis, BullMQ-class repeatable jobs, Next.js (storefront), React + Vite (admin) — **no new runtime dependency**. The rule builder is implemented in the admin app as plain React + the existing Admin UI Design System; the rule expression is persisted as JSONB on `price_lists.application_rule`. (011-price-lists)
- PostgreSQL via MikroORM. New migration `031_price_lists_engine.ts` (next available after `030_inventory_workflow.ts`) introduces: (011-price-lists)
- TypeScript 5.x (strict) on Node.js LTS ≥ 22.17 — same as the rest of the project. + Fastify, MikroORM (PostgreSQL driver), Zod (boundary validation), Meilisearch JS client, ioredis, BullMQ, Next.js (storefront), React + Vite (admin) — **no new runtime dependency**. (012-attributes)
- PostgreSQL — one MikroORM migration (`032_attribute_options_and_flags.ts`) introduces the new `attribute_options` table, adds four columns to `product_attributes`, extends the `value_type` enum with `'select'`, migrates the legacy `enum_values` JSONB into the new options table, and drops the legacy column. (012-attributes)
- TypeScript 5.x strict; Node.js LTS ≥ 22.17 per repo `README` and engines field in `backend/package.json`. + existing stack — Fastify, MikroORM, Zod, Vitest, ioredis, BullMQ-class queues — *plus* five new runtime dependencies justified below: (013-assets-library)
- PostgreSQL via MikroORM. New migration `033_assets_library_init.ts` (next available number; see `data-model.md` § "Migration ordering"): (013-assets-library)
- TypeScript 5.x strict; Node.js LTS ≥ 22.17 per repo `README` and engines field in `backend/package.json`. + existing stack — Fastify, MikroORM, Zod, Vitest, ioredis, BullMQ-class queues, Next.js (storefront), React + Vite (admin) — *plus* three new runtime dependencies on the **frontend side only**: (014-cms)
- PostgreSQL via MikroORM. New migration `035_cms_init.ts` (next available number after `034_assets_library_init.ts`) introduces: (014-cms)

- TypeScript 5.x (strict mode) on Node.js LTS (≥ 20.x) + MikroORM (PostgreSQL driver) for persistence; Zod for boundary validation; Next.js for the storefront; React for the admin panel; Meilisearch client; Redis client (cache + BullMQ-class queue). Backend HTTP layer intentionally minimal (a small, well-known Node/TypeScript HTTP router; choice deferred to Phase 0 research with a bias toward the smallest dependency footprint compatible with TDD, Zod, and modular routing). (001-b2b-platform-foundation)

## Project Structure

```text
src/
tests/
```

## Commands

npm test && npm run lint

## Code Style

TypeScript 5.x (strict mode) on Node.js LTS (≥ 20.x): Follow standard conventions

## Recent Changes
- 014-cms: Added TypeScript 5.x strict; Node.js LTS ≥ 22.17 per repo `README` and engines field in `backend/package.json`. + existing stack — Fastify, MikroORM, Zod, Vitest, ioredis, BullMQ-class queues, Next.js (storefront), React + Vite (admin) — *plus* three new runtime dependencies on the **frontend side only**:
- 013-assets-library: Added TypeScript 5.x strict; Node.js LTS ≥ 22.17 per repo `README` and engines field in `backend/package.json`. + existing stack — Fastify, MikroORM, Zod, Vitest, ioredis, BullMQ-class queues — *plus* five new runtime dependencies justified below:
- 012-attributes: Added TypeScript 5.x (strict) on Node.js LTS ≥ 22.17 — same as the rest of the project. + Fastify, MikroORM (PostgreSQL driver), Zod (boundary validation), Meilisearch JS client, ioredis, BullMQ, Next.js (storefront), React + Vite (admin) — **no new runtime dependency**.


<!-- MANUAL ADDITIONS START -->

Skip in commit messages trailer: "Co-Authored-By: ..." or any other LLM/AI Agent.

### New backend module — admin permissions (required)

Every new module with admin routes gated by `requireAdmin(...)` **must** register its permission codes so they appear on `/admin-roles` and pass CI inventory.

1. **`manifest.ts`** — `permissions: [{ code, label, module? }]` for every code this module owns.
2. **`registered-manifests.ts`** — register the manifest once.
3. **Routes** — `requireAdmin('…')` literals must match manifest `code` values exactly.
4. **i18n** — `adminRoles.permission.<code>` in `_i18n/i18n/en.json` and `pl.json`.
5. **AppShell** — `requiredPermission` on nav entries where applicable.
6. **CI** — `pnpm --filter backend exec vitest run test/contract/admin_users/permission-inventory.test.ts` before PR.

Do not duplicate shared codes from core `PERMISSION_CATALOGUE` (`packages/contracts/src/admin.ts`). Contract: `specs/026-admin-roles-permissions/contracts/module-manifest-permissions.md`.

<!-- MANUAL ADDITIONS END -->
