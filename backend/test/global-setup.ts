/**
 * Vitest globalSetup — runs once per test invocation (parent process), before
 * any worker fork. Responsibilities:
 *
 *   0. Apply the deterministic cipher keys every run needs, database or not.
 *      A run that declares `BACKEND_TEST_SERVICES=none` (issue #211) stops
 *      here, after pointing every service URL at an unreachable port.
 *   1. Give this invocation its **own** database and its own Redis logical
 *      database, so two concurrent `vitest run`s cannot corrupt each other
 *      (issue #189). The migrated template is created and brought up to date
 *      under an advisory lock; the run database is a clone of it.
 *   2. Refuse to run if the resolved URL does not look like a test DB (must
 *      contain `_test` or `test_` in the database name). Override with
 *      ALLOW_NON_TEST_DATABASE_URL=1 if you really know what you're doing.
 *      Every generated name is put through the same judgement — isolation
 *      never widens it.
 *   3. Drop this invocation's database when the run ends, and sweep the
 *      databases of runs that crashed before they could.
 *
 * Workers inherit env vars from the parent process, so setting
 * `process.env.DATABASE_URL` here propagates to every test worker.
 *
 * Override the base test DB URL with TEST_DATABASE_URL (e.g. for CI with a
 * different host) — the template and the per-invocation database are derived
 * from it. `BACKEND_TEST_ISOLATION=shared` restores the pre-#189 behaviour of
 * every invocation sharing one database; see `test/run-isolation.ts` for what
 * that used to cost.
 */

import { Client } from 'pg';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import {
  declaredServices,
  SERVICES_DECLARATION_ENV,
  UNREACHABLE_SERVICE_URLS,
} from './declared-services.js';
import {
  BASE_DATABASE_URL_ENV,
  ISOLATION_ENV,
  KEEP_DATABASE_ENV,
  TEST_DATABASE_NAME_PATTERN,
  databaseNameOf,
  keepRunDatabase,
  redisUrlNamesDatabase,
  runIdentity,
  sharedDatabaseReason,
  templateDrift,
} from './run-isolation.js';
import {
  appliedMigrations,
  dropRunDatabase,
  leaseRedisDatabase,
  provisionRunDatabase,
  sweepStrandedRunDatabases,
  type RedisLease,
} from './run-isolation-provision.js';

const DEFAULT_TEST_DATABASE_URL = 'postgresql://b2b:b2b@localhost:5432/b2b_test';
const DEFAULT_REDIS_URL = 'redis://localhost:6379';

function resolveTestDatabaseUrl(): string {
  const url = process.env['TEST_DATABASE_URL']?.trim() || DEFAULT_TEST_DATABASE_URL;
  const dbName = new URL(url).pathname.replace(/^\//, '');
  const looksLikeTest = TEST_DATABASE_NAME_PATTERN.test(dbName);
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
 * The migration class names this run applies, in the order it applies them.
 *
 * Read from the ORM config rather than recomputed, so there is one ordering and
 * not a copy of it here: `src/db/migration-order.ts` derives it from the
 * manifest dependency graph, and it moves whenever a manifest does.
 */
async function configuredMigrationNames(): Promise<string[]> {
  const { default: config } = await import('../src/db/mikro-orm.config.js');
  return (config.migrations?.migrationsList ?? []).map((entry) => entry.name);
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
  const { DefaultChannelReconciler } =
    await import('../src/kernel/sales-channels/default-channel-reconciler.js');
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
    process.env['MFA_SECRET_ENCRYPTION_KEY'] = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
  }
}

/** Vitest calls what a globalSetup returns once the whole invocation is over. */
type Teardown = () => Promise<void>;

export default async function globalSetup(): Promise<Teardown | void> {
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

  const baseUrl = resolveTestDatabaseUrl();

  // The pre-#189 behaviour, on either of two grounds. The first is an explicit
  // opt-out, worth having for a post-mortem — the run database is dropped when
  // the run ends, and sometimes what you want is the database a failing run
  // left behind, under a name you already know. The second is
  // ALLOW_NON_TEST_DATABASE_URL: that override is somebody deliberately
  // pointing the suite at a database whose name breaks the convention, and a
  // name derived from it would break it too. Isolation refuses to widen the
  // judgement, so it stands down instead of throwing at a person who already
  // said they know what they are doing.
  const shared = sharedDatabaseReason(process.env, databaseNameOf(baseUrl));
  if (shared !== undefined) {
    process.env['DATABASE_URL'] = baseUrl;
    await ensureDatabaseExists(baseUrl);
    await applyMigrations();
    process.stdout.write(
      `[test-setup] ${shared === 'explicit' ? `${ISOLATION_ENV}=shared` : 'ALLOW_NON_TEST_DATABASE_URL'}` +
        ` — this invocation shares ${databaseNameOf(baseUrl)} with every other one.\n`,
    );
    // The shared database accumulates the same way the template does — a
    // migration from another branch, or one of ours appended where the order
    // does not put it — and a test that drives the migrator reads that as a
    // failure of the code under test. This path only *says* so: on this branch
    // the database is the operator's, named by them or kept by them for a
    // post-mortem, so it is not this harness's to drop. The isolated path,
    // whose template is a name this module generates, rebuilds instead.
    const drift = templateDrift(
      await appliedMigrations(baseUrl),
      await configuredMigrationNames(),
      databaseNameOf(baseUrl),
    );
    if (drift) {
      process.stdout.write(
        `[test-setup] WARNING: ${drift.message.replace(' Rebuilding it from empty.', '')} ` +
          `Nothing here rebuilds it, because you named it. A test that drives the migrator ` +
          `will fail against it for that reason and not for its own — drop it and re-run, ` +
          `or drop ${ISOLATION_ENV}=shared and let the isolated path rebuild its template.\n`,
      );
    }
    return;
  }

  // Issue #189 — this invocation's own database, cloned from the migrated
  // template. `migrateTemplate` is passed in rather than done here because the
  // ORM config reads DATABASE_URL at import: the template is migrated while
  // that variable names the template, and the run database takes over
  // immediately after.
  const run = await provisionRunDatabase({
    baseUrl,
    configuredMigrations: async (templateUrl) => {
      // Before the first import of the ORM config, which captures this
      // variable and never reads it again — see `ProvisionInput`.
      process.env['DATABASE_URL'] = templateUrl;
      return configuredMigrationNames();
    },
    migrateTemplate: async (templateUrl) => {
      process.env['DATABASE_URL'] = templateUrl;
      await applyMigrations();
    },
  });
  process.env['DATABASE_URL'] = run.url;
  // A file that drives the real migrator may not do it to the database its
  // neighbours share — the run database is this invocation's only copy, so a
  // migration sequence that dies half-way takes the whole invocation with it.
  // Exporting the base is what lets `setupMigratorTestDb` clone the same
  // template this run was cloned from; see `test/migrator-driving-tests.ts`.
  process.env[BASE_DATABASE_URL_ENV] = baseUrl;

  // The same defect on the other service: the 20-file batch that "passed alone"
  // would still have collided on Redis keys. An explicit index in REDIS_URL is
  // somebody's deliberate choice and is left alone.
  const redisBaseUrl = process.env['REDIS_URL'] ?? DEFAULT_REDIS_URL;
  let lease: RedisLease | undefined;
  if (redisUrlNamesDatabase(redisBaseUrl)) {
    process.stdout.write(
      `[test-setup] REDIS_URL already names a logical database — leaving it alone.\n`,
    );
  } else {
    lease = await leaseRedisDatabase(redisBaseUrl, runIdentity());
    process.env['REDIS_URL'] = lease.url;
  }

  // Runs that crashed before their teardown. Best-effort, capped, and only ever
  // over names this harness generated.
  await sweepStrandedRunDatabases(baseUrl, run.name);

  return async () => {
    await lease?.release();
    if (keepRunDatabase()) {
      process.stdout.write(
        `[test-setup] ${KEEP_DATABASE_ENV} is set — keeping ${run.name}. ` +
          `Drop it yourself, or leave it for the sweep in ~4 h.\n`,
      );
      return;
    }
    await dropRunDatabase(baseUrl, run.name);
  };
}
