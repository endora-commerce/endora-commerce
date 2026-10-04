import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { composeApp } from '../../../src/composition.js';
import { deploymentRoot } from '../../../src/overlay/overlay-roots.js';
import { buildServer } from '@endora-commerce/platform/composition';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';

/**
 * The production root actually boots (feature 072, D-40).
 *
 * This file does what `src/index.ts` does minus `listen()` — `composeApp()`
 * then `buildServer(...)` — because that sequence, and only that sequence, is
 * what the platform runs and what stopped working on `master`. `composeApp()`
 * threw, `index.ts` turned it into `process.exit(1)`, and 930 test files did not
 * notice: `test/helpers/test-server.ts` seeds module presence *before*
 * composing, so the harness root had the ordering right and the deployment root
 * did not (D-38).
 *
 * **Booting is what makes this test work, and source-level assertions cannot
 * replace it.** Unlike `harness-parity.test.ts` and `worker-compose.test.ts`,
 * which are right to read source because they check properties of the *wiring*,
 * every ingredient of the crash was individually correct: the cache was empty
 * because nothing had loaded it, the gate threw because that is what gates do,
 * awilix strict mode refused the singleton because strict mode is on. Nothing
 * short of composing them catches the sequence. This one run covers all three
 * manifestations of D-38 — boot hooks (composition), plugin bodies
 * (`buildServer`) and worker registration — plus D-38b's lifetime assertion.
 *
 * **The production root is booted in exactly one file, never from a helper.**
 * The suite is `pool: 'forks', maxWorkers: 1, fileParallelism: false`
 * (`backend/vitest.shared.ts`), so files run one at a time, serially, and
 * `setupBackendServer` already accounts for ~88 % of a booting file's cost. One
 * extra composition is affordable exactly once per suite run; a helper is how it
 * becomes one per file.
 *
 * Everything below therefore runs in a single `beforeAll`, and teardown is not
 * optional: two ioredis clients, the ORM pool and a possible degraded-mode timer
 * outlive this file otherwise, which is the known failure mode where the suite
 * dies partway through the run.
 *
 * **Stated gap.** `BACKEND_ROLE=api` keeps this boot from registering BullMQ
 * consumers against the shared Redis, so the `worker` role's own boot hooks
 * (`pim_ergonode`, `product_feeds`, both guarded on `runWorkers`) are not
 * covered here. Role-independence of the module list stays with
 * `test/unit/kernel/worker-compose.test.ts`, which asserts list parity
 * only — it does not boot the worker role either.
 */

/** Same rule `test/global-setup.ts` enforces before any fork: `b2b_test`, not the dev database. */
function databaseName(url: string): string {
  return new URL(url).pathname.replace(/^\//, '');
}

describe('the production composition root boots', () => {
  let composition: Awaited<ReturnType<typeof composeApp>> | undefined;
  let app: FastifyInstance | undefined;
  const originalRole = process.env['BACKEND_ROLE'];

  beforeAll(async () => {
    // Asserted, not trusted. `global-setup.ts` forces DATABASE_URL to the test
    // database in the parent process before any fork, and `composeApp()` reads
    // the same variable — but a *production* boot pointed at the dev database
    // would reconcile registry rows, settings and i18n bundles into it, and that
    // is the one failure mode of this test that would be genuinely damaging.
    const url = process.env['DATABASE_URL'];
    expect(url, 'DATABASE_URL must be set by test/global-setup.ts').toBeTruthy();
    expect(databaseName(url as string)).toMatch(/(^|_)test(_|$)/);

    // Principle X's deployment dial: HTTP only, so this boot starts no queue
    // consumers on the Redis the rest of the suite shares.
    process.env['BACKEND_ROLE'] = 'api';

    composition = await composeApp({ deploymentRoot: deploymentRoot() });
    app = await buildServer({
      // `index.ts` reads SESSION_COOKIE_SECRET; nothing here signs a cookie.
      sessionCookieSecret: 'production-boot-test-secret',
      openApi: {
        title: 'B2B Platform API',
        version: '0.0.0',
        serverUrl: 'http://localhost:3001',
      },
      modules: composition.modules,
      errorEnvelope: composition.errorEnvelope,
      apiInterceptors: composition.apiInterceptors,
    });
  });

  afterAll(async () => {
    // A degraded-mode timer, an open server and two ioredis clients plus the ORM
    // pool, in that order — the file after this one inherits whatever is left.
    registryCache.stopFallbackRefresh();
    if (app) await app.close();
    if (composition) await composition.dispose();

    // `registryCache` is a process singleton and this boot loaded it from the
    // real `module_registrations` table. Restore the state every other file
    // expects to find rather than leaving it to whichever helper runs next.
    registryCache.__setEnabledForTesting(REGISTERED_MANIFESTS.map((e) => e.manifest.id));

    if (originalRole === undefined) delete process.env['BACKEND_ROLE'];
    else process.env['BACKEND_ROLE'] = originalRole;
  });

  it('composes every module and loads presence before the first one registers', () => {
    expect(composition).toBeDefined();
    // Composition produced the module plugins `buildServer` runs. The count is
    // deliberately a floor, not an equality: this test is about the boot, not
    // about how many modules ship today.
    expect(composition?.modules.length).toBeGreaterThan(0);

    // D-38: presence is a composition input. Had it still been warmed inside
    // `_lifecycle`'s plugin body, `composeApp()` above would have thrown
    // `ModuleCompositionError` on the first boot hook resolving a gated port.
    expect(registryCache.isLoaded()).toBe(true);
    expect(registryCache.enabledIds().length).toBeGreaterThan(0);
  });

  it('registers processRunsWorkers from the role this process was booted with', () => {
    // `specs/134-paid-module-extraction/` T122 (research D16): the one
    // module-agnostic worker switch, read by every in-tree module that starts
    // queue consumers. This boot is `BACKEND_ROLE=api`, so the platform's own
    // `runWorkers` is false and the published value must say the same; had
    // `composeApp` not registered it, the route registrations of `pim_pimcore`,
    // `comarch_xl` and `infakt`, which read it unconditionally, would already
    // have failed `buildServer` above. The other arm of the role table is
    // `packages/platform/src/composition/process-runs-workers.test.ts`'s.
    expect(composition!.container.resolve('processRunsWorkers')).toBe(false);
  });

  it('builds the server, so every module plugin body ran', () => {
    // The second manifestation of D-38 lives here: plugin bodies run inside
    // `buildServer`, and `_i18n`'s destructures a gated port. D-38b's awilix
    // lifetime assertion is upstream of this line, in `composeApp()`.
    expect(app).toBeDefined();
  });

  it('resolves actor promotion from the container, which is the only caller there is', () => {
    // `specs/117-instance-bring-up/` FR-030. The production root used to call
    // `promoteAdminActor` as an imported function and now reads a container
    // name, inside the actor bridge it contributes to `mfa` — a **production
    // only** closure, because the harness resolves an admin actor from its own
    // `request.testActor`. So nothing else in this suite would notice the name
    // being wrong: a missing registration is `undefined` at a call site no test
    // reaches, and the first person to find out is an operator whose admin
    // session rides alongside a customer one.
    //
    // Asserted against the **composed** container rather than against `auth`'s
    // `registerModule` over a stub, for the reason this whole file exists: every
    // ingredient can be individually correct and the sequence still wrong.
    const promote = composition!.container.cradle['promoteAdminActor'] as (
      request: unknown,
    ) => void;
    expect(typeof promote).toBe('function');

    // And it promotes. The shape is the plugin's two decorations, which is all
    // the function reads: an admin candidate resolved from the admin cookie,
    // beside an ambient actor that is not an admin.
    const adminActor = { kind: 'admin', adminUserId: 'a1', session: {} };
    const request = { actor: { kind: 'anonymous' }, adminActor };
    promote(request);
    expect(request.actor).toBe(adminActor);
  });

  it('registers the ports the tenant-context mapping reads, so no arm of it falls back', async () => {
    // The actor → tenant-context mapping is the platform's and reads three
    // module-owned names off this container on every request. A name nobody
    // registered is not a boot failure — the mapping confines instead: a
    // customer loses the roll-up and an admin reaches no organization. That is
    // the right answer for a composition missing the module and a silent
    // regression for one that has it, so the presence of all three is held
    // here, on the composed production container.
    const container = composition!.container;
    for (const name of [
      'customerRollupScopePort',
      'organizationTreeService',
      'adminTenantScopePort',
    ]) {
      expect(container.hasRegistration(name), `${name} is not registered`).toBe(true);
    }

    // And the admin port answers over the real tables: an id that names no
    // admin holds no role, so it reaches no organization and carries the
    // refusal — the absence of a role is never the widest role there is.
    const adminScope = container.cradle['adminTenantScopePort'] as {
      resolveForAdmin(adminUserId: string): Promise<unknown>;
    };
    const scope = await adminScope.resolveForAdmin('00000000-0000-4000-8000-000000000001');
    expect(scope).toMatchObject({ allowAll: false, allowedOrganizationIds: [] });
    expect((scope as { unresolved?: unknown }).unresolved).toMatchObject({
      statusCode: 403,
      code: 'ADMIN_ROLE_REQUIRED',
    });
  });

  it('answers a request, which is what "the backend started" means', async () => {
    const health = await app!.inject({ method: 'GET', url: '/api/v1/_health' });

    expect(health.statusCode).toBe(200);
  });

  /**
   * Cross-organisation access is audited **in the database** (owner decision of
   * 2026-10-03, Principle XI). The escape hatch reported every widening to a
   * sink nothing replaced, so the only record was a stderr line. Asserted here,
   * on the production root, because the sink is wired by `composeApp` — the
   * one composition an instance shares with this repository — and the harness
   * root does not run it.
   */
  describe('escape-hatch widenings land in audit_log_entries', () => {
    async function escapeHatchRows(reason: string): Promise<Array<Record<string, unknown>>> {
      await composition!.escapeHatchAudit.flush();
      return composition!.orm.em
        .fork()
        .getConnection()
        .execute(
          `select action, object_type, object_id, request_id, state_after
             from audit_log_entries
            where action = 'tenant.escape_hatch' and state_after->>'reason' = ?
            order by acted_at`,
          [reason],
        );
    }

    it('records the boot`s own system scope', async () => {
      const rows = await escapeHatchRows('boot: load module presence');

      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows[0]).toMatchObject({
        object_type: 'tenant_scope',
        object_id: 'system',
        state_after: { scope: 'system', module: 'platform', entryPoint: 'boot' },
      });
    });

    it('records a widening an anonymous HTTP request causes, with its module and request id', async () => {
      const reason =
        'comparisons: share-token lookup — a share link is a cross-customer grant, and the token is the authorization';
      const before = (await escapeHatchRows(reason)).length;

      const response = await app!.inject({
        method: 'GET',
        url: '/api/v1/comparisons/share/nosuchtoken42',
        headers: { 'x-request-id': 'escape-hatch-audit-probe' },
      });
      expect(response.statusCode).toBe(404);

      const rows = await escapeHatchRows(reason);
      expect(rows.length).toBe(before + 1);
      expect(rows.at(-1)).toMatchObject({
        object_type: 'tenant_scope',
        request_id: 'escape-hatch-audit-probe',
        state_after: {
          scope: 'system',
          module: 'comparisons',
          entryPoint: 'http',
          occurrences: 1,
          requestIds: ['escape-hatch-audit-probe'],
        },
      });
    });
  });
});
