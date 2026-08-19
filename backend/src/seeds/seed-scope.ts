/**
 * The reason the dev seed's scope carries (issue #228, FR-020).
 *
 * ## Why the seed needs a scope
 *
 * It is a non-HTTP entry point: `pnpm --filter backend run seed:dev` is a bare
 * `tsx` process whose `main()` runs at import. Nothing above it establishes a
 * `TenantContext`, so any filtered query it makes reads the ambient store, finds
 * nothing and fails closed (`tenancy/filters.ts`). That it worked anyway is
 * precisely the accident feature 072 set out to remove — an accident of which
 * entities the seed happens to touch, not a property of the code — and it
 * survived a year longer than every other entry point because
 * `check:entry-scope`'s population was defined by three *shapes* and the seed
 * has none of them: no `scripts/` directory, no `new Worker(...)`, no repeating
 * timer.
 *
 * ## Why `system`, and why that changes nothing the seed produces
 *
 * `enterSystemScope` is the entry for an execution with no caller to derive
 * tenancy from, and the seed is the extreme case: it *creates* the demo
 * organisation, so when it starts there is no organisation to pin to. In
 * `system` mode both global filters contribute `{}` — every row the seed read
 * and wrote before the scope existed, it reads and writes after. The scope is
 * not there to change the seeded database; it is there so that the day an
 * entity the seed touches is reclassified `@OrgScoped`, the seed fails with a
 * tenancy error instead of silently writing rows no request can ever read.
 *
 * Crossing every organisation is observable by construction: `enterSystemScope`
 * emits one escape-hatch record carrying this reason.
 *
 * ## Why this is a constant and not a wrapper function
 *
 * The scope is entered in `dev-catalog-seed.ts` itself, wrapping the top-level
 * invocation, in the idiom the other fifteen CLI entry points use. A tidier
 * `runInSeedScope(main)` helper was written first and reverted: `check-entry-scope`
 * reads the **entry file** for one of the two sanctioned entry functions, on the
 * stated ground that a scope buried in something the entry calls is a scope
 * nobody can see is there — and it cannot tell a one-caller helper from a shared
 * service. Only the reason lives here, because it is the sentence the escape-hatch
 * record carries and the test asserts what an operator would actually read.
 *
 * The constant lives beside `dev-seed-guard.ts` rather than in the seed for the
 * reason that file gives: `dev-catalog-seed.ts` runs at import, so a test
 * importing anything from it would run the seed it is testing.
 */

export const SEED_SCOPE_REASON =
  'cli: dev catalog seed — truncates and repopulates the demo catalog across every module';
