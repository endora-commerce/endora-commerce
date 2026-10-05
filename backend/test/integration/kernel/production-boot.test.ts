import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { composeApp } from '../../../src/composition.js';
import { deploymentRoot } from '../../../src/overlay/overlay-roots.js';
import { buildServer } from '@endora-commerce/platform/composition';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';
import { enterSystemScope } from '@endora-commerce/platform/kernel';
import { seedOrder, type PgClient } from '../../../scripts/acceptance/instance-actor-scope.js';
import { randomUUID } from 'node:crypto';
import {
  AdminRole,
  AdminUser,
  CustomerAccount,
  Organization,
} from '../../helpers/package-entities.js';

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
    // admin holds no confining role.
    const adminScope = container.cradle['adminTenantScopePort'] as {
      resolveForAdmin(adminUserId: string): Promise<unknown>;
    };
    await expect(
      adminScope.resolveForAdmin('00000000-0000-4000-8000-000000000001'),
    ).resolves.toEqual({ allowAll: true });
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
  /**
   * The route decides which session scopes a request (Principle XI).
   *
   * Asserted on the production root because the chain it depends on is this
   * root's and nothing else's: `auth`'s real plugin resolving two real session
   * cookies, the platform's scope hook opening the request's tenant context
   * from the ambient actor, and `auth`'s guard — a route-level `preHandler`,
   * so later than both — settling which session the route accepts. The harness
   * assigns its own actor over the plugin's and builds its own mapping, so a
   * request that is authorized as one actor and scoped as another there is a
   * different defect from the same one here.
   *
   * The fixture is two organizations, an order of each written as a row (the
   * acceptance run's own insert, for its reason: placing one needs a delivery
   * and a payment method this boot has not configured), a member of the first,
   * and an administrator holding every permission. Every row is this block's
   * own, under ids generated here: the file shares its database with whatever
   * ran before it and truncates nothing.
   */
  describe('a browser holding an admin session and a customer session', () => {
    const run = randomUUID();
    const ADMIN_ID = randomUUID();
    const CUSTOMER_ID = randomUUID();
    const OWN_ORGANIZATION_ID = randomUUID();
    const OTHER_ORGANIZATION_ID = randomUUID();
    let cookies: { b2b_admin_session: string; b2b_session: string };
    let impersonating: { b2b_admin_session: string; b2b_session: string };
    let ownOrderId: string;
    let foreignOrderId: string;

    interface OrderList {
      readonly status: number;
      readonly orderIds: string[];
    }

    async function orderList(url: string, sent: Record<string, string>): Promise<OrderList> {
      const response = await app!.inject({ method: 'GET', url, cookies: sent });
      const rows = (response.json() as { data?: Array<{ id: string }> }).data ?? [];
      return { status: response.statusCode, orderIds: rows.map((row) => row.id) };
    }

    async function auditRowsAbout(
      objectId: string,
      since: Date,
    ): Promise<Array<{ actor_admin_user_id: string | null; impersonated: string | null }>> {
      return composition!.orm.em
        .fork()
        .getConnection()
        .execute(
          `select actor_admin_user_id, impersonated_customer_account_id as impersonated
             from audit_log_entries
            where object_id = ? and acted_at >= ?
            order by acted_at`,
          [objectId, since],
        );
    }

    beforeAll(async () => {
      await enterSystemScope(
        'test: seed two organizations, an order of each and an administrator',
        async () => {
          const em = composition!.orm.em.fork();
          const organization = (id: string, label: string): Organization =>
            em.create(Organization, {
              id,
              name: `Two sessions ${label} ${run.slice(0, 8)}`,
              taxId: `PL2S${label}${run.replace(/-/g, '').slice(0, 10)}`,
              status: 'active',
              vatStatus: 'vat_payer',
              registeredAddress: {
                street: 'ul. Zakresu 1',
                city: 'Warszawa',
                postalCode: '00-100',
                country: 'PL',
              },
            });
          await em.persistAndFlush([
            organization(OWN_ORGANIZATION_ID, 'A'),
            organization(OTHER_ORGANIZATION_ID, 'B'),
          ]);
          await em.persistAndFlush(
            em.create(CustomerAccount, {
              id: CUSTOMER_ID,
              organizationId: OWN_ORGANIZATION_ID,
              email: `two-sessions-customer-${run}@example.com`,
              passwordHash: 'x'.repeat(60),
              firstName: 'Two',
              lastName: 'Sessions',
              role: 'organization_admin',
              emailVerifiedAt: new Date(),
            }),
          );
          const role = em.create(AdminRole, {
            code: `two_sessions_admin_${run.slice(0, 8)}`,
            name: 'Two sessions admin',
            permissions: ['*'],
          });
          await em.persistAndFlush(role);
          await em.persistAndFlush(
            em.create(AdminUser, {
              id: ADMIN_ID,
              email: `two-sessions-admin-${run}@example.com`,
              passwordHash: 'x'.repeat(60),
              firstName: 'Two',
              lastName: 'Sessions',
              adminRoleId: role.id,
              status: 'active',
            }),
          );

          const connection = em.getConnection();
          const client: PgClient = {
            query: async <Row>(text: string, values: readonly unknown[] = []) => ({
              rows: (await connection.execute(text.replace(/\$\d+/g, '?'), [...values])) as Row[],
            }),
          };
          const channel = await client.query<{ id: string }>(
            'select id from sales_channels order by created_at asc limit 1',
          );
          const salesChannelId = channel.rows[0]!.id;
          ownOrderId = await seedOrder(
            client,
            { organizationId: OWN_ORGANIZATION_ID, customerAccountId: CUSTOMER_ID },
            salesChannelId,
          );
          foreignOrderId = await seedOrder(
            client,
            { organizationId: OTHER_ORGANIZATION_ID, customerAccountId: CUSTOMER_ID },
            salesChannelId,
          );
        },
        { entryPoint: 'cli', container: composition!.container },
      );

      const sessions = composition!.container.cradle['sessionService'] as {
        createSession(input: Record<string, string>): Promise<{ cookieValue: string }>;
      };
      const admin = await sessions.createSession({ kind: 'admin', adminUserId: ADMIN_ID });
      const customer = await sessions.createSession({
        kind: 'customer',
        customerAccountId: CUSTOMER_ID,
      });
      const impersonation = await sessions.createSession({
        kind: 'impersonation',
        customerAccountId: CUSTOMER_ID,
        impersonatorAdminUserId: ADMIN_ID,
      });
      cookies = { b2b_admin_session: admin.cookieValue, b2b_session: customer.cookieValue };
      impersonating = {
        b2b_admin_session: admin.cookieValue,
        b2b_session: impersonation.cookieValue,
      };
    });

    it('reads every organization`s orders on the admin route and the customer`s own on the buyer route', async () => {
      const asAdmin = await orderList('/api/v1/admin/orders?pageSize=100', cookies);
      const asCustomer = await orderList('/api/v1/orders?pageSize=100', cookies);

      expect(asAdmin.status).toBe(200);
      expect(asAdmin.orderIds).toEqual(expect.arrayContaining([ownOrderId, foreignOrderId]));
      expect(asCustomer.status).toBe(200);
      expect(asCustomer.orderIds).toContain(ownOrderId);
      expect(asCustomer.orderIds).not.toContain(foreignOrderId);
    });

    it('reads the same two ways while impersonating', async () => {
      const asAdmin = await orderList('/api/v1/admin/orders?pageSize=100', impersonating);
      const asCustomer = await orderList('/api/v1/orders?pageSize=100', impersonating);

      expect(asAdmin.orderIds).toEqual(expect.arrayContaining([ownOrderId, foreignOrderId]));
      expect(asCustomer.orderIds).toContain(ownOrderId);
      expect(asCustomer.orderIds).not.toContain(foreignOrderId);
    });

    it('re-parents an organization as the admin, and the audit names the admin', async () => {
      for (const [sent, parentId] of [
        [cookies, OWN_ORGANIZATION_ID],
        [impersonating, null],
      ] as const) {
        const since = new Date();

        const response = await app!.inject({
          method: 'POST',
          url: `/api/v1/admin/organizations/${OTHER_ORGANIZATION_ID}/parent`,
          payload: { parentId },
          cookies: sent,
        });

        expect(response.statusCode, response.body).toBe(200);
        const rows = await auditRowsAbout(OTHER_ORGANIZATION_ID, since);
        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows) {
          expect(row.actor_admin_user_id).toBe(ADMIN_ID);
          expect(row.impersonated).toBeNull();
        }
      }
    });

    it('refuses each route to the session it does not accept', async () => {
      const adminRouteAsCustomer = await orderList('/api/v1/admin/orders', {
        b2b_session: cookies.b2b_session,
      });
      const buyerRouteAsAdmin = await orderList('/api/v1/orders', {
        b2b_admin_session: cookies.b2b_admin_session,
      });

      expect(adminRouteAsCustomer.status).toBe(401);
      expect(buyerRouteAsAdmin.status).toBe(401);
    });
  });
});
