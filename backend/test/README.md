# Backend tests

Principle III of the constitution mandates TDD for every backend module. This directory houses the cross-module test layout:

- `unit/<module>/…` — unit tests for domain logic (pure functions, aggregates, state machines).
- `contract/<module>/…` — contract tests that boot an in-process Fastify instance and assert the HTTP surface of a module matches its published contract in `specs/001-b2b-platform-foundation/contracts/<module>.contract.md`.
- `integration/<module>/…` — integration tests that run against a real PostgreSQL (no DB mocking) using the transaction-rollback fixture pattern.
- `helpers/…` — shared test helpers (`test-db.ts`, `test-server.ts`).

Tests are written **before** their corresponding implementation tasks and MUST fail for the right reason first. See tasks.md Phase 2 (T025–T026, T039–T040) for the test-infrastructure scaffolding.
