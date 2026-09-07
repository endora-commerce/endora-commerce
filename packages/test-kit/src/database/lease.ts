/**
 * The per-invocation database lease, as a seam a caller drives (feature 109,
 * T022; the mechanism is issue #189's).
 *
 * ## What it does, unchanged
 *
 * One `vitest run` gets its **own** database — `<base>_r_<stamp>_<rand>`, a
 * `create database … template` clone of the migrated `<base>_tpl_<digest>` —
 * and its **own** Redis logical database, leased in index 0. Both are released
 * when the run ends and swept if it crashed. Before that, isolation used to be
 * per database and per Redis instance and never per invocation, so a second
 * `vitest run` landed its truncate inside the first one's setup, and every
 * symptom of that is indistinguishable from a real failure.
 *
 * ## What moved, and why this is a seam rather than a script
 *
 * It was `backend/test/global-setup.ts`, whose isolated path could not be
 * reached from outside `backend`. The two things in it that are *this
 * repository's* — which migrations exist, and what "migrated" means for its
 * schema — are the two the caller supplies:
 *
 *   - **`identity`** is the digest over the caller's whole migration input.
 *     Two callers whose input differs get two templates and cannot contaminate
 *     each other; two that agree share one and pay one migration pass between
 *     them.
 *   - **`migrateTemplate`** is applied to the template while `DATABASE_URL`
 *     names it. It is a callback rather than a value for a reason that survives
 *     the move: an ORM configuration captures `DATABASE_URL` at import, once
 *     per process, so the import has to happen after this function has pointed
 *     that variable at the template.
 *
 * Nothing here reads a generated artefact, walks `node_modules` or consults
 * `process.env.DEPLOYMENT`. Every one of those is a fact about the caller's
 * process (R2.2), and a kit that answered them would answer them differently
 * from the platform that composes for real.
 *
 * ## The two documented overrides behave exactly as they did
 *
 * `BACKEND_TEST_ISOLATION=shared` restores the pre-#189 behaviour of every
 * invocation sharing one database, and `BACKEND_TEST_KEEP_DATABASE=1` keeps the
 * run's database for a post-mortem instead of dropping it. Both are read here,
 * from the same two constants the naming rules use — see
 * `backend/test/README.md` § *One database per invocation*, which is still the
 * document that describes them.
 */

import {
  BASE_DATABASE_URL_ENV,
  ISOLATION_ENV,
  KEEP_DATABASE_ENV,
  TEMPLATE_DATABASE_ENV,
  TEST_DATABASE_NAME_PATTERN,
  databaseNameOf,
  keepRunDatabase,
  redisUrlNamesDatabase,
  runIdentity,
  sharedDatabaseReason,
  templateDrift,
  withDatabase,
} from './run-isolation.js';
import {
  appliedMigrations,
  dropRunDatabase,
  leaseRedisDatabase,
  provisionRunDatabase,
  sweepStrandedRunDatabases,
  type Log,
  type ProvisionInput,
  type RedisLease,
} from './provision.js';

/** The migration set this run's platform is, exactly as `provisionRunDatabase` takes it. */
export type TemplateIdentity = ProvisionInput['identity'];

export interface RunDatabaseLeaseInput {
  /**
   * The base test DSN. The run database and the template are **named from it**,
   * and it is never itself what the workers connect to on the isolated path.
   */
  readonly baseUrl: string;
  /** Which migration set this run has — the caller's, because the migrations are. */
  readonly identity: TemplateIdentity;
  /**
   * Apply the caller's schema to the template database at this URL.
   *
   * Called with `DATABASE_URL` already pointing at the template, so an ORM
   * configuration imported inside it captures the right database.
   */
  readonly migrateTemplate: (templateUrl: string) => Promise<void>;
  /**
   * The migration class names this run applies, in order.
   *
   * Used on the **shared** path only, and only to warn: a shared database
   * accumulates a migration from another branch, and a test that drives the
   * migrator then reads that as a failure of the code under test. Nothing here
   * rebuilds a shared database — it is the operator's, named by them.
   */
  readonly configuredMigrationNames?: () => Promise<readonly string[]>;
  /** Defaults to `REDIS_URL`, or `redis://localhost:6379`. */
  readonly redisUrl?: string;
  /** Defaults to `process.env`, which is also what the lease writes into. */
  readonly env?: NodeJS.ProcessEnv;
  readonly log?: Log;
}

export interface RunDatabaseLease {
  /** Which path this lease took. `shared` means nothing was provisioned. */
  readonly mode: 'per-invocation' | 'shared';
  /** The DSN every worker of this invocation will use — also written to `DATABASE_URL`. */
  readonly databaseUrl: string;
  /** The run database's name, or `undefined` on the shared path. */
  readonly databaseName: string | undefined;
  /** The template this run was cloned from, or `undefined` on the shared path. */
  readonly templateName: string | undefined;
  /** The Redis DSN this invocation owns, or `undefined` when the caller's already named one. */
  readonly redisUrl: string | undefined;
  /** Drop the run database and release the Redis index. Idempotent. */
  readonly release: () => Promise<void>;
}

const DEFAULT_REDIS_URL = 'redis://localhost:6379';

/**
 * The `_test` judgement, applied to the base DSN before anything is created.
 *
 * Exported because it is the guard a caller wants **before** it decides to
 * lease at all, and because a caller that resolves its own DSN should not
 * reimplement the refusal. `ALLOW_NON_TEST_DATABASE_URL=1` is the documented
 * override and stands down the isolation with it (see `sharedDatabaseReason`):
 * a name derived from a base that already breaks the convention would break it
 * too, and isolation refuses to widen the judgement.
 */
export function assertTestDatabaseUrl(url: string, env: NodeJS.ProcessEnv = process.env): string {
  const dbName = databaseNameOf(url);
  if (!TEST_DATABASE_NAME_PATTERN.test(dbName) && !env['ALLOW_NON_TEST_DATABASE_URL']) {
    throw new Error(
      `Refusing to run tests against database "${dbName}" — name must contain "_test" ` +
        `(e.g. b2b_test). Set ALLOW_NON_TEST_DATABASE_URL=1 to override. ` +
        `Resolved URL: ${url}`,
    );
  }
  return url;
}

/** Create the base database if it is not there, so a first run on a fresh cluster works. */
async function ensureDatabaseExists(testUrl: string, log: Log): Promise<void> {
  const dbName = databaseNameOf(testUrl);
  const { Client: PgClient } = await import('pg');
  const admin = new PgClient({ connectionString: withDatabase(testUrl, 'postgres') });
  await admin.connect();
  try {
    const { rowCount } = await admin.query('select 1 from pg_database where datname = $1', [
      dbName,
    ]);
    // `pg` types `rowCount` as `number | null`; for this existence probe `0`
    // and `null` both honestly mean "no such database", and the value reaches
    // nothing but this comparison.
    if (rowCount === null || rowCount === 0) {
      // A `pg_database` name cannot be parameterised in `create database`; the
      // `_test` judgement above plus URL parsing keeps this from being
      // injectable, and the re-check refuses anything the two let through.
      const safeName = dbName.replace(/[^a-zA-Z0-9_]/g, '');
      if (safeName !== dbName) throw new Error(`Unsafe DB name: "${dbName}"`);
      await admin.query(`create database "${safeName}"`);
      log(`[test-kit] created database ${safeName}`);
    }
  } finally {
    await admin.end();
  }
}

/**
 * Give this invocation its own database and its own Redis logical database.
 *
 * Writes `DATABASE_URL`, `BACKEND_TEST_BASE_URL`, `BACKEND_TEST_TEMPLATE` and
 * `REDIS_URL` into `env` (which defaults to `process.env`), because a vitest
 * worker inherits the parent's environment and that inheritance **is** the
 * mechanism by which a run's actual DSN reaches the files that use it. A caller
 * that spawns a CLI from a test reads `DATABASE_URL`, never `TEST_DATABASE_URL`
 * — the second names the base.
 */
export async function leaseRunDatabase(input: RunDatabaseLeaseInput): Promise<RunDatabaseLease> {
  const env = input.env ?? process.env;
  const log: Log = input.log ?? ((message) => process.stdout.write(`${message}\n`));
  const baseUrl = assertTestDatabaseUrl(input.baseUrl, env);

  // The pre-#189 behaviour, on either of two grounds. The first is an explicit
  // opt-out, worth having for a post-mortem — the run database is dropped when
  // the run ends, and sometimes what you want is the database a failing run
  // left behind, under a name you already know. The second is
  // ALLOW_NON_TEST_DATABASE_URL: that override is somebody deliberately
  // pointing the suite at a database whose name breaks the convention, and a
  // name derived from it would break it too.
  const shared = sharedDatabaseReason(env, databaseNameOf(baseUrl));
  if (shared !== undefined) {
    env['DATABASE_URL'] = baseUrl;
    await ensureDatabaseExists(baseUrl, log);
    await input.migrateTemplate(baseUrl);
    log(
      `[test-kit] ${shared === 'explicit' ? `${ISOLATION_ENV}=shared` : 'ALLOW_NON_TEST_DATABASE_URL'}` +
        ` — this invocation shares ${databaseNameOf(baseUrl)} with every other one.`,
    );
    // The shared database accumulates the same way a template does — a
    // migration from another branch, or one of ours appended where the order
    // does not put it — and a test that drives the migrator reads that as a
    // failure of the code under test. This path only *says* so: the database is
    // the operator's, named by them or kept by them for a post-mortem, so it is
    // not this lease's to drop.
    if (input.configuredMigrationNames !== undefined) {
      const drift = templateDrift(
        await appliedMigrations(baseUrl),
        await input.configuredMigrationNames(),
        databaseNameOf(baseUrl),
      );
      if (drift) {
        log(
          `[test-kit] WARNING: ${drift.message.replace(' Rebuilding it from empty.', '')} ` +
            `Nothing here rebuilds it, because you named it. A test that drives the migrator ` +
            `will fail against it for that reason and not for its own — drop it and re-run, ` +
            `or drop ${ISOLATION_ENV}=shared and let the isolated path rebuild its template.`,
        );
      }
    }
    return {
      mode: 'shared',
      databaseUrl: baseUrl,
      databaseName: undefined,
      templateName: undefined,
      redisUrl: undefined,
      release: async () => {
        /* nothing was provisioned, so there is nothing to give back */
      },
    };
  }

  const run = await provisionRunDatabase({
    baseUrl,
    identity: input.identity,
    migrateTemplate: async (templateUrl) => {
      env['DATABASE_URL'] = templateUrl;
      await input.migrateTemplate(templateUrl);
    },
    log,
  });
  env['DATABASE_URL'] = run.url;
  // A file that drives the real migrator may not do it to the database its
  // neighbours share — the run database is this invocation's only copy, so a
  // migration sequence that dies half-way takes the whole invocation with it.
  // Exporting the base and the template *name* is what lets such a file clone
  // the same template this run was cloned from: by name, because by the time it
  // asks, another invocation may have built a template of its own.
  env[BASE_DATABASE_URL_ENV] = baseUrl;
  env[TEMPLATE_DATABASE_ENV] = run.template;

  // The same defect on the other service: a batch that "passed alone" would
  // still have collided on Redis keys. An explicit index in REDIS_URL is
  // somebody's deliberate choice and is left alone.
  const redisBaseUrl = input.redisUrl ?? env['REDIS_URL'] ?? DEFAULT_REDIS_URL;
  let lease: RedisLease | undefined;
  if (redisUrlNamesDatabase(redisBaseUrl)) {
    log(`[test-kit] REDIS_URL already names a logical database — leaving it alone.`);
  } else {
    lease = await leaseRedisDatabase(redisBaseUrl, runIdentity(), log);
    env['REDIS_URL'] = lease.url;
  }

  // Runs that crashed before their release. Best-effort, capped, and only ever
  // over names this mechanism generated.
  await sweepStrandedRunDatabases(baseUrl, run.name, log);

  let released = false;
  return {
    mode: 'per-invocation',
    databaseUrl: run.url,
    databaseName: run.name,
    templateName: run.template,
    redisUrl: lease?.url,
    release: async () => {
      if (released) return;
      released = true;
      await lease?.release();
      if (keepRunDatabase(env)) {
        log(
          `[test-kit] ${KEEP_DATABASE_ENV} is set — keeping ${run.name}. ` +
            `Drop it yourself, or leave it for the sweep in ~4 h.`,
        );
        return;
      }
      await dropRunDatabase(baseUrl, run.name, log);
    },
  };
}
