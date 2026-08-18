# Backend tests

Principle III of the constitution mandates TDD for every backend module. This directory houses the cross-module test layout:

- `unit/<module>/…` — unit tests for domain logic (pure functions, aggregates, state machines).
- `contract/<module>/…` — contract tests that boot an in-process Fastify instance and assert the HTTP surface of a module matches its published contract in `specs/001-b2b-platform-foundation/contracts/<module>.contract.md`.
- `integration/<module>/…` — integration tests that run against a real PostgreSQL (no DB mocking) using the transaction-rollback fixture pattern.
- `helpers/…` — shared test helpers (`test-db.ts`, `test-server.ts`).

Tests are written **before** their corresponding implementation tasks and MUST fail for the right reason first. See tasks.md Phase 2 (T025–T026, T039–T040) for the test-infrastructure scaffolding.

## What the harness guarantees, and why it asserts it

A test is entitled to assume the platform state a real deployment has before it
serves anything. Two of those assumptions were unfounded until issues #158 and
#159, and both failed the same way: the harness substituted for the thing under
test, so the test measured the substitute.

- **A default Sales Channel always exists** (D-47…D-51). `setupBackendServer`
  re-creates it after its truncate; `test/global-setup.ts` establishes it right
  after the migrations, so a file that boots no server has one too. Read it as
  `db.systemDefaultChannelId` — a plain `string`, never `''`. `setupTestDb`
  throws when it is absent rather than handing back a placeholder, and
  `pnpm --filter backend run check:fixture-substitution` refuses the placeholder
  in a test file.
- **Every module's translation bundles are installed.** The harness contributes
  the resolved manifest registry to `lifecycleManifestRegistry`, so `_i18n`
  reconciles `translation_bundles` from disk at plugin attach exactly as
  production does. Before that, the table was empty in every test and the error
  envelope's translation path never ran once — which is how an envelope that
  replaced a written refusal with a generic family sentence shipped on four
  transacting surfaces with a green suite (issue #65).

Each is **asserted**, not assumed: `setupBackendServer` refuses to return a
handle whose error messages cannot be translated, and `setupTestDb` refuses to
return a `TestDb` without the channel. That is the `withModuleOff` move — a
helper proves the state it promises before the test body observes anything —
and it is what stops the vacuous form from being writable.

The bundle reconcile was measured before it was adopted, because
`setupBackendServer` is already ~88% of a booting test file (issue #72). Over
ten steady-state compositions each side, on an otherwise idle machine: **3184 ms
→ 3330 ms mean, 3206 ms → 3298 ms median — about +150 ms, ~4.6%.** The reconcile
alone is ~165 ms (42 modules, 84 bundle upserts), so nearly all of it is the
upserts and the number scales with the number of modules, not with the test. 604
files compose a server, so the whole-suite cost is roughly a minute and a half.
That is what the entire error-message surface being exercised for the first time
costs; an opt-in helper was the alternative, and at this price it is not worth
the second way of doing things.

## Releasing the harness

A file that calls `setupBackendServer` releases it with `teardownBackendServer(h)` — never by
closing the pieces itself. The harness owns five resources: the Fastify app, the shared
MikroORM singleton, an ioredis client, a **second** ioredis client for the module-state
pub/sub channel, and the awilix container holding every composed module's singletons. The seam
releases all five, in the order they have to be released in (unsubscribe before disconnect,
dispose the container before dropping the ORM).

A hand-written teardown is a copy of the seam frozen at the moment it was copied, so a
resource the harness grows later cannot reach it — which is how seventy-seven files came to
share three lines that released neither the container nor the subscriber. The suite is pinned
to a single fork, so one abandoned client per composed server accumulates for the whole run.
`pnpm --filter backend run check:harness-teardown` fails the build on a hand-release, against
an empty two-way ledger.

Cleanup SQL belongs **above** the call: teardown closes the ORM, so a connection taken after
it has no pool. A MikroORM instance a test opened itself (`MikroORM.init(mikroOrmConfig)`) is
the test's own and stays the test's own to close — the check reads only receivers it can bind
to a `BackendServerHandle`.

## Test database

Tests run against a dedicated `b2b_test` database, not the dev `b2b`. The vitest globalSetup (`test/global-setup.ts`) forces `DATABASE_URL` to `postgresql://b2b:b2b@localhost:5432/b2b_test`, auto-creates the DB on first run, and applies migrations. Override with `TEST_DATABASE_URL=…` (must contain `_test` in the database name, or set `ALLOW_NON_TEST_DATABASE_URL=1`).

This isolation is what protects dev data — `helpers/test-server.ts` truncates tables on every test run, including `admin_users` and `admin_roles`.

## The two ways to run this suite

`test/unit` is 315 files and 16 of them talk to a live Postgres or Redis, so the whole
directory used to be gated behind a globalSetup that creates and migrates a database
(issue #211). It no longer is:

| Command | Covers | Needs | Measured |
| --- | --- | --- | --- |
| `pnpm --filter backend run test:unit:fast` | `test/unit` minus those 16, plus the 24 unit tests co-located under `src/` | nothing | 324 files, 96 s, 1.5 GB peak |
| `pnpm --filter backend run test` | everything, the 16 included | Postgres + Redis + Meilisearch | `test/unit` alone: 316 files, 252 s |

The fast run uses `backend/vitest.unit.config.ts`, and choosing that config **is** the
declaration that the run has no services: it sets `BACKEND_TEST_SERVICES=none`,
`global-setup.ts` reads it and skips the database entirely, and every service URL is pointed
at an unreachable port so nothing can silently fall back to the dev database. The condition
is a declaration and never a probe — a setup that skipped itself because Postgres was
unreachable would hand back a suite that is green because it never ran. See
`test/declared-services.ts`.

The fast config differs from the complete one in exactly one setting: `singleFork` is off.
`singleFork` exists there because contract and integration files share one database and would
race on truncate+seed; nothing in the fast run has a database to race on, and one process is
not merely slower — 299 files in it reach the 4 GB V8 default and die around file 232 with
`Ineffective mark-compacts near heap limit`, which is the per-file retention `test:backend`
pays for with five shards and a heap cap. Four forks peak at 1.5 GB together.

The 16 exclusions are named individually, with a reason each, in
`test/service-dependent-unit-tests.ts`; they are unit-scope tests that use a real database
rather than a double because the thing under test is a query or a reconciler. They still run
in the complete suite, so this splits jobs, not coverage.
`test/unit/harness/service-dependent-ledger.test.ts` sweeps that list both ways: an
unlisted file that opens a connection fails, and so does a listed file that has stopped
needing one — the second is the direction nothing else would notice.

A service-dependent test that lands in the fast run does not pass quietly. Both harness
seams call `assertServicesAvailable` before they dial anything, so the run stops with a
sentence naming the ledger it is missing from.
