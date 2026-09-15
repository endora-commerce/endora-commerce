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
  leaseRunDatabase,
  type RunDatabaseLease,
} from '@endora-commerce/test-kit/database';
import {
  declaredServices,
  SERVICES_DECLARATION_ENV,
  UNREACHABLE_SERVICE_URLS,
} from './declared-services.js';
import { applyGenerableSecretEnv } from './generable-secrets.js';

const DEFAULT_TEST_DATABASE_URL = 'postgresql://b2b:b2b@localhost:5432/b2b_test';

function resolveTestDatabaseUrl(): string {
  const url = process.env['TEST_DATABASE_URL']?.trim() || DEFAULT_TEST_DATABASE_URL;
  // The `_test` judgement is the kit's, from the same constant the generated
  // names are checked against — one spelling, so isolation cannot widen it.
  return assertTestDatabaseUrl(url);
}

async function applyMigrations(): Promise<void> {
  const { initOrm, closeOrm } = await import('../src/db/index.js');
  const { establishPlatformInvariants } = await import('./template-seed.js');
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
 * Read from `src/db/configured-migrations.ts`, the module the ORM config
 * assigns to `migrationsList` — so there is one ordering and not a copy of it
 * here, and reading it does not import the config, which would capture whatever
 * `DATABASE_URL` names at that moment for the life of the process.
 */
async function configuredMigrationNames(): Promise<readonly string[]> {
  return (await (await import('../src/db/configured-migrations.js')).configuredMigrations()).names;
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
  const applied = await applyGenerableSecretEnv();
  process.stdout.write(
    `[test-setup] generable secrets: pinned=${applied.pinned.length} ` +
      `withheld=${applied.withheld.length} (${applied.withheld.join(', ')})\n`,
  );
}

/** Vitest calls what a globalSetup returns once the whole invocation is over. */
type Teardown = () => Promise<void>;

export default async function globalSetup(): Promise<Teardown | void> {
  await applyDeterministicTestEnv();

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

  const lease: RunDatabaseLease = await leaseRunDatabase({
    baseUrl: resolveTestDatabaseUrl(),
    identity: await templateIdentity(),
    // `migrateTemplate` is a callback because the ORM config reads
    // DATABASE_URL at import: the template is migrated while that variable
    // names the template, and the run database takes over immediately after.
    migrateTemplate: applyMigrations,
    configuredMigrationNames,
  });

  return lease.release;
}
