/**
 * Vitest globalSetup — runs once per test invocation (parent process), before
 * any worker fork. Responsibilities:
 *
 *   0. Take the declared generable secrets out of the machine's hands: pin the
 *      two the ciphers need, delete the rest. A run that declares
 *      `BACKEND_TEST_SERVICES=none` (issue #211) stops here, after pointing
 *      every service URL at an unreachable port.
 *   1. Give this invocation its **own** database and its own Redis logical
 *      database, so two concurrent `vitest run`s cannot corrupt each other
 *      (issue #189). The migrated template is built under an advisory lock and
 *      the run database is a clone of it — and *which* template is decided
 *      first, from a digest over this run's whole migration input, so two
 *      branches cannot be handed each other's platform (issue #289).
 *      When the complete suite runs more than one worker
 *      (`BACKEND_TEST_WORKERS`, see `test-workers.ts`), every worker after the
 *      first gets a further clone of the same template and a Redis index of
 *      its own, published in `BACKEND_TEST_WORKER_SERVICES`.
 *   2. Refuse to run if the resolved URL does not look like a test DB (must
 *      contain `_test` or `test_` in the database name). Override with
 *      ALLOW_NON_TEST_DATABASE_URL=1 if you really know what you're doing.
 *      Every generated name is put through the same judgement — isolation
 *      never widens it.
 *   3. Drop this invocation's database when the run ends, and sweep the
 *      databases of runs that crashed before they could, plus the templates of
 *      migration sets nobody runs any more.
 *
 * **Steps 1 to 3 are `@endora-commerce/test-kit/database`'s** since feature
 * 109's T022, and what is left here is what only this repository can answer:
 * which migrations exist (`templateIdentity`), what "migrated" means for its
 * schema (`applyMigrations`), and whether this run declared any services at
 * all. The mechanism did not change — the two documented overrides,
 * `BACKEND_TEST_ISOLATION=shared` and `BACKEND_TEST_KEEP_DATABASE=1`, behave
 * exactly as `test/README.md` describes them — it moved, so that a module
 * package's own server-bound test can lease a database without naming
 * `backend/`.
 *
 * Workers inherit env vars from the parent process, so the `DATABASE_URL` the
 * lease writes propagates to every test worker.
 *
 * Override the base test DB URL with TEST_DATABASE_URL (e.g. for CI with a
 * different host) — the template and the per-invocation database are named from
 * it. `BACKEND_TEST_ISOLATION=shared` restores the pre-#189 behaviour of every
 * invocation sharing one database; see `packages/test-kit/src/database/` for
 * what that used to cost.
 */

import {
  assertTestDatabaseUrl,
  cloneTemplateForCaller,
  dropRunDatabase,
  keepRunDatabase,
  leaseRedisDatabase,
  leaseRunDatabase,
  redisUrlNamesDatabase,
  runIdentity,
  type RedisLease,
  type RunDatabaseLease,
} from '@endora-commerce/test-kit/database';
import {
  declaredServices,
  SERVICES_DECLARATION_ENV,
  UNREACHABLE_SERVICE_URLS,
} from './declared-services.js';
import { applyGenerableSecretEnv } from './generable-secrets.js';
import {
  backendTestWorkers,
  TEST_WORKERS_ENV,
  WORKER_SERVICES_ENV,
  type WorkerServices,
} from './test-workers.js';

const DEFAULT_TEST_DATABASE_URL = 'postgresql://b2b:b2b@localhost:5432/b2b_test';

function resolveTestDatabaseUrl(): string {
  const url = process.env['TEST_DATABASE_URL']?.trim() || DEFAULT_TEST_DATABASE_URL;
  // The `_test` judgement is the kit's, from the same constant the generated
  // names are checked against — one spelling, so isolation cannot widen it.
  return assertTestDatabaseUrl(url);
}

async function applyMigrations(): Promise<void> {
  const { initOrm, closeOrm } = await import('../src/db/index.js');
  const { establishPlatformInvariants, establishTaxIdScope } = await import('./template-seed.js');
  const orm = await initOrm();
  try {
    const migrator = orm.getMigrator();
    const applied = await migrator.up();
    if (applied.length > 0) {
      process.stdout.write(`[test-setup] applied ${applied.length} migration(s)\n`);
    }
    await establishPlatformInvariants(orm);
    await establishTaxIdScope(orm);
  } finally {
    await closeOrm();
  }
}

/**
 * The migration class names this run applies, in the order it applies them.
 *
 * Read from `src/db/configured-migrations.ts`, the module the ORM config
 * assigns to `migrationsList` — so there is one ordering and not a copy of it
 * here, and reading it does not import the config, which would capture whatever
 * `DATABASE_URL` names at that moment for the life of the process.
 */
async function configuredMigrationNames(): Promise<readonly string[]> {
  return (await (await import('../src/db/configured-migrations.js')).configuredMigrations()).names;
}

/**
 * Every test file starts with the public product listing answered by Postgres.
 *
 * Unset, `CATALOG_SEARCH_BACKEND` sends a listing that carries a search phrase
 * to the search module — which is what a deployment wants and not what a suite
 * sharing one Meilisearch instance can stand on. Fixtures written through the
 * `EntityManager` reach no index, and an index another file left behind still
 * answers `ok`, with documents whose rows that file's teardown removed: a
 * `?q=` assertion would then pass or fail on which file ran before it. So the
 * files asserting on the index say so (`= 'meilisearch'`, or a `delete` for
 * the default, and each restores what it found), and every other file gets the
 * one backend its fixtures are actually in.
 *
 * Pinned unconditionally, like the secrets below, so a developer's shell
 * cannot supply a different answer than a job's.
 */
function pinListingBackend(): void {
  process.env['CATALOG_SEARCH_BACKEND'] = 'postgres';
}

/**
 * The env every backend test run gets, database or not.
 *
 * The **whole declared population** of generable secrets, not the two this
 * function used to name. `secret && generable` is a fact the platform and every
 * module manifest declare; `@endora-commerce/cli` already derives it to write a
 * scaffolded instance's `.env`; a third statement kept in step by hand was
 * D-100's shape and was already three entries short of five, one of which
 * (`NEWSLETTER_TOKEN_SECRET`) was found by a boot instead. Two members are
 * pinned to deterministic values — *unconditionally*, so the developer's shell
 * cannot supply them either — and the rest are **deleted**, so the run meets
 * the state a fresh clone and every job meets. `generable-secrets.ts` carries
 * the dispositions and why each exception is one.
 *
 * Applied before the run branches, because they are not database state: a fast
 * unit run that constructs `HmacSigner.fromEnv()` must see the same key the
 * complete run does, and neither may see the machine's.
 */
async function applyDeterministicTestEnv(): Promise<void> {
  pinListingBackend();
  const applied = await applyGenerableSecretEnv();
  process.stdout.write(
    `[test-setup] generable secrets: pinned=${applied.pinned.length} ` +
      `withheld=${applied.withheld.length} (${applied.withheld.join(', ')})\n`,
  );
}

/** Vitest calls what a globalSetup returns once the whole invocation is over. */
type Teardown = () => Promise<void>;

const DEFAULT_REDIS_URL = 'redis://localhost:6379';

/**
 * One database and one Redis logical database for every worker after the
 * first, so the complete suite's files can run side by side (see
 * `test/test-workers.ts`).
 *
 * Worker 1 keeps the run's own lease — the #189 database and Redis index,
 * untouched — so a one-worker run is exactly what it was. Each further worker
 * gets a clone of the **same** migrated template the run was cloned from,
 * through the kit's `cloneTemplateForCaller`, and a Redis index leased the way
 * the run's own was. A clone is a file copy of an already-migrated template;
 * migrating each worker's database instead would repeat the whole migration
 * chain per worker for nothing.
 *
 * The clones carry the run-database name shape, so a run that crashes before
 * its teardown leaves nothing the next invocation's sweep does not already
 * collect, and the Redis leases expire on their own TTL.
 */
async function provisionWorkers(
  lease: RunDatabaseLease,
  baseUrl: string,
  redisBaseUrl: string,
  workers: number,
): Promise<Teardown> {
  const template = lease.templateName;
  if (lease.mode !== 'per-invocation' || template === undefined) {
    throw new Error(
      `${TEST_WORKERS_ENV}=${workers} needs a database per worker, but this run shares one ` +
        `database (${lease.mode}). Use ${TEST_WORKERS_ENV}=1.`,
    );
  }
  if (lease.redisUrl === undefined || redisUrlNamesDatabase(redisBaseUrl)) {
    throw new Error(
      `${TEST_WORKERS_ENV}=${workers} needs a Redis logical database per worker, but REDIS_URL ` +
        `(${redisBaseUrl}) already names one, so every worker would share it and consume the ` +
        `others' BullMQ jobs. Drop the index from REDIS_URL or use ${TEST_WORKERS_ENV}=1.`,
    );
  }

  const startedAt = Date.now();
  const clones: string[] = [];
  const redisLeases: RedisLease[] = [];
  const services: WorkerServices[] = [{ databaseUrl: lease.databaseUrl, redisUrl: lease.redisUrl }];

  const release: Teardown = async () => {
    for (const redisLease of redisLeases.splice(0)) {
      await redisLease.release().catch((error: unknown) => {
        process.stdout.write(
          `[test-setup] could not release Redis database ${redisLease.index}: ${String(error)}\n`,
        );
      });
    }
    const names = clones.splice(0);
    if (keepRunDatabase()) {
      if (names.length > 0) {
        process.stdout.write(`[test-setup] keeping worker databases ${names.join(', ')}\n`);
      }
      return;
    }
    for (const name of names) await dropRunDatabase(baseUrl, name);
  };

  try {
    const runId = runIdentity();
    for (let worker = 2; worker <= workers; worker += 1) {
      const clone = await cloneTemplateForCaller(baseUrl, template);
      clones.push(clone.name);
      const redisLease = await leaseRedisDatabase(redisBaseUrl, `${runId}:w${worker}`).catch(
        (error: unknown) => {
          throw new Error(
            `${(error as Error).message} This run asked for ${workers} workers, one Redis ` +
              `database each — ${TEST_WORKERS_ENV}=${worker - 1} would have fitted.`,
          );
        },
      );
      redisLeases.push(redisLease);
      services.push({ databaseUrl: clone.url, redisUrl: redisLease.url });
    }
  } catch (error) {
    await release();
    throw error;
  }

  process.env[WORKER_SERVICES_ENV] = JSON.stringify(services);
  process.stdout.write(
    `[test-setup] ${workers} workers: ${workers - 1} more database(s) cloned from ${template} ` +
      `and as many Redis databases leased in ${Date.now() - startedAt} ms\n`,
  );
  return release;
}

export default async function globalSetup(): Promise<Teardown | void> {
  await applyDeterministicTestEnv();
  // Only this setup may say which database a worker uses; a value inherited
  // from the shell would hand workers databases this run never provisioned.
  delete process.env[WORKER_SERVICES_ENV];

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

  // Issue #289 — which template this run's platform is, computed from the tree
  // before any database is touched: the ordered migration names plus the
  // content of every file that writes into a template. Two branches that differ
  // anywhere in that get two templates and cannot contaminate each other; two
  // that agree share one and pay one migration pass between them. It is this
  // repository's answer, which is why the kit takes it rather than deriving it.
  const { templateIdentity } = await import('./template-identity.js');

  // Read before the lease rewrites `REDIS_URL` to the run's own index: the
  // workers' indices are leased from the same server, by its base DSN.
  const redisBaseUrl = process.env['REDIS_URL'] ?? DEFAULT_REDIS_URL;
  const workers = backendTestWorkers();
  const baseUrl = resolveTestDatabaseUrl();

  const lease: RunDatabaseLease = await leaseRunDatabase({
    baseUrl,
    identity: await templateIdentity(),
    // `migrateTemplate` is a callback because the ORM config reads
    // DATABASE_URL at import: the template is migrated while that variable
    // names the template, and the run database takes over immediately after.
    migrateTemplate: applyMigrations,
    configuredMigrationNames,
  });

  if (workers <= 1) return lease.release;

  let releaseWorkers: Teardown;
  try {
    releaseWorkers = await provisionWorkers(lease, baseUrl, redisBaseUrl, workers);
  } catch (error) {
    await lease.release();
    throw error;
  }
  return async () => {
    try {
      await releaseWorkers();
    } finally {
      await lease.release();
    }
  };
}
