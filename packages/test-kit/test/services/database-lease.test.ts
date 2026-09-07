import { Client } from 'pg';
import { describe, expect, it } from 'vitest';

import {
  BASE_DATABASE_URL_ENV,
  TEMPLATE_DATABASE_ENV,
  assertTestDatabaseUrl,
  databaseNameOf,
  parseRunDatabaseName,
  parseTemplateDatabaseName,
  redisUrlNamesDatabase,
} from '@endora-commerce/test-kit/database';

import { FIXTURE_TABLE } from './fixture-platform.js';

/**
 * T022 — the per-invocation database lease works from outside `backend/`.
 *
 * The assertion is not "the mechanism is correct" — that is
 * `backend/test/unit/harness/run-isolation.test.ts`', over the same pure
 * functions, with no service at all. The assertion here is that **this run**
 * got a database of its own, from a caller that named nothing under `backend/`:
 * `test/services/global-setup.ts` supplied a migration identity and a schema
 * step and got back a DSN, exactly as a module package's own run will.
 *
 * Everything it reads is what the lease wrote into the environment, because
 * that inheritance is the mechanism: a vitest worker is a fork of the process
 * the lease ran in, and a test that spawns a CLI reads `DATABASE_URL` — never
 * `TEST_DATABASE_URL`, which names the base.
 */
describe('the per-invocation database lease', () => {
  it('gave this invocation a database of its own, cloned from a named template', () => {
    expect(process.env['TEST_KIT_LEASE_MODE']).toBe('per-invocation');

    const runUrl = process.env['DATABASE_URL'];
    expect(runUrl).toBeDefined();
    const baseUrl = process.env[BASE_DATABASE_URL_ENV];
    expect(baseUrl).toBeDefined();

    const base = databaseNameOf(baseUrl!);
    const run = databaseNameOf(runUrl!);
    // The run database is not the base: sharing one is what issue #189 was
    // about, and it is what `BACKEND_TEST_ISOLATION=shared` deliberately
    // restores.
    expect(run).not.toBe(base);
    // It is one this mechanism generated, and it satisfies the guard that
    // protects the dev database — a generated name never widens that judgement.
    expect(parseRunDatabaseName(run, base)).not.toBeNull();
    expect(() => assertTestDatabaseUrl(runUrl!, {})).not.toThrow();

    // The template is named rather than derived: another invocation may build
    // one of its own while this run is going, so "the template" is a fact about
    // the run.
    const template = process.env[TEMPLATE_DATABASE_ENV];
    expect(template).toBeDefined();
    expect(parseTemplateDatabaseName(template!, base)).not.toBeNull();
  });

  it('leased a Redis logical database of its own, outside index 0', () => {
    const redisUrl = process.env['REDIS_URL'];
    expect(redisUrl).toBeDefined();
    // Index 0 stays the shared one: it holds the leases, and it is what a
    // developer's `pnpm run dev` uses.
    expect(redisUrlNamesDatabase(redisUrl!)).toBe(true);
    expect(new URL(redisUrl!).pathname).not.toBe('/0');
  });

  it('applied the caller-supplied schema step, and nobody else’s', async () => {
    const client = new Client({ connectionString: process.env['DATABASE_URL'] });
    await client.connect();
    try {
      const { rows } = await client.query<{ table_name: string }>(
        `select table_name from information_schema.tables where table_schema = 'public'`,
      );
      const names = rows.map((row) => row.table_name).sort();
      // What the caller asked for is there, and beside it the one table the
      // lease itself needs: `mikro_orm_migrations` is how a template says what
      // it holds, which is what stops a run being cloned from another branch's
      // platform (issue #289).
      expect(names).toEqual(['mikro_orm_migrations', FIXTURE_TABLE].sort());
    } finally {
      await client.end();
    }
  });
});
