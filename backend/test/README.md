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

Tests run against a dedicated test database, never the dev `b2b`. The vitest globalSetup
(`test/global-setup.ts`) resolves the base DSN from `TEST_DATABASE_URL`
(default `postgresql://b2b:b2b@localhost:5432/b2b_test`) and refuses a database whose name does
not carry `test` — override with `ALLOW_NON_TEST_DATABASE_URL=1` if you really know what you
are doing.

This isolation is what protects dev data — `helpers/test-server.ts` truncates tables on every
test run, including `admin_users` and `admin_roles`.

### One database per invocation, not per developer (issue #189)

Two `vitest run`s against one database corrupt each other, and the corruption does not look
like one: `setupBackendServer` truncates `SEEDED_TABLES`, composes a server and seeds fixtures
on every booting file, so the second invocation's truncate lands in the middle of the first
one's setup. That produced `Hook timed out in 30000ms` in `beforeAll`, `Cannot read properties
of undefined (reading 'app')` in a teardown that never got a handle, and a role created through
the API reading back `null` — three signatures that are indistinguishable from real failures.

So an invocation gets resources of its own, with nothing to remember:

| Resource | What the run gets | Cleanup |
| --- | --- | --- |
| PostgreSQL | `<base>_r_<stamp>_<rand>`, cloned from the migrated template of this run's migration set, `<base>_tpl_<digest>` | dropped by the run's teardown; a crashed run's database is swept by a later invocation once it is 4 h old and unconnected |
| Redis | a logical database index, leased in index 0 and emptied before the run | released by the teardown; the lease expires 5 minutes after a crashed run stops refreshing it |

Index 0 is never leased and never emptied: it holds the leases themselves, and it is the one
`pnpm run dev` uses (`backend/.env` ships `redis://localhost:6379`). Before this, every
`setupBackendServer` ran its stale-cache drop against index 0 — `session:*`,
`sales-channels:*`, `settings:v1:*` — so a test run logged the developer's own dev session
out, roughly 225 times per suite.

A **template** is the only kind of database migrations are applied to, under an advisory lock
so concurrent invocations cannot race on it; a run database is a `create database … template …`
file copy (0.2 s warm). Nothing runs tests against a template, which is what keeps it idle
enough to be cloned.

**A template is named after the migration set it holds, not after the base database** (issue
#289): `<base>_tpl_<digest>`, the digest being 12 hex characters over this run's *whole*
migration input — the ordered class names, so a manifest `dependencies` edit that reorders
them counts, plus the SHA-256 of every migration source file and of the declared files that
seed a template (`test/template-identity.ts` holds the list). Two trees that agree on all of
it share one template and pay one migration pass between them; two that disagree anywhere
cannot collide, because they are not looking at the same database at all.

**That population is floored per producer, never in total.** The walk that hashes the sources
and the registry that lists the migrations are independent derivations of one population, so
they are reconciled before a digest is computed — per **origin** (`core` today; an extension
package may ship migrations of its own, D-106.2, and until the mechanism that discovers them
lands there is no root for that origin to be read from). One comparison against one total was
not that reconciliation: the tree carries a file of slack — §4 of the naming convention allows
a non-migration helper beside migrations and there is one,
`quote_requests/migrations/status-mapping.ts` — so 159 files answered for 158 registered
migrations, and a producer whose file the walk could not reach was paid for out of that
surplus. One registered migration outside the digest, two platforms, one template: #289 again,
one layer out. Each origin now clears its own floor or the run stops, naming the origin and
the shortfall. A helper settles no floor, because §1's recognizer — the same one the composer
uses — says it is not a migration, and it is hashed all the same, because a migration may
import it.

That is not a refinement of the old check, it is the defect it could not see. Until #289 there
was one `<base>_tpl` for the machine, and provisioning compared the *names* of the migrations
applied to it against the order this run configures. Names catch a branch that **added** a
migration. They cannot catch a branch that changed what a migration of the same name **does**,
which is what an agent iterating on an unmerged data migration produces every morning — and
so a run whose tree contained no such string failed against a `payment_methods` row called
`paypal_checkout`, seeded into the shared template from a branch it had never seen. The same
sharing, taken the other way round, silently swallowed the *edited* migration: the name was
already applied, so `migrator.up()` had nothing to do and the branch tested against the other
one's platform. Re-running rebuilt the template and both went green, which is exactly what
makes this expensive — a failure nobody can reproduce is dismissed as flakiness, and then a
real one is too.

**A template is cloned only when it can account for itself.** Provisioning reads two
independent claims before it clones: the provenance comment PostgreSQL keeps on the database
(`b2b-test-template v1 digest=… migrations=… lastUsedAt=…`, written after the build is
verified and rewritten on every use — a clone does not inherit it, which is right, because
the provenance is the template's) and the migration names actually in `mikro_orm_migrations`.
Either disagreeing, or saying nothing at all, drops the template and builds it from empty.
"A template whose contents nothing accounts for" is the defect itself, so it is never cloned,
whatever its name says.

Cost, measured on one file (`test/integration/payment_methods/failure-status-default.test.ts`,
157 migrations, this machine):

| | before | after |
| --- | --- | --- |
| cold — no template on the cluster | 13.2 s | 12.7 s |
| warm — template already built | 8.6 s / 8.7 s | 8.3 s / 8.1 s |
| two branches alternating, first run of each | 8.6 s – 9.6 s, **contaminated** | 13.0 s then 8.6 s |
| two branches alternating, thereafter | 8.6 s – 9.2 s, **contaminated** | 8.2 s / 8.3 s |

So the common case is unchanged (the warm path no longer imports the ORM config or runs
`migrator.up()` at all, which is where the tenth of a second comes from), and a migration set
the machine has not seen before pays one migration pass — 4.4 s here — once, instead of
never and wrongly.

`test/integration/catalog/attributes-migration-parity.test.ts` is why an approximate answer
was never good enough: it drives the real migrator, umzug reverts the last migration in
**configured** order while the test reads the last one in **applied** (`id`) order, and the
two stop agreeing the moment the template stops being this tree's. It walked `down()` straight
past its own target, never reached its termination condition, timed out twice, and left the
run database with most of its schema reverted — taking all 21 files of
`test/integration/catalog` down with it, 20 of them on a truncate against tables that were no
longer there. A file like that clones the template **by name**
(`BACKEND_TEST_TEMPLATE`, exported by the global setup), not by re-deriving it: by the time it
asks, another invocation may have built one of its own.

**Templates are collected.** One per migration set means one left behind every time a branch
gains a migration or is rebased, so provisioning sweeps, under the same lock: a template of
this base that nothing is connected to and that no invocation has used for 24 h — or that
cannot say when it was last used — is dropped, at most 25 per invocation. The pre-#289
`b2b_test_tpl` is deliberately **not** in that population: an invocation running older code
still clones it mid-run. Drop it by hand once, and any template you stop trusting with it:

```bash
psql -h localhost -U b2b -d postgres -c 'drop database if exists b2b_test_tpl with (force)'
psql -h localhost -U b2b -d postgres \
  -c "select datname, pg_size_pretty(pg_database_size(datname)), shobj_description(oid, 'pg_database')
      from pg_database where datname like 'b2b\_test\_tpl%'"
```

Under `BACKEND_TEST_ISOLATION=shared` there is no template at all: the run migrates the base
database, drift from another branch accumulates in it, and the run says so and does nothing
else — that database is one you named or kept, so it is not the harness's to drop. Drop it
yourself and re-run, or drop the escape hatch.

### A test that drives the migrator takes a database of its own

Every other integration test mutates *rows*, inside a transaction the fixture rolls back or a
truncate the next file repeats. A test that calls `orm.getMigrator().up()` or `.down()` mutates
the **schema**, outside either — and the run database is this invocation's only copy, so a
migration sequence that dies half-way does not fail alone. Measured on the failure above:
`test/integration/catalog` was **21 files red**, and 20 of 20 green with the one migrator-driving
file excluded. Twenty messages about `relation "sales_channels" does not exist` and a failed
harness truncate, each pointing at itself, for a cause in the file nobody reads last.

So such a file calls `setupMigratorTestDb()` instead of `setupTestDb()`. It clones the same
migrated template this invocation was cloned from — a file copy — and drops it in teardown, so
however badly the migration sequence goes, it goes there. It also owes its neighbours nothing:
no `migrator.up()` in `afterAll` to leave the schema behind for them, which is the hook that was
doing the damage. Re-measured with that file deliberately broken mid-migration: **1 red, 20
green**.

Who may call it is declared in `test/migrator-driving-tests.ts`, one entry per file with its
reason, and `test/unit/harness/migrator-driving-ledger.test.ts` keeps it honest in both
directions and checks that every entry is actually using the seam. Under
`BACKEND_TEST_ISOLATION=shared` there is no template to clone, so the seam falls back to the
shared database and prints why — that is part of what the escape hatch costs.

Two escape hatches, both explicit:

- `BACKEND_TEST_ISOLATION=shared` — the pre-#189 behaviour, every invocation on the base
  database. Useful when you want to inspect afterwards a database whose name you already know.
- `BACKEND_TEST_KEEP_DATABASE=1` — keep this run's database for a post-mortem. The run prints
  its name.

`test:unit:fast` is unaffected: it declares `BACKEND_TEST_SERVICES=none` and the setup returns
before it provisions anything.

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
