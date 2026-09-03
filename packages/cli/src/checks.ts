/**
 * `@endora-commerce/cli/checks` — the estate manifest and the run report, as a
 * subpath a stranger can import.
 *
 * It is a subpath of its own because **a stranger's run cannot read a `vitest`
 * file** (`data-model.md` preamble). The estate, its verdicts and the shapes
 * `endora check` reports in are tooling contracts, not an HTTP API, so
 * `packages/contracts/` is not their home — this is the same placement
 * `module-roots` and `read-size` already have.
 *
 * This repository's own reconciliation
 * (`backend/test/unit/scripts/check-inventory.test.ts`) imports it here too, and
 * that is the point: one manifest, read by the tool and by the test that holds
 * the tool to the inventory.
 */
export * from './check/index.js';
