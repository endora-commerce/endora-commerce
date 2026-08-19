/**
 * The half of per-invocation isolation (issue #189) that talks to a server.
 *
 * Split from `run-isolation.ts` so the naming and selection rules — the two
 * things whose correctness protects the dev database and other people's
 * databases — are unit-testable with no service at all, and run in the fast
 * unit job. Nothing here is imported by a test file: `global-setup.ts` is the
 * only caller, and it calls it once per invocation in the parent process.
 *
 * `pg` and `ioredis` are imported dynamically for the same reason: a run that
 * declared `BACKEND_TEST_SERVICES=none` never reaches this module, and should
 * not pay to load a driver it will not dial.
 */

import type { Client } from 'pg';
import type { Redis } from 'ioredis';
import {
  SWEEP_LIMIT,
  STALE_RUN_DATABASE_MS,
  advisoryLockKey,
  databaseNameOf,
  redisUrlWithDatabase,
  runDatabaseName,
  strandedRunDatabases,
  templateDatabaseName,
  templateDrift,
  withDatabase,
} from './run-isolation.js';

export type Log = (message: string) => void;

const defaultLog: Log = (message) => process.stdout.write(`${message}\n`);

/** The maintenance database `create database` / `drop database` are issued from. */
function adminUrl(url: string): string {
  return withDatabase(url, 'postgres');
}

async function connectAdmin(url: string): Promise<Client> {
  const { Client: PgClient } = await import('pg');
  const client = new PgClient({ connectionString: adminUrl(url) });
  await client.connect();
  return client;
}

async function databaseExists(admin: Client, name: string): Promise<boolean> {
  const { rowCount } = await admin.query('select 1 from pg_database where datname = $1', [name]);
  return (rowCount ?? 0) > 0;
}

/**
 * `create database … template …` requires the source to be **idle** — a single
 * other session and PostgreSQL refuses with 55006. Our own invocations are
 * serialized by the advisory lock, so what this retries around is the tail of
 * another run's template connection closing, and a human's `psql` into the
 * template.
 */
const CLONE_ATTEMPTS = 60;
const CLONE_RETRY_MS = 500;

function isSourceInUse(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  const message = (error as { message?: string }).message ?? '';
  return code === '55006' || /is being accessed by other users/.test(message);
}

async function cloneFromTemplate(admin: Client, name: string, template: string): Promise<void> {
  for (let attempt = 1; attempt <= CLONE_ATTEMPTS; attempt += 1) {
    try {
      await admin.query(`create database "${name}" template "${template}"`);
      return;
    } catch (error) {
      if (!isSourceInUse(error) || attempt === CLONE_ATTEMPTS) {
        if (isSourceInUse(error)) {
          throw new Error(
            `could not clone the test template "${template}" after ` +
              `${(CLONE_ATTEMPTS * CLONE_RETRY_MS) / 1000}s: something is connected to it. ` +
              `Nothing runs tests against the template, so this is usually an open psql ` +
              `session. Close it, or run with BACKEND_TEST_ISOLATION=shared.`,
          );
        }
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, CLONE_RETRY_MS));
    }
  }
}

/**
 * The migration names applied to a database, in the order they were applied.
 *
 * `mikro_orm_migrations` is missing on a template that has just been created
 * and on one that has never been migrated; both mean "nothing applied", which
 * is a prefix of every order and so needs no rebuild.
 */
export async function appliedMigrations(databaseUrl: string): Promise<string[]> {
  const { Client: PgClient } = await import('pg');
  const client = new PgClient({ connectionString: databaseUrl });
  await client.connect();
  try {
    const { rows } = await client.query<{ name: string }>(
      'select name from mikro_orm_migrations order by id asc',
    );
    return rows.map((row) => row.name);
  } catch (error) {
    if ((error as { code?: string }).code === '42P01') return [];
    throw error;
  } finally {
    // Before the clone, not after: `create database … template …` refuses a
    // source anything is connected to.
    await client.end();
  }
}

export interface RunDatabase {
  /** The DSN every worker of this invocation will use. */
  readonly url: string;
  readonly name: string;
  readonly template: string;
}

export interface ProvisionInput {
  /** The DSN naming the base database, from TEST_DATABASE_URL or the default. */
  readonly baseUrl: string;
  /** Applies pending migrations to the template and establishes the platform invariants. */
  readonly migrateTemplate: (templateUrl: string) => Promise<void>;
  /**
   * The migration class names this run applies, in the order it applies them.
   * The template is rebuilt when what it holds is not a prefix of them — see
   * `templateDrift`.
   *
   * A callback taking the template's DSN, and not a value, for the same reason
   * `migrateTemplate` is one: **the ORM config captures `DATABASE_URL` at
   * import**, once per process, so whatever names that variable when the config
   * is first imported is the database this process migrates for the rest of its
   * life. Reading the configured order means importing the config, so it is
   * read here — after the template's DSN exists and can be pointed at — rather
   * than by a caller that has not got one yet. Taking a plain array made the
   * parent import the config while `DATABASE_URL` was unset, and its fallback
   * is the **dev** database; the migration ran there and only its
   * `allOrNothing` transaction kept that from mattering.
   */
  readonly configuredMigrations: (templateUrl: string) => Promise<readonly string[]>;
  readonly log?: Log;
}

/**
 * Give this invocation its own database.
 *
 * Everything between taking the advisory lock and releasing it is serialized
 * across invocations: ensure the template exists, migrate it, disconnect from
 * it, clone. Holding the lock across the clone as well is deliberate — the
 * clone is a fraction of a second, and it is what guarantees the template is
 * idle at the moment the next invocation's migration opens a connection to it.
 *
 * The lock is taken on the `postgres` maintenance database: PostgreSQL advisory
 * locks are scoped to a database, so every waiter has to agree on which, and it
 * must not be the template — a session holding the lock there is exactly the
 * session that would make the clone illegal.
 */
export async function provisionRunDatabase(input: ProvisionInput): Promise<RunDatabase> {
  const log = input.log ?? defaultLog;
  const base = databaseNameOf(input.baseUrl);
  const template = templateDatabaseName(base);
  const name = runDatabaseName(base);
  const lockKey = advisoryLockKey(template);

  const admin = await connectAdmin(input.baseUrl);
  try {
    await admin.query('select pg_advisory_lock($1)', [lockKey]);
    try {
      if (!(await databaseExists(admin, template))) {
        await admin.query(`create database "${template}"`);
        log(`[test-setup] created the migration template ${template}`);
      }
      const templateUrl = withDatabase(input.baseUrl, template);
      const expected = await input.configuredMigrations(templateUrl);

      // The template outlives every run and is shared by every branch on the
      // machine, and `migrator.up()` only ever appends. So before it is
      // brought forward, check that what it holds is an order this run's
      // migrations could have produced — and rebuild it from empty when it is
      // not. Dropping is ours to do: the name is one this module generates,
      // nothing runs tests against it, and rebuilding costs one migration pass.
      const drift = templateDrift(await appliedMigrations(templateUrl), expected, template);
      if (drift) {
        log(`[test-setup] ${drift.message}`);
        await admin.query(`drop database if exists "${template}" with (force)`);
        await admin.query(`create database "${template}"`);
      }

      await input.migrateTemplate(templateUrl);

      // A clone is only worth anything if the template is now exactly this
      // run's platform. After a rebuild-and-migrate it is, by construction —
      // so a finding here is a real defect and gets said out loud rather than
      // handed to every test file in the run as a database that is quietly not
      // what the code says it is. It is also what catches a `migrateTemplate`
      // that migrated *something else*, which is a live hazard while the ORM
      // config resolves its DSN from an ambient variable.
      const residual = templateDrift(await appliedMigrations(templateUrl), expected, template);
      if (residual) {
        throw new Error(
          `the migration template is still not this run's migration set after migrating it: ` +
            `${residual.message} Drop "${template}" by hand and report this — a run cloned ` +
            `from it would not be the platform this branch's code describes.`,
        );
      }

      await cloneFromTemplate(admin, name, template);
    } finally {
      await admin.query('select pg_advisory_unlock($1)', [lockKey]);
    }
  } finally {
    await admin.end();
  }

  log(`[test-setup] this invocation owns database ${name} (cloned from ${template})`);
  return { url: withDatabase(input.baseUrl, name), name, template };
}

export async function dropRunDatabase(
  baseUrl: string,
  name: string,
  log: Log = defaultLog,
): Promise<void> {
  const admin = await connectAdmin(baseUrl);
  try {
    // `with (force)` terminates whatever is still connected — a worker whose
    // pool has not finished closing is the ordinary case, and the alternative
    // is leaving the database behind for the sweep.
    await admin.query(`drop database if exists "${name}" with (force)`);
    log(`[test-setup] dropped ${name}`);
  } finally {
    await admin.end();
  }
}

/**
 * Drop the run databases of invocations that crashed before their teardown.
 *
 * Best-effort and never fatal: a sweep that fails is a disk-space problem, not
 * a reason to fail somebody's test run.
 */
export async function sweepStrandedRunDatabases(
  baseUrl: string,
  keep: string,
  log: Log = defaultLog,
): Promise<string[]> {
  const base = databaseNameOf(baseUrl);
  const dropped: string[] = [];
  let admin: Client | undefined;
  try {
    admin = await connectAdmin(baseUrl);
    const { rows } = await admin.query<{ datname: string }>('select datname from pg_database');
    const busy = await admin.query<{ datname: string }>(
      'select distinct datname from pg_stat_activity where datname is not null',
    );
    const stranded = strandedRunDatabases({
      base,
      names: rows.map((r) => r.datname),
      busy: new Set(busy.rows.map((r) => r.datname)),
      keep,
      now: new Date(),
      maxAgeMs: STALE_RUN_DATABASE_MS,
      limit: SWEEP_LIMIT,
    });
    for (const name of stranded) {
      try {
        await admin.query(`drop database if exists "${name}" with (force)`);
        dropped.push(name);
      } catch {
        // Somebody connected between the read and the drop, or it is already
        // gone. The next invocation sweeps again.
      }
    }
    if (dropped.length > 0) {
      log(`[test-setup] swept ${dropped.length} stranded run database(s) from crashed runs`);
    }
  } catch (error) {
    log(`[test-setup] could not sweep stranded run databases: ${(error as Error).message}`);
  } finally {
    await admin?.end();
  }
  return dropped;
}

/**
 * The Redis half.
 *
 * A logical database index, leased in index 0 so the lease itself is visible to
 * every invocation. The TTL is what makes a crashed run give its index back
 * without anybody sweeping: five minutes, refreshed once a minute for as long
 * as the vitest parent process lives.
 */
const LEASE_PREFIX = 'b2b:test-run-lease:';
const LEASE_TTL_MS = 5 * 60 * 1000;
const LEASE_REFRESH_MS = 60 * 1000;

export interface RedisLease {
  readonly url: string;
  readonly index: number;
  readonly runId: string;
  readonly release: () => Promise<void>;
}

async function connectRedis(url: string): Promise<Redis> {
  const { default: IORedis } = await import('ioredis');
  return new IORedis(url, { maxRetriesPerRequest: null, lazyConnect: false });
}

/** How many logical databases this server has. `databases` is 16 unless someone raised it. */
async function redisDatabaseCount(client: Redis): Promise<number> {
  try {
    const config = await client.config('GET', 'databases');
    const value = Array.isArray(config) ? Number.parseInt(String(config[1]), 10) : NaN;
    return Number.isFinite(value) && value > 1 ? value : 16;
  } catch {
    // A managed Redis may refuse CONFIG GET. 16 is the server default and the
    // only number this repository's compose file and CI service ever have.
    return 16;
  }
}

export async function leaseRedisDatabase(
  redisUrl: string,
  runId: string,
  log: Log = defaultLog,
): Promise<RedisLease> {
  const registry = await connectRedis(redisUrlWithDatabase(redisUrl, 0));
  const count = await redisDatabaseCount(registry);
  let index: number | undefined;
  // Index 0 stays the shared one: it holds the leases, and it is what a
  // developer's `pnpm run dev` uses.
  for (let candidate = 1; candidate < count; candidate += 1) {
    const taken = await registry.set(
      `${LEASE_PREFIX}${candidate}`,
      runId,
      'PX',
      LEASE_TTL_MS,
      'NX',
    );
    if (taken === 'OK') {
      index = candidate;
      break;
    }
  }
  if (index === undefined) {
    registry.disconnect();
    throw new Error(
      `every one of this Redis server's ${count - 1} lease-able logical databases is held by ` +
        `another test invocation. A lease expires ${LEASE_TTL_MS / 60000} minutes after the run ` +
        `holding it dies, so this is either that many live runs or a very recent pile of ` +
        `crashes. Wait, raise the server's \`databases\`, or run with ` +
        `BACKEND_TEST_ISOLATION=shared.`,
    );
  }

  const url = redisUrlWithDatabase(redisUrl, index);
  // Whatever a crashed run left in this index is not this run's state. The
  // lease makes the index exclusively ours, so this cannot reach anybody else.
  const owned = await connectRedis(url);
  await owned.flushdb();

  const refresh = setInterval(() => {
    void registry.set(`${LEASE_PREFIX}${index}`, runId, 'PX', LEASE_TTL_MS, 'XX');
  }, LEASE_REFRESH_MS);
  // The refresher must not be what keeps the vitest process alive.
  refresh.unref();

  log(`[test-setup] this invocation owns Redis database ${index}`);

  return {
    url,
    index,
    runId,
    release: async () => {
      clearInterval(refresh);
      try {
        await owned.flushdb();
        // Compare-and-delete: never release a lease that has already expired
        // and been taken by somebody else.
        const holder = await registry.get(`${LEASE_PREFIX}${index}`);
        if (holder === runId) await registry.del(`${LEASE_PREFIX}${index}`);
      } finally {
        owned.disconnect();
        registry.disconnect();
      }
    },
  };
}
