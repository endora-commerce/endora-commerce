/**
 * Re-export shim — this file's sources now live in `@endora-commerce/platform`
 * (feature 113 Phase 0, spec §7).
 *
 * `SEED_SCOPE_REASON` moved to `packages/platform/src/demo/scope.ts` with the
 * guard, and for the same reason: the demo runner establishes the system scope
 * **once** for the whole run (§3.4), so the sentence an escape-hatch record
 * carries is the platform's rather than one host script's. The constant kept
 * here is `seed:dev`'s own, verbatim, because that script still runs throughout
 * Phase 0 (FR-013 — the replacement exists before the removal); the demo
 * command's two reasons are beside it in the package.
 *
 * It is the bridge, not the destination: it is deleted with `seed:dev` in
 * Phase 1.
 */
export * from '../../../packages/platform/dist/demo/scope.js';
