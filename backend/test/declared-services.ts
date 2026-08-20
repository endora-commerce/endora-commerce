/**
 * What a test run declares about the external services it will have.
 *
 * The declaration is **explicit and positive**: a run that has no Postgres, no
 * Redis and no Meilisearch says so, by setting `BACKEND_TEST_SERVICES=none`
 * (which `vitest.unit.config.ts` does for you — choosing that config *is* the
 * declaration). Nothing here probes a socket, and nothing infers "no database"
 * from a connection that failed.
 *
 * That direction is the whole point. A `globalSetup` that quietly skipped its
 * work when it could not reach Postgres would hand back a suite that is green
 * because it never ran — the failure shape issues #113 and #159 were both
 * about, and the one `global-setup.ts` already refuses in its own database-name
 * check. So the default is `all`: an undeclared run is the complete run, and
 * the fast path cannot be reached by accident or by an outage.
 */

export const SERVICES_DECLARATION_ENV = 'BACKEND_TEST_SERVICES';

export type DeclaredServices = 'all' | 'none';

/**
 * Unreachable stand-ins installed by `global-setup.ts` when the run declares
 * `none`. Port 1 is not a service anywhere, and the database name still carries
 * `_test` so the harness's own refusal keeps working. Without them an unset
 * `DATABASE_URL` falls back to `postgresql://b2b:b2b@localhost:5432/b2b` —
 * the *dev* database — and a stray test would truncate it.
 */
export const UNREACHABLE_SERVICE_URLS = {
  DATABASE_URL: 'postgresql://absent:absent@127.0.0.1:1/services_declared_absent_test',
  REDIS_URL: 'redis://127.0.0.1:1',
  MEILISEARCH_URL: 'http://127.0.0.1:1',
  MEILISEARCH_HOST: 'http://127.0.0.1:1',
} as const;

export function declaredServices(env: NodeJS.ProcessEnv = process.env): DeclaredServices {
  const raw = env[SERVICES_DECLARATION_ENV]?.trim();
  if (raw === undefined || raw === '') return 'all';
  if (raw === 'all' || raw === 'none') return raw;
  throw new Error(
    `${SERVICES_DECLARATION_ENV} must be "all" or "none" (got "${raw}"). ` +
      `A run declares the absence of services; it never guesses.`,
  );
}

/**
 * Called at the two harness seams that open a connection. Turns "this file
 * needs a database" into one sentence instead of an ECONNREFUSED against port
 * 1, and is what makes the fast run fail *loudly* when a service-dependent test
 * sneaks into it.
 */
export function assertServicesAvailable(seam: string): void {
  if (declaredServices() === 'all') return;
  throw new Error(
    `${seam} needs a live service, but this run declared ${SERVICES_DECLARATION_ENV}=none.\n` +
      `This file therefore belongs in SERVICE_DEPENDENT_UNIT_TESTS ` +
      `(backend/test/service-dependent-unit-tests.ts), which is what excludes it from the ` +
      `fast unit run and leaves it to the complete one. Add it there with a reason, or run ` +
      `the complete suite: pnpm --filter backend run test.`,
  );
}
