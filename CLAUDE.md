# b2b-platform Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-04-30

## Active Technologies
- TypeScript 5.x (strict mode) na Node.js LTS (≥ 22.17, jak w README po update foundation 001). + bez nowych runtime — wszystkie wymagane już są: (002-catalog-module)
- PostgreSQL — nowe tabele `attribute_sets`, `attribute_set_attributes` (bridge), `gallery_items`, `gallery_item_labels` (bridge etykiet), `product_attachments`, `attachment_types`, `product_links`, `grouped_items`, `bundle_slots`, `bundle_slot_options`. Migracje generowane standardową ścieżką MikroORM (`pnpm --filter backend run migration:generate`). Zmiany w `products`: dodanie kolumn `attributeSetId` (FK), `downloadAssetId` (FK nullable, virtual), `downloadUrl` (varchar nullable, virtual), rozszerzenie enuma `type`. Zmiana enuma `valueType` w `product_attributes` (dodanie `multiselect`, `price`) + nowa kolumna `displayAsSlider` (bool). (002-catalog-module)
- TypeScript 5.x strict; Node.js LTS ≥ 22.17 per repo `README` and engines field in `backend/package.json`. + Existing stack only — Fastify, MikroORM, Zod, Vitest, ioredis, BullMQ-class queues. **No new runtime dependency** is justified for this feature. (004-settings-module)
- PostgreSQL — five new tables introduced via a single MikroORM migration (`005_settings_init.ts`): (004-settings-module)

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
- 004-settings-module: Added TypeScript 5.x strict; Node.js LTS ≥ 22.17 per repo `README` and engines field in `backend/package.json`. + Existing stack only — Fastify, MikroORM, Zod, Vitest, ioredis, BullMQ-class queues. **No new runtime dependency** is justified for this feature.
- 002-catalog-module: Added TypeScript 5.x (strict mode) na Node.js LTS (≥ 22.17, jak w README po update foundation 001). + bez nowych runtime — wszystkie wymagane już są:

- 001-b2b-platform-foundation: Added TypeScript 5.x (strict mode) on Node.js LTS (≥ 20.x) + MikroORM (PostgreSQL driver) for persistence; Zod for boundary validation; Next.js for the storefront; React for the admin panel; Meilisearch client; Redis client (cache + BullMQ-class queue). Backend HTTP layer intentionally minimal (a small, well-known Node/TypeScript HTTP router; choice deferred to Phase 0 research with a bias toward the smallest dependency footprint compatible with TDD, Zod, and modular routing).

<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
