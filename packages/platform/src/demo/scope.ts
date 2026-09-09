/**
 * The reasons a demo run's scope carries (feature 113 §3.4; issue #228, FR-020).
 *
 * ## Why a demo run needs a scope, and why the runner opens exactly one
 *
 * A demo run is a non-HTTP entry point: nothing above it establishes a
 * `TenantContext`, so any filtered query it makes reads the ambient store, finds
 * nothing and fails closed (`tenancy/filters.ts`). §3.4 puts that responsibility
 * on the **runner** and takes it off every module's body: a module's demo data
 * is not an entry point, so it neither opens a scope nor remembers to. That is
 * stricter than what it replaced — the developer seed script this feature
 * retired was a declared program in `check:entry-scope`'s population and had to
 * remember `enterSystemScope` itself.
 *
 * ## Why `system`, and why that changes nothing the run produces
 *
 * `enterSystemScope` is the entry for an execution with no caller to derive
 * tenancy from, and a demo run is the extreme case: it *creates* the demo
 * organisation, so when it starts there is no organisation to pin to. In
 * `system` mode both global filters contribute `{}` — every row a demo body
 * reads and writes with the scope, it would read and write without it. The scope
 * is not there to change the seeded database; it is there so that the day an
 * entity a demo body touches is reclassified `@OrgScoped`, the run fails with a
 * tenancy error instead of silently writing rows no request can ever read.
 *
 * Crossing every organisation is observable by construction: `enterSystemScope`
 * emits one escape-hatch record carrying the reason.
 *
 * ## Why these are constants and not a wrapper function
 *
 * The scope is entered at the entry point itself, wrapping the invocation, in
 * the idiom the other CLI entry points use. A tidier `runInSeedScope(main)`
 * helper was written first and reverted: `check-entry-scope` reads the **entry
 * file** for one of the two sanctioned entry functions, on the stated ground
 * that a scope buried in something the entry calls is a scope nobody can see is
 * there — and it cannot tell a one-caller helper from a shared service. Only the
 * reasons live here, because they are the sentences the escape-hatch record
 * carries and a test asserts what an operator would actually read.
 */

/** `endora demo seed` — every effectively present module's demo rows, plus the composition. */
export const DEMO_SEED_SCOPE_REASON =
  'cli: demo seed — creates every present module\'s demo rows and the instance composition';

/** `endora demo reset` — the withdrawal, in reverse. */
export const DEMO_RESET_SCOPE_REASON =
  'cli: demo reset — withdraws the instance composition and every present module\'s demo rows';
