/**
 * Re-export shim — this file's sources now live in `@endora-commerce/platform`
 * (feature 113 Phase 0, spec §7; the mechanism is feature 080's platform
 * relocation, D-160/D-164/D-165).
 *
 * The guard moved to `packages/platform/src/demo/guard.ts` because
 * `mustBeNonProduction()` is the safety property that makes a demo seed
 * runnable at all, and under **D-207** a client's backend takes the platform
 * package and never receives `backend/src`. A client running a demo seed
 * against production is exactly what it prevents, so it has to ship — and there
 * must be **one copy** (§3.3), which is what this shim keeps true for the two
 * consumers that still name the old path: `src/seeds/dev-catalog-seed.ts` and
 * `backend/scripts/conformance/seed-storefront-fixtures.ts`.
 *
 * The forwarding target is the package's build output, which is what its
 * `exports` map serves, so a bare specifier and a relative one land on the same
 * file and therefore on the same module record. This file has **no published
 * subpath** — the demo layer is reached at
 * `@endora-commerce/platform/composition`, host surface no module may name — so
 * the shim names the built file directly, exactly as the other platform shims
 * do.
 *
 * It is the bridge, not the destination: it is deleted with `seed:dev` in
 * Phase 1, when the replacement command has taken over (FR-013).
 */
export * from '../../../packages/platform/dist/demo/guard.js';
