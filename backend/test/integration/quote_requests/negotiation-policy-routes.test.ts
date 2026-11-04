import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { ADMIN_COOKIES, CUSTOMER_COOKIES } from '../../helpers/test-actors.js';
import {
  AdminRole,
  AdminUser,
  CustomerAccount,
  Organization,
  OrganizationSalesRepAssignment,
  QuoteRequestAccountPolicy,
  QuoteRequestOrgPolicy,
} from '../../helpers/package-entities.js';
import { setEscapeHatchAuditSink, withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import { bindOrganizationsToFixtureChannelsSql } from '../../helpers/sales-channel-access.js';
import { predefinedRoleIdOf } from '../../helpers/seed-organization-roles.js';

/**
 * Feature 146, Phase 10b (T064) — the admin controls and the storefront read of
 * the price-negotiation lock (FR-020, FR-025 – FR-027; research R12, R13;
 * `contracts/price-negotiation-api.md` §1 – §3, §5; threat model T2, T16, C1;
 * plan I1, I2, I4; coordinator ruling D-3V).
 *
 * Every organization, account and administrator here is this file's own. The
 * shared `sales_representative` role is widened with the two customer codes —
 * the scope keys on that exact role code, and other files do the same
 * (`tenancy/customer-scoped-allowed-set.test.ts`).
 */

const POLICY_SERVICE = 'quoteRequestNegotiationPolicyService';
const LOCK_REASON =
  'quote_requests: negotiation lock for the request owner, read by primary key after the caller authorised the request';
const UNKNOWN_ID = '00000000-0000-4000-8000-0000001461ff';

interface NegotiationPolicy {
  effectiveFor(
    customerAccountId: string,
    em: EntityManager,
  ): Promise<{ allowed: boolean; source: 'account' | 'organization' | 'default' }>;
}

describe('146 — price-negotiation admin and storefront routes [integration]', () => {
  let h: BackendServerHandle;
  const stamp = Date.now();
  const PLATFORM = { b2b_session: 'stub-admin-session' };
  const REP_SESSION = `stub-146-neg-rep-${stamp}`;
  const READER_SESSION = `stub-146-neg-reader-${stamp}`;
  const NONE_SESSION = `stub-146-neg-none-${stamp}`;
  const REP = { b2b_session: REP_SESSION };
  const READER = { b2b_session: READER_SESSION };
  const NONE = { b2b_session: NONE_SESSION };
  const BUYER_SESSION = `stub-146-neg-buyer-${stamp}`;
  const BUYER = { b2b_session: BUYER_SESSION };

  /** Assigned to the representative. */
  let orgA: string;
  /**
   * Assigned to another representative, so it is not "unassigned" — an
   * unassigned organization would be visible to every representative.
   */
  let orgB: string;
  /** A third organization, for the moved account. */
  let orgC: string;
  let customerA: string;
  let customerB: string;
  /** Starts in A, moves to C (M3, D-3L). */
  let movedCustomer: string;
  let repId: string;

  const get = (url: string, cookies: Record<string, string>) =>
    h.app.inject({ method: 'GET', url, cookies });
  const put = (url: string, cookies: Record<string, string>, payload: unknown) =>
    h.app.inject({ method: 'PUT', url, cookies, payload: payload as Record<string, unknown> });

  const orgUrl = (id: string) => `/api/v1/admin/organizations/${id}/quote-price-negotiation`;
  const accountUrl = (id: string) => `/api/v1/admin/customers/${id}/quote-price-negotiation`;
  const STOREFRONT_URL = '/api/v1/quote-requests/price-negotiation';

  /** The refusal body without the per-request correlation id, which always differs. */
  const refusal = (res: { json: () => unknown }): unknown => {
    const { error } = res.json() as { error: Record<string, unknown> };
    const { requestId: _requestId, ...rest } = error;
    return { error: rest };
  };

  const fresh = () => {
    const em = h.orm.em.fork();
    return em;
  };

  const auditsFor = (objectId: string) =>
    withSystemScope('146 T064: read the policy audit rows back', () =>
      fresh().find(
        AuditLogEntry,
        { objectId, action: { $like: 'quote_request_policy.%' } },
        { orderBy: { actedAt: 'asc' } },
      ),
    );

  const orgRow = (organizationId: string) =>
    withSystemScope('146 T064: read the organization policy row back', () =>
      fresh().findOne(QuoteRequestOrgPolicy, { organizationId }),
    );
  const accountRow = (customerAccountId: string) =>
    withSystemScope('146 T064: read the account policy row back', () =>
      fresh().findOne(QuoteRequestAccountPolicy, { customerAccountId }),
    );

  beforeAll(async () => {
    h = await setupBackendServer();
    await withSystemScope('146 T064: seed the negotiation-route tenants', async () => {
      const em = fresh();
      const grants = ['customers:read', 'customers:manage'];
      let repRole = await em.findOne(AdminRole, { code: 'sales_representative' });
      if (!repRole) {
        repRole = em.create(AdminRole, { code: 'sales_representative', name: 'Sales Representative', permissions: grants });
      } else {
        repRole.permissions = Array.from(new Set([...repRole.permissions, ...grants]));
      }
      const readerRole = em.create(AdminRole, {
        code: `neg146_reader_${stamp}`,
        name: 'Feature 146 — customers read only',
        permissions: ['customers:read'],
      });
      const noneRole = em.create(AdminRole, {
        code: `neg146_none_${stamp}`,
        name: 'Feature 146 — no customer codes',
        permissions: ['orders:read'],
      });
      await em.persistAndFlush([repRole, readerRole, noneRole]);

      const organization = (label: string) =>
        em.create(Organization, {
          name: `146 negotiation routes ${label}`,
          taxId: `PL146R${label}${String(stamp).slice(-7)}`,
          status: 'active',
          vatStatus: 'vat_payer',
          registeredAddress: { street: 'ul. Testowa 1', city: 'Warszawa', postalCode: '00-100', country: 'PL' },
        });
      const a = organization('A');
      const b = organization('B');
      const c = organization('C');
      await em.persistAndFlush([a, b, c]);
      orgA = a.id;
      orgB = b.id;
      orgC = c.id;
      // Feature 154 — the three tenants shop on the stores the harness seeds.
      await bindOrganizationsToFixtureChannelsSql(em, [orgA, orgB, orgC]);

      const account = (organizationId: string, label: string) =>
        em.create(CustomerAccount, {
          organizationId,
          email: `146-negr-${label}-${stamp}@neg.local`,
          passwordHash: 'x'.repeat(60),
          firstName: '146',
          lastName: label,
        });
      const ca = account(orgA, 'a');
      const cb = account(orgB, 'b');
      const moved = account(orgA, 'moved');
      await em.persistAndFlush([ca, cb, moved]);
      customerA = ca.id;
      customerB = cb.id;
      movedCustomer = moved.id;

      const admin = (label: string, adminRoleId: string) =>
        em.create(AdminUser, {
          email: `146-negr-${label}-${stamp}@audit.local`,
          passwordHash: 'x'.repeat(60),
          adminRoleId,
          firstName: '146',
          lastName: label,
        });
      const rep = admin('rep', repRole.id);
      const otherRep = admin('other-rep', repRole.id);
      const reader = admin('reader', readerRole.id);
      const none = admin('none', noneRole.id);
      await em.persistAndFlush([rep, otherRep, reader, none]);
      repId = rep.id;
      await em.persistAndFlush([
        em.create(OrganizationSalesRepAssignment, { organizationId: orgA, adminUserId: rep.id }),
        em.create(OrganizationSalesRepAssignment, { organizationId: orgB, adminUserId: otherRep.id }),
        em.create(OrganizationSalesRepAssignment, { organizationId: orgC, adminUserId: otherRep.id }),
      ]);
      ADMIN_COOKIES[REP_SESSION] = { adminUserId: rep.id };
      ADMIN_COOKIES[READER_SESSION] = { adminUserId: reader.id };
      ADMIN_COOKIES[NONE_SESSION] = { adminUserId: none.id };
      CUSTOMER_COOKIES[BUYER_SESSION] = { customerAccountId: customerA, organizationId: orgA };
    });
  });

  afterAll(async () => {
    delete ADMIN_COOKIES[REP_SESSION];
    delete ADMIN_COOKIES[READER_SESSION];
    delete ADMIN_COOKIES[NONE_SESSION];
    delete CUSTOMER_COOKIES[BUYER_SESSION];
    await teardownBackendServer(h);
  });

  describe('organization value (§1)', () => {
    it('answers the default with no row, and the state written by PUT after it', async () => {
      const before = await get(orgUrl(orgA), PLATFORM);
      expect(before.statusCode, before.body).toBe(200);
      expect(before.json()).toEqual({
        data: { organizationId: orgA, priceProposalsAllowed: true, updatedAt: null },
      });

      const written = await put(orgUrl(orgA), PLATFORM, { priceProposalsAllowed: false });
      expect(written.statusCode, written.body).toBe(200);
      const data = (written.json() as { data: { priceProposalsAllowed: boolean; updatedAt: string } }).data;
      expect(data.priceProposalsAllowed).toBe(false);
      expect(typeof data.updatedAt).toBe('string');

      const after = await get(orgUrl(orgA), PLATFORM);
      expect((after.json() as { data: unknown }).data).toEqual(data);
      expect((await orgRow(orgA))?.priceProposalsAllowed).toBe(false);
    });

    it('audits the write with the administrator and old → new, and nothing for an unchanged value (T16)', async () => {
      const audits = await auditsFor(orgA);
      const last = audits.at(-1)!;
      expect(last.action).toBe('quote_request_policy.organization.set');
      expect(last.objectType).toBe('organization');
      expect(last.actorAdminUserId).toBeTruthy();
      expect(last.stateBefore).toEqual({ priceProposalsAllowed: true });
      expect(last.stateAfter).toEqual({ priceProposalsAllowed: false });

      const again = await put(orgUrl(orgA), PLATFORM, { priceProposalsAllowed: false });
      expect(again.statusCode, again.body).toBe(200);
      expect(await auditsFor(orgA)).toHaveLength(audits.length);
    });

    it('a scoped representative writes their own organization (plan I2), audited as themselves', async () => {
      const res = await put(orgUrl(orgA), REP, { priceProposalsAllowed: true });
      expect(res.statusCode, res.body).toBe(200);
      expect((await orgRow(orgA))?.priceProposalsAllowed).toBe(true);
      const last = (await auditsFor(orgA)).at(-1)!;
      expect(last.actorAdminUserId).toBe(repId);
      expect(last.stateBefore).toEqual({ priceProposalsAllowed: false });
      expect(last.stateAfter).toEqual({ priceProposalsAllowed: true });
    });

    it('refuses a representative outside B exactly like an unknown id — GET and PUT, no row, no audit (T2, C1)', async () => {
      const unknownGet = await get(orgUrl(UNKNOWN_ID), PLATFORM);
      const foreignGet = await get(orgUrl(orgB), REP);
      expect(unknownGet.statusCode).toBe(404);
      expect(foreignGet.statusCode).toBe(404);
      expect(refusal(foreignGet)).toEqual(refusal(unknownGet));

      const unknownPut = await put(orgUrl(UNKNOWN_ID), PLATFORM, { priceProposalsAllowed: false });
      const foreignPut = await put(orgUrl(orgB), REP, { priceProposalsAllowed: false });
      expect(unknownPut.statusCode).toBe(404);
      expect(foreignPut.statusCode).toBe(404);
      expect(refusal(foreignPut)).toEqual(refusal(unknownPut));
      expect(refusal(foreignPut)).toEqual(refusal(unknownGet));

      const malformed = await get(orgUrl('not-a-uuid'), PLATFORM);
      expect(malformed.statusCode).toBe(404);
      expect(refusal(malformed)).toEqual(refusal(unknownGet));

      expect(await orgRow(orgB)).toBeNull();
      expect(await auditsFor(orgB)).toEqual([]);
    });

    it('reads with customers:read, writes only with customers:manage', async () => {
      expect((await get(orgUrl(orgA), READER)).statusCode).toBe(200);
      expect((await get(orgUrl(orgA), NONE)).statusCode).toBe(403);
      const refused = await put(orgUrl(orgA), READER, { priceProposalsAllowed: false });
      expect(refused.statusCode).toBe(403);
      expect((await orgRow(orgA))?.priceProposalsAllowed).toBe(true);
    });

    it('refuses an unknown body key (the admin body is strict)', async () => {
      const res = await put(orgUrl(orgA), PLATFORM, { priceProposalsAllowed: false, organizationId: orgB });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('customer-account override (§2)', () => {
    it('walks the three override states with the effective value and its source', async () => {
      // A is allowed (set back by the representative above).
      const initial = await get(accountUrl(customerA), PLATFORM);
      expect(initial.statusCode, initial.body).toBe(200);
      expect(initial.json()).toEqual({
        data: {
          customerAccountId: customerA,
          organizationId: orgA,
          override: 'inherit',
          organizationPriceProposalsAllowed: true,
          effectivePriceProposalsAllowed: true,
          effectiveSource: 'organization',
          updatedAt: null,
        },
      });

      const locked = await put(accountUrl(customerA), PLATFORM, { override: 'not_allowed' });
      expect(locked.statusCode, locked.body).toBe(200);
      expect(locked.json()).toMatchObject({
        data: { override: 'not_allowed', effectivePriceProposalsAllowed: false, effectiveSource: 'account' },
      });

      const allowed = await put(accountUrl(customerA), PLATFORM, { override: 'allowed' });
      expect(allowed.json()).toMatchObject({
        data: { override: 'allowed', effectivePriceProposalsAllowed: true, effectiveSource: 'account' },
      });

      const inherit = await put(accountUrl(customerA), PLATFORM, { override: 'inherit' });
      expect(inherit.json()).toMatchObject({
        data: { override: 'inherit', effectivePriceProposalsAllowed: true, effectiveSource: 'organization' },
      });
      // "As organization" keeps the row and writes null.
      // (`forceUndefined` hydrates a stored null as `undefined`.)
      const row = await accountRow(customerA);
      expect(row).not.toBeNull();
      expect(row?.priceProposalsAllowed ?? null).toBeNull();

      const audits = await auditsFor(customerA);
      expect(audits.map((a) => [a.action, a.objectType, a.stateBefore, a.stateAfter])).toEqual([
        ['quote_request_policy.customer_account.set', 'customer_account', { override: 'inherit' }, { override: 'not_allowed' }],
        ['quote_request_policy.customer_account.set', 'customer_account', { override: 'not_allowed' }, { override: 'allowed' }],
        ['quote_request_policy.customer_account.set', 'customer_account', { override: 'allowed' }, { override: 'inherit' }],
      ]);
      expect(audits.every((a) => typeof a.actorAdminUserId === 'string' && a.actorAdminUserId.length > 0)).toBe(true);
    });

    it('answers the default source when neither row decides', async () => {
      // B has no organization row yet and its customer no override.
      const res = await get(accountUrl(customerB), PLATFORM);
      expect(res.json()).toMatchObject({
        data: { override: 'inherit', effectivePriceProposalsAllowed: true, effectiveSource: 'default' },
      });
    });

    it('follows the account’s current organization after a move (M3, D-3L)', async () => {
      // C locked; A no longer has a row that locks.
      expect((await put(orgUrl(orgC), PLATFORM, { priceProposalsAllowed: false })).statusCode).toBe(200);
      await withSystemScope('146 T064: move the account to organization C', async () => {
        const em = fresh();
        const account = await em.findOneOrFail(CustomerAccount, { id: movedCustomer });
        account.organizationId = orgC;
        // The role moves with the Organization (`specs/170-organization-roles/` WP-02b).
        account.organizationRoleId = await predefinedRoleIdOf(em, orgC, 'member');
        await em.flush();
      });
      const res = await get(accountUrl(movedCustomer), PLATFORM);
      expect(res.json()).toMatchObject({
        data: {
          organizationId: orgC,
          organizationPriceProposalsAllowed: false,
          effectivePriceProposalsAllowed: false,
          effectiveSource: 'organization',
        },
      });
    });

    it('the display read agrees with the enforcement read in every precedence case (D-3V)', async () => {
      const service = h.container.resolve(POLICY_SERVICE) as NegotiationPolicy;
      const parity = async (id: string, source: string) => {
        const shown = (
          (await get(accountUrl(id), PLATFORM)).json() as {
            data: { effectivePriceProposalsAllowed: boolean; effectiveSource: string };
          }
        ).data;
        expect(shown.effectiveSource).toBe(source);
        expect({ allowed: shown.effectivePriceProposalsAllowed, source: shown.effectiveSource }).toEqual(
          await service.effectiveFor(id, fresh()),
        );
      };
      // Default: B has no organization row and its customer no override yet.
      await parity(customerB, 'default');
      // account / organization, both directions of the override.
      expect((await put(accountUrl(customerB), PLATFORM, { override: 'allowed' })).statusCode).toBe(200);
      expect((await put(orgUrl(orgB), PLATFORM, { priceProposalsAllowed: false })).statusCode).toBe(200);
      await parity(customerA, 'organization');
      await parity(customerB, 'account');
      await parity(movedCustomer, 'organization');
      expect((await put(accountUrl(customerB), PLATFORM, { override: 'not_allowed' })).statusCode).toBe(200);
      expect((await put(orgUrl(orgB), PLATFORM, { priceProposalsAllowed: true })).statusCode).toBe(200);
      await parity(customerB, 'account');
      expect((await put(accountUrl(customerB), PLATFORM, { override: 'inherit' })).statusCode).toBe(200);
      await parity(customerB, 'organization');
      expect((await put(orgUrl(orgB), PLATFORM, { priceProposalsAllowed: true })).statusCode).toBe(200);
    });

    it('refuses a representative on a customer of B exactly like an unknown id — GET and PUT, no row, no audit (T2, C1)', async () => {
      const auditsBefore = (await auditsFor(customerB)).length;
      const rowBefore = await accountRow(customerB);

      const unknownGet = await get(accountUrl(UNKNOWN_ID), PLATFORM);
      const foreignGet = await get(accountUrl(customerB), REP);
      expect(unknownGet.statusCode).toBe(404);
      expect(foreignGet.statusCode).toBe(404);
      expect(refusal(foreignGet)).toEqual(refusal(unknownGet));

      const unknownPut = await put(accountUrl(UNKNOWN_ID), PLATFORM, { override: 'not_allowed' });
      const foreignPut = await put(accountUrl(customerB), REP, { override: 'not_allowed' });
      expect(unknownPut.statusCode).toBe(404);
      expect(foreignPut.statusCode).toBe(404);
      expect(refusal(foreignPut)).toEqual(refusal(unknownPut));
      expect(refusal(foreignPut)).toEqual(refusal(unknownGet));

      const malformed = await put(accountUrl('not-a-uuid'), PLATFORM, { override: 'not_allowed' });
      expect(malformed.statusCode).toBe(404);
      expect(refusal(malformed)).toEqual(refusal(unknownGet));

      expect((await accountRow(customerB))?.priceProposalsAllowed ?? null).toBe(rowBefore?.priceProposalsAllowed ?? null);
      expect(await auditsFor(customerB)).toHaveLength(auditsBefore);
    });

    it('a scoped representative writes the override of their own organization’s customer (plan I2)', async () => {
      const res = await put(accountUrl(customerA), REP, { override: 'not_allowed' });
      expect(res.statusCode, res.body).toBe(200);
      expect((await accountRow(customerA))?.priceProposalsAllowed).toBe(false);
      expect((await auditsFor(customerA)).at(-1)?.actorAdminUserId).toBe(repId);
      // Back to "as organization" for the storefront cases below.
      expect((await put(accountUrl(customerA), REP, { override: 'inherit' })).statusCode).toBe(200);
    });

    it('reads with customers:read, writes only with customers:manage', async () => {
      expect((await get(accountUrl(customerA), READER)).statusCode).toBe(200);
      expect((await get(accountUrl(customerA), NONE)).statusCode).toBe(403);
      expect((await put(accountUrl(customerA), READER, { override: 'not_allowed' })).statusCode).toBe(403);
      expect((await put(accountUrl(customerA), PLATFORM, { override: 'maybe' })).statusCode).toBe(400);
    });
  });

  describe('storefront read (§3)', () => {
    it('answers only priceProposalsAllowed, private and uncached, and is not shadowed by /:id (plan I4)', async () => {
      const res = await get(STOREFRONT_URL, BUYER);
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json()).toEqual({ data: { priceProposalsAllowed: true } });
      expect(res.headers['cache-control']).toBe('private, no-store');
    });

    it('follows the signed-in buyer’s effective value and ignores a query naming another account', async () => {
      expect((await put(orgUrl(orgA), PLATFORM, { priceProposalsAllowed: false })).statusCode).toBe(200);
      expect((await get(STOREFRONT_URL, BUYER)).json()).toEqual({ data: { priceProposalsAllowed: false } });

      // B's customer is allowed; asking about them changes nothing.
      const sneaky = await get(`${STOREFRONT_URL}?customerAccountId=${customerB}&organizationId=${orgB}`, BUYER);
      expect(sneaky.statusCode).toBe(200);
      expect(sneaky.json()).toEqual({ data: { priceProposalsAllowed: false } });

      expect((await put(accountUrl(customerA), PLATFORM, { override: 'allowed' })).statusCode).toBe(200);
      expect((await get(STOREFRONT_URL, BUYER)).json()).toEqual({ data: { priceProposalsAllowed: true } });
    });

    it('opens no escape hatch — the enforcement read does, as the control (D-3V)', async () => {
      const records: Array<{ reason: string }> = [];
      const previous = setEscapeHatchAuditSink((record) => {
        records.push(record);
        previous(record);
      });
      try {
        const res = await get(STOREFRONT_URL, BUYER);
        expect(res.statusCode).toBe(200);
        expect(records.filter((r) => r.reason === LOCK_REASON)).toEqual([]);

        // Control: a proposal on create reads the lock in the named system scope.
        const created = await h.app.inject({
          method: 'POST',
          url: '/api/v1/quote-requests',
          cookies: BUYER,
          payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1, desiredUnitPrice: 10 }] },
        });
        expect(created.statusCode, created.body).toBe(201);
        expect(records.filter((r) => r.reason === LOCK_REASON).length).toBeGreaterThan(0);
      } finally {
        setEscapeHatchAuditSink(previous);
      }
    });

    it('requires a customer session', async () => {
      expect((await get(STOREFRONT_URL, {})).statusCode).toBe(401);
    });
  });
});
