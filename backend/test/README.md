# Backend tests

Principle III of the constitution mandates TDD for every backend module. This directory houses the cross-module test layout:

- `unit/<module>/…` — unit tests for domain logic (pure functions, aggregates, state machines).
- `contract/<module>/…` — contract tests that boot an in-process Fastify instance and assert the HTTP surface of a module matches its published contract in `specs/001-b2b-platform-foundation/contracts/<module>.contract.md`.
- `integration/<module>/…` — integration tests that run against a real PostgreSQL (no DB mocking) using the transaction-rollback fixture pattern.
- `helpers/…` — shared test helpers (`test-db.ts`, `test-server.ts`).

Tests are written **before** their corresponding implementation tasks and MUST fail for the right reason first. See tasks.md Phase 2 (T025–T026, T039–T040) for the test-infrastructure scaffolding.

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
