import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LightMyRequestResponse } from 'fastify';
import {
  AdminRole,
  AdminUser,
  Address,
  OrganizationSalesRepAssignment,
} from '../../helpers/package-entities.js';
import {
  ADMIN_COOKIES,
  OTHER_TEST_ORGANIZATION_ID,
  TEST_ORGANIZATION_ID,
} from '../../helpers/test-actors.js';
import { seedOtherTestOrganization } from '../../helpers/seed-organizations.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import {
  runWithTenantContext,
  type TenantContext,
} from '../../../src/tenancy/tenant-context.js';

/**
 * D-260/A — the tenant guard authors **writes** at the flush boundary.
 *
 * Host-owned under D-252: it composes a server, so it travels with the host
 * rather than into the package — and it deliberately proves a *platform*
 * property through a *module's* route, because the five payment gateways are
 * feature 134 wave 2 and D-260/A repairs them with no module edit at all.
 *
 * ## What is being proved
 *
 * `@OrgScoped()` attaches a MikroORM global filter, and MikroORM applies a
 * filter to `SELECT` / `UPDATE` / `DELETE` and **not to `INSERT`**
 * (`specs/087-tenant-scope-enforcement/r1-spike.md` §4). So a classification
 * buys a narrowed read and nothing on the write side, and
 * `stripe/…/method-rule.command.ts` composes the two halves into an
 * escalation: the narrowed read makes org B's deny row look *absent*, and the
 * unfiltered insert creates it. Measured on
 * `feat/d-259-payment-method-orgdisable-org-scoped`: a `sales_representative`
 * assigned only to org A submitted `[orgA, orgB]`, was answered **200**, and
 * org B's deny row was created.
 *
 * ## Why every assertion goes through a route
 *
 * `test/tenancy-setup.ts` is a suite-wide `setupFiles` entry that enters
 * `HARNESS_DEFAULT_SCOPE` (`mode: 'system'`) in a global `beforeAll` **and**
 * `beforeEach`, so `orgFilterCond()` returns `{}` and a direct-EM assertion in
 * this suite is blind to a tenant-scope failure by construction — D-259, and
 * `test/tenancy-setup.ts`'s own header, which states the default it enters and
 * says in as many words that the request pipeline is what nests a real scoped
 * context over it. Every write below is therefore issued by `app.inject` under a
 * real scoped session, and the only direct read is the survival check — which
 * runs against the raw connection precisely because no filter and no ambient
 * scope can flatter it.
 */

const METHOD_CODE = 'stripe_card_d260a_write_guard';
const LIST_URL = '/api/v1/admin/stripe/methods';

interface MethodListBody {
  data: {
    methods: Array<{ id: string; code: string; disabledOrganizationIds: string[] }>;
  };
}

/**
 * One composed server for the whole file, not one per `describe`.
 *
 * `setupBackendServer` composes a Fastify app, the ORM singleton, two ioredis
 * clients and the module container, and the suite runs in a single fork — so a
 * second boot in one file is a second set of all five for the length of the
 * file. The two blocks below ask different questions of the *same* platform, so
 * they share it.
 */
let h: BackendServerHandle;

beforeAll(async () => {
  h = await setupBackendServer();
  await withSystemScope('seed the second organization both blocks below need', async () => {
    await seedOtherTestOrganization(h.em());
  });
}, 60_000);

afterAll(async () => {
  await teardownBackendServer(h);
});

describe('D-260/A — a write carrying a foreign organization is refused at flush [integration]', () => {
  let methodId = '';
  let scopedCookie = '';
  /** The measured escalation, issued once in `beforeAll` and asserted twice below. */
  let foreignWrite: LightMyRequestResponse;
  const platformAdmin = { cookies: { b2b_session: 'stub-admin-session' } };

  /**
   * The deny rows that exist, read off the connection rather than the ORM.
   *
   * A raw statement carries no global filter and reads no ambient context, so
   * this answer cannot be widened or narrowed by the harness's `system` scope —
   * which is the one property the assertions need and the one the EM cannot
   * offer here. The `withSystemScope` wrapper is kept because the *intent* is a
   * declared cross-organization read (FR-005/FR-013) and a future author
   * replacing the statement with an `em.count` must not have to rediscover that.
   */
  const denyRowsFor = async (paymentMethodId: string): Promise<string[]> =>
    withSystemScope('D-260/A proof: read every organization’s deny row', async () => {
      const rows = await h
        .em()
        .getConnection()
        .execute<Array<{ organization_id: string }>>(
          'select organization_id from stripe_payment_method_org_disables where payment_method_id = ?',
          [paymentMethodId],
        );
      return rows.map((r) => r.organization_id).sort();
    });

  const disabledFor = async (
    cookies: { cookies: { b2b_session: string } },
  ): Promise<string[]> => {
    const listed = await h.app.inject({ method: 'GET', url: LIST_URL, ...cookies });
    expect(listed.statusCode, listed.body).toBe(200);
    const row = (listed.json() as MethodListBody).data.methods.find((m) => m.id === methodId);
    expect(row, `${METHOD_CODE} must be listed`).toBeDefined();
    return row!.disabledOrganizationIds;
  };

  beforeAll(async () => {
    // Production seeds this row from the gateway's own migration; the harness
    // truncates `payment_methods` between files, so the fixture is created here
    // rather than read out of a table that may no longer hold it.
    const created = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/payment-methods/${METHOD_CODE}`,
      ...platformAdmin,
      payload: {
        name: { default: 'Stripe card (D-260/A write-guard fixture)' },
        kind: 'gateway',
        adapter: 'stripe',
        status: 'active',
      },
    });
    expect(created.statusCode, created.body).toBe(200);
    methodId = (created.json() as { data: { id: string } }).data.id;

    await withSystemScope('seed a stripe writer scoped to org A only', async () => {
      const em = h.em();

      let role = await em.findOne(AdminRole, { code: 'sales_representative' });
      if (!role) {
        role = em.create(AdminRole, {
          code: 'sales_representative',
          name: 'Sales Representative',
          permissions: ['stripe:read', 'stripe:write'],
        });
      } else {
        const missing = ['stripe:read', 'stripe:write'].filter(
          (code) => !role!.permissions.includes(code),
        );
        if (missing.length > 0) role.permissions = [...role.permissions, ...missing];
      }
      await em.persistAndFlush(role);

      const rep = em.create(AdminUser, {
        email: `d260a-write-guard-${Date.now()}@i.local`,
        passwordHash: 'x'.repeat(60),
        adminRoleId: role.id,
        firstName: 'D260A',
        lastName: 'WriteGuard',
      });
      await em.persistAndFlush(rep);
      await em.persistAndFlush(
        em.create(OrganizationSalesRepAssignment, {
          organizationId: TEST_ORGANIZATION_ID,
          adminUserId: rep.id,
        }),
      );
      scopedCookie = `stub-d260a-write-guard-${Date.now()}`;
      ADMIN_COOKIES[scopedCookie] = { adminUserId: rep.id };
    });

    // No deny row exists yet, so org B's presence afterwards can only have been
    // created by the request below. The measured escalation, verbatim.
    expect(await denyRowsFor(methodId)).toEqual([]);
    foreignWrite = await h.app.inject({
      method: 'PUT',
      url: `${LIST_URL}/${methodId}`,
      cookies: { b2b_session: scopedCookie },
      payload: {
        disabledOrganizationIds: [TEST_ORGANIZATION_ID, OTHER_TEST_ORGANIZATION_ID],
      },
    });
  }, 60_000);

  it('refuses a scoped admin the row it named for an organization outside its scope', async () => {
    expect(foreignWrite.statusCode, foreignWrite.body).not.toBe(200);
    // The backstop mapping (D-260/A step A4): 403 and deliberately not 404 —
    // see the reasoning written at the mapping in `http/error-envelope.ts`.
    expect(foreignWrite.statusCode, foreignWrite.body).toBe(403);
    expect((foreignWrite.json() as { error: { code: string } }).error.code).toBe('FORBIDDEN');
    // It names no organization, neither the one refused nor the actor's set.
    expect(foreignWrite.body).not.toContain(OTHER_TEST_ORGANIZATION_ID);
    expect(foreignWrite.body).not.toContain(TEST_ORGANIZATION_ID);

    // Loud **and complete** (087 §2.2): the subscriber throws inside
    // `em.transactional`, so the Command Bus's single transaction rolls back
    // whole — no org B row, and no org A row either, because a refused write
    // leaves nothing half-applied.
    expect(await denyRowsFor(methodId)).toEqual([]);
  });

  it('does not report the refusal as a lost race (corollary 1: never 409 VERSION_CONFLICT)', () => {
    expect(foreignWrite.statusCode, foreignWrite.body).not.toBe(409);
    const code = (foreignWrite.json() as { error?: { code?: string } }).error?.code;
    expect(code, foreignWrite.body).not.toBe('VERSION_CONFLICT');
  });

  it('still lets the same scoped admin write for its own organization [the narrowing is not a ban]', async () => {
    const own = await h.app.inject({
      method: 'PUT',
      url: `${LIST_URL}/${methodId}`,
      cookies: { b2b_session: scopedCookie },
      payload: { disabledOrganizationIds: [TEST_ORGANIZATION_ID] },
    });
    expect(own.statusCode, own.body).toBe(200);
    expect(await denyRowsFor(methodId)).toEqual([TEST_ORGANIZATION_ID]);
    expect(await disabledFor({ cookies: { b2b_session: scopedCookie } })).toEqual([
      TEST_ORGANIZATION_ID,
    ]);
  });

  it('still lets a platform admin write both organizations [the widening must not be lost]', async () => {
    const both = await h.app.inject({
      method: 'PUT',
      url: `${LIST_URL}/${methodId}`,
      ...platformAdmin,
      payload: {
        disabledOrganizationIds: [TEST_ORGANIZATION_ID, OTHER_TEST_ORGANIZATION_ID],
      },
    });
    expect(both.statusCode, both.body).toBe(200);
    expect(await denyRowsFor(methodId)).toEqual(
      [TEST_ORGANIZATION_ID, OTHER_TEST_ORGANIZATION_ID].sort(),
    );
    expect(await disabledFor(platformAdmin)).toEqual(
      expect.arrayContaining([TEST_ORGANIZATION_ID, OTHER_TEST_ORGANIZATION_ID]),
    );
  });
});

/**
 * The same guard at the flush boundary itself, in a context this block
 * establishes rather than one a route derived.
 *
 * The block above is the product proof and goes through a real route with a real
 * scoped session. This one is the *mechanism* proof, and it exists because one
 * of the two things the guard catches has no route to go through: the
 * **cross-organization move**, `organizationId = B` on a row legitimately loaded
 * under org A. The read filter cannot see that write at all — the row was
 * visible when it was loaded — so no read-side repair reaches it, and
 * `beforeUpdate` is the only place it is visible.
 *
 * It is explicit about the trap the suite sets: `test/tenancy-setup.ts` enters
 * `mode: 'system'` in a global `beforeAll` **and** `beforeEach`, under which
 * `isOrgInScope` answers `true` for everything and every assertion here would
 * pass while proving nothing. Every flush below therefore runs inside
 * `runWithTenantContext(scopedToOrgA, …)`, and the two non-refusal cases are
 * here to prove the block is not passing because the flush fails for some
 * unrelated reason.
 */
describe('D-260/A — the same refusal at the flush boundary, in an explicit scoped context [integration]', () => {
  /** What a `sales_representative` assigned only to org A resolves to. */
  const scopedToOrgA: TenantContext = {
    mode: 'allowed-set',
    allowedOrganizationIds: [TEST_ORGANIZATION_ID],
    actor: { kind: 'admin', id: 'd260a-flush-boundary' },
  };

  const addressFor = (organizationId: string) => ({
    organizationId,
    kind: 'delivery' as const,
    recipientName: 'D-260/A',
    street: 'ul. Testowa 1',
    city: 'Warszawa',
    postalCode: '00-001',
    country: 'PL',
  });

  /** The organization a row actually holds, off the connection and past every filter. */
  const storedOrganizationOf = async (addressId: string): Promise<string | undefined> => {
    const rows = await h
      .em()
      .getConnection()
      .execute<Array<{ organization_id: string }>>(
        'select organization_id from addresses where id = ?',
        [addressId],
      );
    return rows[0]?.organization_id;
  };

  it('refuses an INSERT carrying an organization outside the ambient scope', async () => {
    await runWithTenantContext(scopedToOrgA, async () => {
      const em = h.orm.em.fork();
      em.persist(em.create(Address, addressFor(OTHER_TEST_ORGANIZATION_ID)));
      await expect(em.flush()).rejects.toThrow(/outside the active tenant scope/);
    });
  });

  it('allows the same INSERT for an organization inside it [not a ban on writing]', async () => {
    const id = await runWithTenantContext(scopedToOrgA, async () => {
      const em = h.orm.em.fork();
      const row = em.create(Address, addressFor(TEST_ORGANIZATION_ID));
      await em.persistAndFlush(row);
      return row.id;
    });
    expect(await storedOrganizationOf(id)).toBe(TEST_ORGANIZATION_ID);
  });

  it('refuses the cross-organization MOVE, which no read filter can see', async () => {
    const id = await runWithTenantContext(scopedToOrgA, async () => {
      const em = h.orm.em.fork();
      const row = em.create(Address, addressFor(TEST_ORGANIZATION_ID));
      await em.persistAndFlush(row);
      return row.id;
    });

    await runWithTenantContext(scopedToOrgA, async () => {
      const em = h.orm.em.fork();
      // A perfectly legitimate read: the row is org A's and the filter grants it.
      const row = await em.findOneOrFail(Address, { id });
      row.organizationId = OTHER_TEST_ORGANIZATION_ID;
      await expect(em.flush()).rejects.toThrow(/outside the active tenant scope/);
    });

    expect(await storedOrganizationOf(id)).toBe(TEST_ORGANIZATION_ID);
  });

  it('leaves a system-scoped write alone [`system` and `all` answer permitted trivially]', async () => {
    const id = await withSystemScope('D-260/A: the sanctioned cross-organization write', async () => {
      const em = h.orm.em.fork();
      const row = em.create(Address, addressFor(OTHER_TEST_ORGANIZATION_ID));
      await em.persistAndFlush(row);
      return row.id;
    });
    expect(await storedOrganizationOf(id)).toBe(OTHER_TEST_ORGANIZATION_ID);
  });
});
