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
  STALE_TEMPLATE_MS,
  advisoryLockKey,
  databaseNameOf,
  formatTemplateProvenance,
  parseTemplateProvenance,
  redisUrlWithDatabase,
  runDatabaseName,
  staleTemplates,
  strandedRunDatabases,
  templateDatabaseName,
  templateDrift,
  templateFamilyName,
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
 * What a database says about itself.
 *
 * A database comment is the one piece of state a template can carry that a
 * clone does not inherit — `create database … template …` copies the contents
 * and leaves `pg_shdescription` behind, which is exactly right: the provenance
 * is the *template's*, and a run database has none. It also needs no table in
 * the template and no connection to it.
 */
async function databaseComment(admin: Client, name: string): Promise<string | undefined> {
  const { rows } = await admin.query<{ note: string | null }>(
    "select shobj_description(oid, 'pg_database') as note from pg_database where datname = $1",
    [name],
  );
  return rows[0]?.note ?? undefined;
}

async function setDatabaseComment(admin: Client, name: string, comment: string): Promise<void> {
  // Neither identifier nor comment can be parameterised here. The name is one
  // this module generated and the comment is assembled from a digest and a
  // timestamp, but the escape stays because the alternative is a rule nobody
  // can see being followed.
  await admin.query(`comment on database "${name}" is '${comment.replace(/'/g, "''")}'`);
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
  /**
   * Which migration set this run has, from `test/template-identity.ts`.
   *
   * A **value**, unlike the callback this used to be, because the identity is
   * read from `src/db/configured-migrations.ts` — the ordering the ORM config
   * assigns, extracted so that reading it does not mean importing the config.
   * That import is what the callback existed to delay: **the config captures
   * `DATABASE_URL` at import**, once per process, and the parent used to import
   * it while that variable was unset, whose fallback is the *dev* database.
   * `migrateTemplate` is still a callback for exactly that reason.
   */
  readonly identity: {
    readonly digest: string;
    readonly migrations: readonly string[];
    readonly migrationFiles: number;
  };
  /** Applies pending migrations to the template and establishes the platform invariants. */
  readonly migrateTemplate: (templateUrl: string) => Promise<void>;
  readonly log?: Log;
}

/** Whether a template holds this run's migration set and nothing else. */
function isExactly(applied: readonly string[], expected: readonly string[]): boolean {
  return applied.length === expected.length && templateDrift(applied, expected) === undefined;
}

/**
 * Give this invocation its own database.
 *
 * Everything between taking the advisory lock and releasing it is serialized
 * across invocations: identify the template, build it if it is not there or not
 * what it claims, migrate it, disconnect from it, clone, collect the templates
 * nobody uses any more. Holding the lock across the clone as well is deliberate
 * — the clone is a fraction of a second, and it is what guarantees the template
 * is idle at the moment the next invocation's migration opens a connection to
 * it.
 *
 * The lock is taken on the `postgres` maintenance database: PostgreSQL advisory
 * locks are scoped to a database, so every waiter has to agree on which, and it
 * must not be the template — a session holding the lock there is exactly the
 * session that would make the clone illegal. It is one key for the whole
 * `<base>_tpl*` family rather than one per digest, because the sweep walks the
 * templates of other digests (see `templateFamilyName`).
 *
 * **Which template, is the question this function exists to answer** (issue
 * #289). It is `<base>_tpl_<digest>`, the digest being over this run's whole
 * migration input, so a template is shared only by runs whose platform it
 * actually is. Two things then have to agree before it is cloned: the
 * provenance comment the build wrote on it, and the migration names it actually
 * holds. Either disagreeing rebuilds it from empty — including "it says
 * nothing", because a template that cannot say what it holds is the defect.
 */
export async function provisionRunDatabase(input: ProvisionInput): Promise<RunDatabase> {
  const log = input.log ?? defaultLog;
  const base = databaseNameOf(input.baseUrl);
  const { digest, migrations: expected } = input.identity;
  const template = templateDatabaseName(base, digest);
  const templateUrl = withDatabase(input.baseUrl, template);
  const name = runDatabaseName(base);
  const lockKey = advisoryLockKey(templateFamilyName(base));

  log(
    `[test-setup] migration set ${digest}: ${expected.length} migration(s), read from ` +
      `${input.identity.migrationFiles} source file(s) — template ${template}`,
  );

  const admin = await connectAdmin(input.baseUrl);
  try {
    await admin.query('select pg_advisory_lock($1)', [lockKey]);
    try {
      let rebuild: string | undefined;
      if (!(await databaseExists(admin, template))) {
        rebuild = `no template for this migration set exists yet`;
      } else {
        const provenance = parseTemplateProvenance(await databaseComment(admin, template));
        const applied = await appliedMigrations(templateUrl);
        if (provenance === undefined) {
          // Unknown provenance is the whole defect: a database whose contents
          // nothing can account for. It is never cloned, whatever its name.
          rebuild = `${template} carries no provenance this harness wrote`;
        } else if (provenance.digest !== digest) {
          rebuild = `${template} says it holds migration set ${provenance.digest}, not ${digest}`;
        } else if (!isExactly(applied, expected)) {
          // The provenance says one thing and the database says another —
          // a build that died half-way, or somebody's psql session.
          rebuild =
            `${template} holds ${applied.length} of this run's ${expected.length} migration(s), ` +
            `and ${templateDrift(applied, expected, template)?.message ?? 'not in order'}`;
        }
      }

      if (rebuild !== undefined) {
        log(`[test-setup] ${rebuild} — building it from empty.`);
        await admin.query(`drop database if exists "${template}" with (force)`);
        await admin.query(`create database "${template}"`);
        await input.migrateTemplate(templateUrl);

        // A clone is only worth anything if the template is now exactly this
        // run's platform. After a build-and-migrate it is, by construction — so
        // a finding here is a real defect and gets said out loud rather than
        // handed to every test file in the run as a database that is quietly
        // not what the code says it is. It is also what catches a
        // `migrateTemplate` that migrated *something else*, which is a live
        // hazard while the ORM config resolves its DSN from an ambient
        // variable.
        const applied = await appliedMigrations(templateUrl);
        if (!isExactly(applied, expected)) {
          throw new Error(
            `the migration template is not this run's migration set after migrating it: it holds ` +
              `${applied.length} migration(s) against ${expected.length} configured` +
              `${templateDrift(applied, expected, template) ? `, and ${templateDrift(applied, expected, template)?.message}` : ''}. ` +
              `Drop "${template}" by hand and report this — a run cloned from it would not be ` +
              `the platform this branch's code describes.`,
          );
        }
      }

      // Written after the template is known good, and rewritten on every use:
      // the digest is what a later run checks, and `lastUsedAt` is what the
      // sweep reads. A build that dies before this line leaves a template with
      // no provenance, which the next run rebuilds rather than trusts.
      await setDatabaseComment(
        admin,
        template,
        formatTemplateProvenance({ digest, migrations: expected.length, lastUsedAt: new Date() }),
      );

      await cloneFromTemplate(admin, name, template);
      await sweepStaleTemplates(admin, base, template, log);
    } finally {
      await admin.query('select pg_advisory_unlock($1)', [lockKey]);
    }
  } finally {
    await admin.end();
  }

  log(`[test-setup] this invocation owns database ${name} (cloned from ${template})`);
  return { url: withDatabase(input.baseUrl, name), name, template };
}

/**
 * A database of this run's template, for a caller that is not the invocation.
 *
 * The template is named by the caller, not re-derived here, and that is the
 * point (issue #289): `global-setup.ts` resolved which template this run's
 * platform is and exported the name, so a file cloning one mid-run gets the
 * database the run itself was cloned from — not whatever `<base>_tpl` has
 * become while the run has been going, which with several branches on one
 * cluster is routinely another branch's schema.
 *
 * The advisory lock is the same one provisioning takes, and for the same
 * reason: it is what keeps the template idle at the moment a clone starts.
 * `setupMigratorTestDb` is the only caller — a test file that drives the real
 * migrator and must not do it to the database its neighbours share.
 */
export async function cloneTemplateForCaller(
  baseUrl: string,
  template: string,
): Promise<RunDatabase> {
  const base = databaseNameOf(baseUrl);
  const name = runDatabaseName(base);
  const lockKey = advisoryLockKey(templateFamilyName(base));
  const admin = await connectAdmin(baseUrl);
  try {
    await admin.query('select pg_advisory_lock($1)', [lockKey]);
    try {
      if (!(await databaseExists(admin, template))) {
        throw new Error(
          `this run's migration template "${template}" is gone. Nothing drops a template in ` +
            `use, so either something dropped it by hand or this run outlived it — either way ` +
            `a clone of what is there now would not be the platform this run started on.`,
        );
      }
      await cloneFromTemplate(admin, name, template);
    } finally {
      await admin.query('select pg_advisory_unlock($1)', [lockKey]);
    }
  } finally {
    await admin.end();
  }
  return { url: withDatabase(baseUrl, name), name, template };
}

/**
 * Drop the templates of migration sets nobody runs any more.
 *
 * Keying a template by its migration set is what stops two branches sharing
 * one; this is the other half of that bargain, because a branch leaves its
 * set's template behind the moment it gains a migration or is rebased. Called
 * under the provisioning lock, so no template can be half-built while it runs.
 *
 * Best-effort and never fatal: a sweep that fails is a disk-space problem, not
 * a reason to fail somebody's test run.
 */
export async function sweepStaleTemplates(
  admin: Client,
  base: string,
  keep: string,
  log: Log = defaultLog,
): Promise<string[]> {
  const dropped: string[] = [];
  try {
    const { rows } = await admin.query<{ datname: string; note: string | null }>(
      "select datname, shobj_description(oid, 'pg_database') as note from pg_database",
    );
    const busy = await admin.query<{ datname: string }>(
      'select distinct datname from pg_stat_activity where datname is not null',
    );
    const lastUsed = new Map<string, Date>();
    for (const row of rows) {
      const provenance = parseTemplateProvenance(row.note);
      if (provenance) lastUsed.set(row.datname, provenance.lastUsedAt);
    }
    const stale = staleTemplates({
      base,
      names: rows.map((row) => row.datname),
      busy: new Set(busy.rows.map((row) => row.datname)),
      keep,
      lastUsed,
      now: new Date(),
      maxAgeMs: STALE_TEMPLATE_MS,
      limit: SWEEP_LIMIT,
    });
    for (const name of stale) {
      try {
        await admin.query(`drop database if exists "${name}" with (force)`);
        dropped.push(name);
      } catch {
        // Somebody connected between the read and the drop. The next
        // invocation sweeps again.
      }
    }
    if (dropped.length > 0) {
      log(`[test-setup] swept ${dropped.length} migration template(s) no branch has used lately`);
    }
  } catch (error) {
    log(`[test-setup] could not sweep stale migration templates: ${(error as Error).message}`);
  }
  return dropped;
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
