/**
 * Vitest globalSetup — runs once per test invocation (parent process), before
 * any worker fork. Responsibilities:
 *
 *   0. Apply the deterministic cipher keys every run needs, database or not.
 *      A run that declares `BACKEND_TEST_SERVICES=none` (issue #211) stops
 *      here, after pointing every service URL at an unreachable port.
 *   1. Force DATABASE_URL to a dedicated test database so `test-server.ts`
 *      cannot truncate the dev/prod DB by accident.
 *   2. Refuse to run if the resolved URL does not look like a test DB (must
 *      contain `_test` or `test_` in the database name). Override with
 *      ALLOW_NON_TEST_DATABASE_URL=1 if you really know what you're doing.
 *   3. Create the test DB on first run if it doesn't exist yet.
 *   4. Apply pending migrations so `truncate cascade` in test-server has
 *      a fully-migrated schema to truncate.
 *
 * Workers inherit env vars from the parent process, so setting
 * `process.env.DATABASE_URL` here propagates to every test worker.
 *
 * Override the test DB URL with TEST_DATABASE_URL (e.g. for CI with a
 * different host).
 */

import { Client } from 'pg';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import {
  declaredServices,
  SERVICES_DECLARATION_ENV,
  UNREACHABLE_SERVICE_URLS,
} from './declared-services.js';

const DEFAULT_TEST_DATABASE_URL = 'postgresql://b2b:b2b@localhost:5432/b2b_test';

function resolveTestDatabaseUrl(): string {
  const url = process.env['TEST_DATABASE_URL']?.trim() || DEFAULT_TEST_DATABASE_URL;
  const dbName = new URL(url).pathname.replace(/^\//, '');
  const looksLikeTest = /(^|_)test(_|$)/.test(dbName);
  if (!looksLikeTest && !process.env['ALLOW_NON_TEST_DATABASE_URL']) {
    throw new Error(
      `Refusing to run tests against database "${dbName}" — name must contain "_test" ` +
        `(e.g. b2b_test). Set ALLOW_NON_TEST_DATABASE_URL=1 to override. ` +
        `Resolved URL: ${url}`,
    );
  }
  return url;
}

async function ensureDatabaseExists(testUrl: string): Promise<void> {
  const parsed = new URL(testUrl);
  const dbName = parsed.pathname.replace(/^\//, '');
  const adminUrl = new URL(testUrl);
  adminUrl.pathname = '/postgres';

  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    const { rowCount } = await admin.query('select 1 from pg_database where datname = $1', [
      dbName,
    ]);
    if (rowCount === 0) {
      // pg_database name can't be parameterised in CREATE DATABASE; the safety
      // check above plus URL parsing keeps this from being injectable.
      const safeName = dbName.replace(/[^a-zA-Z0-9_]/g, '');
      if (safeName !== dbName) {
        throw new Error(`Unsafe DB name: "${dbName}"`);
      }
      await admin.query(`create database "${safeName}"`);
      process.stdout.write(`[test-setup] created database ${safeName}\n`);
    }
  } finally {
    await admin.end();
  }
}

async function applyMigrations(): Promise<void> {
  const { initOrm, closeOrm } = await import('../src/db/index.js');
  const orm = await initOrm();
  try {
    const migrator = orm.getMigrator();
    const applied = await migrator.up();
    if (applied.length > 0) {
      process.stdout.write(`[test-setup] applied ${applied.length} migration(s)\n`);
    }
    await establishPlatformInvariants(orm);
  } finally {
    await closeOrm();
  }
}

/**
 * The invariants a migrated platform has before it serves anything, established
 * here so a test file does not have to depend on another one having run first
 * (issue #159).
 *
 * There is exactly one so far: **a default Sales Channel always exists** (D-47…
 * D-51). Production gets it from the boot reconciler; `setupBackendServer` runs
 * the same reconciler after it truncates `sales_channels`. A file that boots no
 * server — `setupTestDb`, a `.bench.ts` — got it from whichever harness file the
 * runner happened to schedule before it, which is not a guarantee at all: six
 * files wrote `(await findOne(SalesChannel, { systemDefault: true }))?.id ?? ''`
 * and passed on a warm database, and
 * `test/integration/carts/cart-abandonment-worker.integration.test.ts` failed on
 * a fresh one with `invalid input syntax for type uuid: ""`.
 *
 * Migrations deliberately do not seed it — the channel is install-time state,
 * not schema — so the seam is here, immediately after `migrator.up()`, which is
 * the point at which this database becomes a platform every test may assume.
 *
 * `en-US` / `PLN` rather than the production `en` / `EUR` fallbacks, matching the
 * language and currency rows `setupBackendServer` seeds, so a fresh database and
 * a warm one describe the same channel.
 */
async function establishPlatformInvariants(orm: MikroORM): Promise<void> {
  const { DefaultChannelReconciler } = await import(
    '../src/kernel/sales-channels/default-channel-reconciler.js'
  );
  // `SalesChannel` is a `@GlobalEntity`, so a plain fork is the right EM here:
  // there is no tenant filter to stamp and no request scope to inherit.
  const result = await new DefaultChannelReconciler(
    () => orm.em.fork() as EntityManager,
    undefined,
    { bootstrapDefaults: { code: 'default', language: 'en-US', currency: 'PLN' } },
  ).run();
  if (result.action === 'inserted') {
    process.stdout.write('[test-setup] seeded the system-default sales channel\n');
  }
  if (result.systemDefault === undefined) {
    throw new Error(
      `[test-setup] the system-default sales channel could not be established ` +
        `(reconciler said "${result.action}"${result.warning ? `: ${result.warning}` : ''}). ` +
        `Every test may assume exactly one exists — refusing to start a run without it.`,
    );
  }
}

/**
 * The env every backend test run gets, database or not: deterministic keys for
 * the two ciphers that refuse to construct without one. They are not database
 * state, so they are applied before the run branches — a fast unit run that
 * constructs `HmacSigner.fromEnv()` must see the same key the complete run does.
 */
function applyDeterministicTestEnv(): void {
  // Feature 013 — the Assets Library's HMAC signer demands an env key. Tests
  // do not load backend/.env; supply a deterministic key so signing tests
  // stay reproducible and routes that touch the signer work.
  if (!process.env['ASSETS_LIBRARY_HMAC_KEY']) {
    process.env['ASSETS_LIBRARY_HMAC_KEY'] =
      '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
  }
  // Feature 042 — the MFA module's SecretCipher needs a base64 32-byte AES key
  // to encrypt TOTP secrets. Supply a deterministic test key so enrolment
  // routes work without loading backend/.env.
  if (!process.env['MFA_SECRET_ENCRYPTION_KEY']) {
    process.env['MFA_SECRET_ENCRYPTION_KEY'] =
      'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
  }
}

export default async function globalSetup(): Promise<void> {
  applyDeterministicTestEnv();

  // Issue #211 — the run may declare that it has no services, and then this
  // setup has no database to create or migrate. The declaration is read from
  // the environment (`vitest.unit.config.ts` sets it), never from a failed
  // connection: a globalSetup that skipped itself when Postgres was down would
  // hand back a suite that is green because it never ran. See
  // `declared-services.ts`.
  //
  // Skipping is not enough on its own. An unset DATABASE_URL falls back to the
  // *dev* database, so the run leaves here pointed at unreachable stand-ins
  // instead — and both harness seams refuse before they dial them.
  if (declaredServices() === 'none') {
    for (const [name, url] of Object.entries(UNREACHABLE_SERVICE_URLS)) {
      process.env[name] = url;
    }
    process.stdout.write(
      `[test-setup] ${SERVICES_DECLARATION_ENV}=none — no database created, no migrations ` +
        `applied, service URLs pointed at an unreachable port.\n`,
    );
    return;
  }

  const testUrl = resolveTestDatabaseUrl();
  process.env['DATABASE_URL'] = testUrl;
  await ensureDatabaseExists(testUrl);
  await applyMigrations();
}
