/**
 * Re-export shim — these sources live in `@endora-commerce/platform`
 * (feature 113 Phase 0; the mechanism is feature 080's platform relocation,
 * D-160/D-164/D-165).
 *
 * The demo layer is `packages/platform/src/demo/`: the production guard, the
 * scope reasons, the plan, the runner and the report. It is the platform's
 * because under **D-207** a client's backend takes the platform package and
 * never receives `backend/src`, and a demo an instance cannot run is the whole
 * problem this feature exists for (spec §7).
 *
 * **It is deliberately not on `@endora-commerce/platform/composition`.** That
 * subpath is D-160.14's ruled set of 27 symbols, pinned in both directions by
 * `test/unit/kernel/published-surface.test.ts` with the reason that *"the
 * subpath is not a place to park surface against a future need"* — and the demo
 * layer's only consumer today is `src/cli.ts`, one file in this repository.
 * Widening a ruling's table to save a shim would be a self-certified exemption
 * issued by the party being measured. So this is the ordinary host-internal
 * reach the other platform shims are, naming the built file directly, and
 * publishing it is a separate merge request with the argument written down —
 * the one that also has to decide where the host CLI itself lives for a client.
 */
export * from '../../../packages/platform/dist/demo/index.js';
