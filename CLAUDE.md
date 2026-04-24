# b2b-platform Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-04-23

## Active Technologies

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

- 001-b2b-platform-foundation: Added TypeScript 5.x (strict mode) on Node.js LTS (≥ 20.x) + MikroORM (PostgreSQL driver) for persistence; Zod for boundary validation; Next.js for the storefront; React for the admin panel; Meilisearch client; Redis client (cache + BullMQ-class queue). Backend HTTP layer intentionally minimal (a small, well-known Node/TypeScript HTTP router; choice deferred to Phase 0 research with a bias toward the smallest dependency footprint compatible with TDD, Zod, and modular routing).

<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
