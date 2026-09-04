import type { KnownViolation } from './assertions';

/**
 * The accessibility violations this storefront is known to carry
 * (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-043;
 * `contracts/accessibility-floor.md` §5).
 *
 * **Two-way, and it arrives from a baseline sweep rather than empty.** Nobody
 * had run axe over this storefront before Phase 4, so an empty ledger asserted
 * on day one would have been a claim nobody measured. Every entry below was
 * produced by a real run against a booted, seeded platform, and the numbers in
 * `specs/098-storefront-ssr-seo-a11y-suite/tasks.md` T407 are what that run
 * found — not what the contract estimated.
 *
 * ## The key, and why it is the route pattern
 *
 * `(route pattern, axe rule id, target selector)`. The **pattern**, never the
 * URL: `/p/pump-01` is one product of a seeded catalogue and the violation is a
 * property of the product page, so keying on the URL would strand every entry
 * the first time the seed produced a different slug.
 *
 * ## Both directions fail
 *
 * A `serious` or `critical` violation this file does not name fails the run.
 * An entry that no longer describes a violation **on a page the run measured**
 * fails as stale — which is how a repair proves itself, and why `repairedBy`
 * names a change rather than an intention. An entry over a page the run could
 * not fetch is neither: it was not measured, and calling it stale would strand
 * it the first time an unrelated route broke.
 *
 * `moderate` and `minor` findings are reported on every run and do not fail
 * (FR-042); they are not ledgered, because a ledger of things that cannot fail
 * is a list nobody reads.
 */
export const KNOWN_ACCESSIBILITY_VIOLATIONS: readonly KnownViolation[] = [];
