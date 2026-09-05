/**
 * The two guards standing between a demo seed and somebody's live data.
 *
 * ## Why they are the platform's (feature 113, spec §7)
 *
 * `mustBeNonProduction()` is the safety property that makes every one of these
 * commands runnable at all, and under **D-207** a client's backend takes
 * `@endora-commerce/platform` and never receives the host's `backend/src`. A
 * client running a demo seed against production is precisely what this file
 * prevents, so it has to ship. It moved here from
 * `backend/src/seeds/dev-seed-guard.ts`, which is now a re-export shim; the two
 * consumers standing when it moved are `seed:dev` and
 * `backend/scripts/conformance/seed-storefront-fixtures.ts`, and §3.3 requires
 * the demo runner's entry point to call **this** implementation rather than a
 * second copy.
 *
 * The body below is unchanged but for the operation its two refusals name:
 * `dev-catalog-seed` became *"the demo seed"*, because from Phase 0 the same
 * guard answers `endora demo seed` and an operator refused by it must not be
 * sent to a host file they have never heard of and, under D-207, do not have.
 * The sentence is true of `seed:dev` as well, which still runs throughout Phase
 * 0 (FR-013 — the replacement exists before the removal).
 *
 * They live apart from the seed body, not inside it, because
 * `dev-catalog-seed.ts` calls `main()` at import time: a test importing that
 * file would run the seed it is supposed to be testing.
 * `backend/test/unit/seeds/dev-seed-guard.test.ts` covers this module; the seed
 * had no test at all, which is part of how issue #224 stood.
 *
 * ## Issue #224 — the second guard had never refused anything
 *
 * The database check used to be a regex over the whole DSN:
 *
 *     /localhost|127\.0\.0\.1|postgres(?::\d+)?/.test(url)
 *
 * The `postgres` alternative was meant to match the docker-compose service
 * hostname. Tested against the whole DSN it matches the **scheme** instead —
 * every PostgreSQL DSN begins `postgresql://` — so it accepted
 * `postgresql://user:pw@db.production.example.com:5432/shop` and every other
 * remote database, on every host, for as long as it existed. `NODE_ENV` was
 * the only guard actually guarding; the second one was decoration.
 *
 * So: parse the DSN and test the **host**, and where the host cannot answer,
 * test the database **name**.
 */

/**
 * Hosts that can only mean "the machine running the seed".
 *
 * A loopback DSN cannot reach another machine's database, so the operator is
 * seeding something in front of them. Seeding a production box's own database
 * over loopback is the case `NODE_ENV=production` answers — that guard, and
 * not this one.
 *
 * `::1` arrives from `new URL()` as `[::1]`; `hostOf` strips the brackets.
 * Only these three exact spellings: `127.0.0.2` and friends are loopback too,
 * but nothing in this repository uses one, and the whole defect above came
 * from a host test that was broader than it looked.
 */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '::1']);

/**
 * A database name that says "this database exists to be wiped".
 *
 * Deliberately the *same* judgement `test/global-setup.ts` makes before it
 * lets the vitest harness truncate a database — a second, parallel convention
 * would be one more thing to keep true. The unit test pins the two together by
 * reading that file, so the day the harness changes its mind this stops
 * compiling agreement rather than drifting quietly.
 */
export const TEST_DATABASE_NAME_PATTERN = /(^|_)test(_|$)/;

/**
 * Set to `true` to run the seed against a database that is neither loopback
 * nor named as a test database — a demo deployment being the case that has a
 * claim on it.
 *
 * It is a *separate* flag from `ALLOW_DEV_SEED_IN_PRODUCTION` on purpose. The
 * lesson of issue #224 is that one guard silently covering for the other is
 * how a wipe reaches live data: a deliberate demo seed must now say both "yes,
 * production" and "yes, that database", and each answer is visible on its own
 * in whatever ran the command.
 */
const NON_LOCAL_OVERRIDE = 'ALLOW_DEV_SEED_ON_NON_LOCAL_DATABASE';

/** Lower-cased host with IPv6 brackets removed, or `''` for a unix-socket DSN. */
function hostOf(parsed: URL): string {
  return parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
}

function databaseNameOf(parsed: URL): string {
  return decodeURIComponent(parsed.pathname).replace(/^\//, '');
}

export interface SeedTargetVerdict {
  readonly safe: boolean;
  /** Host and database only — a DSN carries a password and this reaches logs. */
  readonly describe: string;
  readonly why: string;
}

/**
 * Is `url` a database the seed may truncate?
 *
 * Three answers, in order:
 *
 *   1. **Unparseable** — refuse. `new URL()` throws where the old regex merely
 *      failed to match, and an unhandled `TypeError: Invalid URL` from a
 *      data-wipe guard reads like a crash rather than a refusal. Caught, and
 *      re-thrown by the caller as the guard's own sentence.
 *   2. **Loopback host** — allow, whatever the database is called. This is the
 *      dev path: `backend/.env` ships
 *      `postgresql://b2b:b2b@localhost:5432/b2b` and `pnpm run dev` runs on
 *      the host against the published compose port.
 *   3. **Anything else** — allow only if the database *name* follows the test
 *      convention. `postgres` is the compose service name in `docker-compose.yml`
 *      *and* in `deploy/compose.prod.yml`, so the host genuinely cannot tell a
 *      dev stack from a production one; the CI DSN
 *      (`postgresql://b2b:b2b@postgres:5432/b2b_test`) is separated from the
 *      production DSN (`…@postgres:5432/b2b`) by the database name and by
 *      nothing else.
 *
 * This is the most restrictive rule that leaves `pnpm run dev` working. The
 * looser arm considered and rejected: keeping the host `postgres` sufficient
 * on its own, which is what the old regex was reaching for. That admits
 * `deploy/compose.prod.yml`'s own `DATABASE_URL` verbatim — the exact DSN a
 * `seed` service in the production stack would have been handed.
 */
export function classifySeedTarget(url: string): SeedTargetVerdict {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { safe: false, describe: '<unparseable DATABASE_URL>', why: 'it is not a URL' };
  }

  const host = hostOf(parsed);
  const database = databaseNameOf(parsed);
  const describe = `host "${host || '<none>'}", database "${database}"`;

  if (LOOPBACK_HOSTS.has(host)) {
    return { safe: true, describe, why: 'the host is loopback' };
  }
  if (TEST_DATABASE_NAME_PATTERN.test(database)) {
    return { safe: true, describe, why: 'the database name follows the test convention' };
  }
  return {
    safe: false,
    describe,
    why:
      'the host is not loopback and the database name does not contain "test" ' +
      '(the convention test/global-setup.ts uses before it truncates)',
  };
}

/**
 * Refuse to seed anything but a development or test database.
 *
 * Two independent questions — "is this a production runtime?" and "is this a
 * disposable database?" — with an explicit opt-out each. Neither answers for
 * the other (issue #224).
 *
 * `env` is a parameter so the unit test can hand over a whole environment
 * rather than mutating the process's.
 */
export function mustBeNonProduction(env: NodeJS.ProcessEnv = process.env): void {
  // The seed is destructive (it truncates the public catalog/business tables),
  // so it refuses NODE_ENV=production by default. A deliberate demo deployment
  // can opt in with ALLOW_DEV_SEED_IN_PRODUCTION=true — this is intentionally a
  // separate, explicit flag so an accidental run never wipes real data.
  const forced = env['ALLOW_DEV_SEED_IN_PRODUCTION'] === 'true';
  if (env['NODE_ENV'] === 'production' && !forced) {
    throw new Error(
      'refusing to run the demo seed in NODE_ENV=production ' +
        '(set ALLOW_DEV_SEED_IN_PRODUCTION=true to override — this WIPES business data)',
    );
  }

  const url = env['DATABASE_URL'] ?? 'postgresql://b2b:b2b@localhost:5432/b2b';
  const verdict = classifySeedTarget(url);
  if (!verdict.safe && env[NON_LOCAL_OVERRIDE] !== 'true') {
    throw new Error(
      `refusing to run the demo seed against ${verdict.describe}: ${verdict.why}. ` +
        `This seed truncates the catalog and business tables. Set ${NON_LOCAL_OVERRIDE}=true ` +
        'if that database really is disposable.',
    );
  }
}
