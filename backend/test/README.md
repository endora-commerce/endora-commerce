# Backend tests

Principle III of the constitution mandates TDD for every backend module. This directory houses the cross-module test layout:

- `unit/<module>/…` — unit tests for domain logic (pure functions, aggregates, state machines).
- `contract/<module>/…` — contract tests that boot an in-process Fastify instance and assert the HTTP surface of a module matches its published contract in `specs/001-b2b-platform-foundation/contracts/<module>.contract.md`.
- `integration/<module>/…` — integration tests that run against a real PostgreSQL (no DB mocking) using the transaction-rollback fixture pattern.
- `helpers/…` — shared test helpers (`test-db.ts`, `test-server.ts`).

Tests are written **before** their corresponding implementation tasks and MUST fail for the right reason first. See tasks.md Phase 2 (T025–T026, T039–T040) for the test-infrastructure scaffolding.

## Test database

Tests run against a dedicated `b2b_test` database, not the dev `b2b`. The vitest globalSetup (`test/global-setup.ts`) forces `DATABASE_URL` to `postgresql://b2b:b2b@localhost:5432/b2b_test`, auto-creates the DB on first run, and applies migrations. Override with `TEST_DATABASE_URL=…` (must contain `_test` in the database name, or set `ALLOW_NON_TEST_DATABASE_URL=1`).

This isolation is what protects dev data — `helpers/test-server.ts` truncates tables on every test run, including `admin_users` and `admin_roles`.
