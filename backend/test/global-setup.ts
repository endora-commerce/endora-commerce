/**
 * Vitest globalSetup — runs once per test invocation (parent process), before
 * any worker fork. Responsibilities:
 *
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
  const { getMigrator } = await import('../src/db/migrator.js');
  const orm = await initOrm();
  try {
    // getMigrator runs the legacy-name pre-flight (feature 065) before pending
    // work is computed, so a test database migrated under the old naming
    // scheme is not asked to re-apply its 112 executed migrations.
    const migrator = await getMigrator(orm);
    const applied = await migrator.up();
    if (applied.length > 0) {
      process.stdout.write(`[test-setup] applied ${applied.length} migration(s)\n`);
    }
  } finally {
    await closeOrm();
  }
}

export default async function globalSetup(): Promise<void> {
  const testUrl = resolveTestDatabaseUrl();
  process.env['DATABASE_URL'] = testUrl;
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
  await ensureDatabaseExists(testUrl);
  await applyMigrations();
}
