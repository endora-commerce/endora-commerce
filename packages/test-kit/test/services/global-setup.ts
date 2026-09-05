/**
 * The kit's own vitest `globalSetup` — and T022's proof.
 *
 * It is the mechanism's first outside caller: everything this file does with
 * the lease, a module package's own test run will do identically, because
 * neither of them can name `backend/`. What it supplies is exactly what R2.1
 * says only a caller can know — which migrations exist (here: one entity, so
 * the identity is a digest over that) and what "migrated" means for its schema
 * (here: `updateSchema`).
 *
 * `BACKEND_TEST_ISOLATION=shared` and `BACKEND_TEST_KEEP_DATABASE=1` reach it
 * unchanged, because the lease reads them from the same two constants the
 * naming rules do.
 */

import { createHash } from 'node:crypto';

import { assertTestDatabaseUrl, leaseRunDatabase } from '@endora-commerce/test-kit/database';

import { FIXTURE_MIGRATION, createFixtureSchema } from './fixture-platform.js';

const DEFAULT_TEST_DATABASE_URL = 'postgresql://b2b:b2b@localhost:5432/b2b_test';

/**
 * This fixture's migration set, in the shape the lease takes it.
 *
 * One "migration": the fixture schema. Its digest is over the table name, so a
 * fixture that grows a column gets its own template rather than inheriting a
 * stale one — the same property issue #289 gives the application's set, at the
 * only scale this fixture has.
 */
function fixtureIdentity(): Parameters<typeof leaseRunDatabase>[0]['identity'] {
  const migration = FIXTURE_MIGRATION;
  return {
    digest: createHash('sha256').update(migration).digest('hex').slice(0, 12),
    migrations: [migration],
    migrationFiles: 1,
    origins: [{ origin: 'test-kit-fixture', registered: 1, migrationFiles: 1 }],
  };
}

type Teardown = () => Promise<void>;

export default async function globalSetup(): Promise<Teardown> {
  const lease = await leaseRunDatabase({
    baseUrl: assertTestDatabaseUrl(
      process.env['TEST_DATABASE_URL']?.trim() || DEFAULT_TEST_DATABASE_URL,
    ),
    identity: fixtureIdentity(),
    migrateTemplate: createFixtureSchema,
  });
  // Read by `database-lease.test.ts`, which is the assertion that this file
  // did what it says: a worker inherits the parent's environment, and that
  // inheritance **is** the mechanism by which the run's own DSN reaches a test.
  process.env['TEST_KIT_LEASE_MODE'] = lease.mode;
  return lease.release;
}
