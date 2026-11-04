import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { asValue, type Resolver } from 'awilix';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { BuyerLinePricePort } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { CUSTOMER_COOKIES } from '../../helpers/test-actors.js';
import {
  CustomerAccount,
  Organization,
  QuoteRequest,
  QuoteRequestAccountPolicy,
  QuoteRequestItem,
  QuoteRequestOrgPolicy,
} from '../../helpers/package-entities.js';
import { setEscapeHatchAuditSink, withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import { runWithTenantContext, type TenantContext } from '../../../src/tenancy/tenant-context.js';
import { bindOrganizationsToFixtureChannelsSql } from '../../helpers/sales-channel-access.js';
import { moveAccountToOrganization, predefinedRoleIdOf } from '../../helpers/seed-organization-roles.js';

/**
 * Feature 146, Phase 10 (T065, T065a) — the price-negotiation lock, enforced in
 * the writing request for the request's **owner** (FR-020, FR-022 – FR-024,
 * FR-037; research R11; threat model T1, T4, T5; analyze M3, M5; D-3L).
 *
 * The policy rows are seeded directly through the entities: the audited
 * Commands that write them arrive in Phase 10b. Every organization and account
 * here is this file's own, so no row it writes is visible to another file.
 */

/** What the container answers under `quoteRequestNegotiationPolicyService`. */
interface NegotiationPolicy {
  effectiveFor(
    customerAccountId: string,
    em: EntityManager,
  ): Promise<{ allowed: boolean; source: 'account' | 'organization' | 'default' }>;
  assertProposalsAllowed(
    customerAccountId: string,
    lines: ReadonlyArray<{ desiredUnitPrice?: number | null }>,
    em: EntityManager,
  ): Promise<void>;
}

const POLICY_SERVICE = 'quoteRequestNegotiationPolicyService';

/** The module's own shipped sentence, read rather than copied (one source of truth). */
const EN_BUNDLE = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../../packages/modules/quote_requests/i18n/en.json', import.meta.url)),
    'utf8',
  ),
) as Record<string, string>;

describe('146 — price-negotiation lock enforcement [integration]', () => {
  let h: BackendServerHandle;
  const stamp = Date.now();
  const cookies: string[] = [];

  /** Organization L — locked at the organization level. */
  let orgLocked: string;
  /** Organization F — free (no row: the default "allowed"). */
  let orgFree: string;
  /** A third organization, allowed by an explicit row, for the two-organizations PK assertion. */
  let orgOther: string;

  /** In L, no override → locked. */
  let lockedBuyer: string;
  /** In L, override "allowed" (US4 #7a). */
  let overrideAllowed: string;
  /** In F, override "not allowed" (US4 #7b); a regular user. */
  let overrideLocked: string;
  /** In F, an organization administrator, allowed. */
  let adminAllowed: string;
  /** In F, an organization administrator, override "not allowed". */
  let adminLocked: string;
  /** In F, a regular user, allowed. */
  let colleagueAllowed: string;
  /** In O (other), override "allowed", for the PK assertion. */
  let otherBuyer: string;
  /** Moved from L (locked) to F (allowed). */
  let movedToFree: string;
  /** Moved from F (allowed) to L (locked). */
  let movedToLocked: string;

  const cookieOf = (accountId: string) => `stub-146-neg-${accountId}`;

  const newOrganization = (em: EntityManager, suffix: string): Organization =>
    em.create(Organization, {
      name: `146 negotiation org ${suffix}`,
      taxId: `PL146N${suffix}${String(stamp).slice(-7)}`,
      status: 'active',
      vatStatus: 'vat_payer',
      registeredAddress: { street: 'ul. Testowa 1', city: 'Warszawa', postalCode: '00-100', country: 'PL' },
    });

  const newAccount = (
    em: EntityManager,
    organizationId: string,
    key: string,
    /**
     * The *Administrator* role of `organizationId` for an administrator
     * (`specs/170-organization-roles/` WP-05); absent, the account holds
     * *Member*. The legacy `role` is dual-written to match (research R-23).
     */
    administratorRoleId?: string,
  ): CustomerAccount =>
    em.create(CustomerAccount, {
      organizationId,
      email: `146-neg-${key}-${stamp}@neg.local`,
      passwordHash: 'x'.repeat(60),
      firstName: '146',
      lastName: key,
      ...(administratorRoleId ? { organizationRoleId: administratorRoleId } : {}),
    });

  /** Register a stub session for the account, carrying the organization the session was opened in. */
  const signIn = (accountId: string, organizationId: string) => {
    const cookie = cookieOf(accountId);
    CUSTOMER_COOKIES[cookie] = { customerAccountId: accountId, organizationId };
    cookies.push(cookie);
  };

  const create = (accountId: string, items: Array<Record<string, unknown>>) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: { b2b_session: cookieOf(accountId) },
      payload: { items },
    });

  const patch = (accountId: string, id: string, payload: Record<string, unknown>) =>
    h.app.inject({
      method: 'PATCH',
      url: `/api/v1/quote-requests/${id}`,
      cookies: { b2b_session: cookieOf(accountId) },
      payload,
    });

  const idOf = (res: { json: () => unknown }) => (res.json() as { data: { id: string } }).data.id;

  const createOk = async (accountId: string, items: Array<Record<string, unknown>>) => {
    const res = await create(accountId, items);
    expect(res.statusCode, res.body).toBe(201);
    return idOf(res);
  };

  const countRequests = async (customerAccountId: string) => {
    const em = h.em();
    em.clear();
    return em.count(QuoteRequest, { customerAccountId });
  };

  const requestRow = async (id: string) => {
    const em = h.em();
    em.clear();
    return em.findOneOrFail(QuoteRequest, { id });
  };

  const linesOf = async (quoteRequestId: string) => {
    const em = h.em();
    em.clear();
    return em.find(QuoteRequestItem, { quoteRequestId }, { orderBy: { createdAt: 'asc', id: 'asc' } });
  };

  const expectRefusal = (res: { statusCode: number; body: string; json: () => unknown }) => {
    expect(res.statusCode, res.body).toBe(422);
    const { error } = res.json() as { error: { code: string; message: string } };
    expect(error.code).toBe('RFQ_PRICE_PROPOSAL_NOT_ALLOWED');
    // The bundle's sentence, not the raise site's fallback.
    expect(EN_BUNDLE['errors.RFQ_PRICE_PROPOSAL_NOT_ALLOWED']).toBeTruthy();
    expect(error.message).toBe(EN_BUNDLE['errors.RFQ_PRICE_PROPOSAL_NOT_ALLOWED']);
  };

  const policyService = () => h.container.resolve(POLICY_SERVICE) as NegotiationPolicy;

  beforeAll(async () => {
    h = await setupBackendServer();
    await withSystemScope('146 T065: seed the negotiation-lock tenants and their policies', async () => {
      const em = h.orm.em.fork();
      const l = newOrganization(em, 'L');
      const f = newOrganization(em, 'F');
      const o = newOrganization(em, 'O');
      await em.persistAndFlush([l, f, o]);
      orgLocked = l.id;
      orgFree = f.id;
      orgOther = o.id;
      // Feature 154 — the three tenants shop on the stores the harness seeds.
      await bindOrganizationsToFixtureChannelsSql(em, [orgLocked, orgFree, orgOther]);

      const freeAdministrator = await predefinedRoleIdOf(em, orgFree, 'administrator');
      const accounts = {
        lockedBuyer: newAccount(em, orgLocked, 'locked'),
        overrideAllowed: newAccount(em, orgLocked, 'override-allowed'),
        overrideLocked: newAccount(em, orgFree, 'override-locked'),
        adminAllowed: newAccount(em, orgFree, 'admin-allowed', freeAdministrator),
        adminLocked: newAccount(em, orgFree, 'admin-locked', freeAdministrator),
        colleagueAllowed: newAccount(em, orgFree, 'colleague-allowed'),
        otherBuyer: newAccount(em, orgOther, 'other'),
        movedToFree: newAccount(em, orgLocked, 'moved-to-free'),
        movedToLocked: newAccount(em, orgFree, 'moved-to-locked'),
      };
      await em.persistAndFlush(Object.values(accounts));
      lockedBuyer = accounts.lockedBuyer.id;
      overrideAllowed = accounts.overrideAllowed.id;
      overrideLocked = accounts.overrideLocked.id;
      adminAllowed = accounts.adminAllowed.id;
      adminLocked = accounts.adminLocked.id;
      colleagueAllowed = accounts.colleagueAllowed.id;
      otherBuyer = accounts.otherBuyer.id;
      movedToFree = accounts.movedToFree.id;
      movedToLocked = accounts.movedToLocked.id;

      await em.persistAndFlush([
        em.create(QuoteRequestOrgPolicy, { organizationId: orgLocked, priceProposalsAllowed: false }),
        em.create(QuoteRequestOrgPolicy, { organizationId: orgOther, priceProposalsAllowed: true }),
        em.create(QuoteRequestAccountPolicy, { customerAccountId: overrideAllowed, priceProposalsAllowed: true }),
        em.create(QuoteRequestAccountPolicy, { customerAccountId: overrideLocked, priceProposalsAllowed: false }),
        em.create(QuoteRequestAccountPolicy, { customerAccountId: adminLocked, priceProposalsAllowed: false }),
        em.create(QuoteRequestAccountPolicy, { customerAccountId: otherBuyer, priceProposalsAllowed: true }),
        // "As organization", explicitly: the row exists and inherits.
        em.create(QuoteRequestAccountPolicy, { customerAccountId: lockedBuyer, priceProposalsAllowed: null }),
      ]);
    });
    for (const [account, org] of [
      [lockedBuyer, orgLocked],
      [overrideAllowed, orgLocked],
      [overrideLocked, orgFree],
      [adminAllowed, orgFree],
      [adminLocked, orgFree],
      [colleagueAllowed, orgFree],
      [otherBuyer, orgOther],
      [movedToFree, orgLocked],
      [movedToLocked, orgFree],
    ] as const) {
      signIn(account, org);
    }
  }, 60_000);

  afterAll(async () => {
    for (const cookie of cookies) delete CUSTOMER_COOKIES[cookie];
    await teardownBackendServer(h);
  });

  describe('customer create (FR-022, US4 #3)', () => {
    it('a locked customer’s create with a proposal → 422, nothing written', async () => {
      const before = await countRequests(lockedBuyer);
      expectRefusal(await create(lockedBuyer, [{ productId: SEED_PRODUCT_101_ID, quantity: 2, desiredUnitPrice: 90 }]));
      expect(await countRequests(lockedBuyer)).toBe(before);
    });

    it('a proposal of 0.00 counts (T4)', async () => {
      const before = await countRequests(lockedBuyer);
      expectRefusal(await create(lockedBuyer, [{ productId: SEED_PRODUCT_101_ID, quantity: 2, desiredUnitPrice: 0 }]));
      expect(await countRequests(lockedBuyer)).toBe(before);
    });

    it('one proposing line among several is enough', async () => {
      expectRefusal(
        await create(lockedBuyer, [
          { productId: SEED_PRODUCT_101_ID, quantity: 1 },
          { productId: SEED_PRODUCT_101_ID, quantity: 3, desiredUnitPrice: 50 },
        ]),
      );
    });

    it('without a proposal the locked customer’s request is created', async () => {
      const id = await createOk(lockedBuyer, [{ productId: SEED_PRODUCT_101_ID, quantity: 2 }]);
      const [line] = await linesOf(id);
      expect(line?.desiredUnitPrice ?? null).toBeNull();
    });

    it('an account override "allowed" under a locked organization proposes (US4 #7a)', async () => {
      await createOk(overrideAllowed, [{ productId: SEED_PRODUCT_101_ID, quantity: 1, desiredUnitPrice: 80 }]);
    });

    it('an account override "not allowed" under an allowed organization is refused (US4 #7b)', async () => {
      expectRefusal(await create(overrideLocked, [{ productId: SEED_PRODUCT_101_ID, quantity: 1, desiredUnitPrice: 80 }]));
    });

    it('a colleague in the same allowed organization still proposes (two members can differ)', async () => {
      await createOk(colleagueAllowed, [{ productId: SEED_PRODUCT_101_ID, quantity: 1, desiredUnitPrice: 80 }]);
    });
  });

  describe('requests that carry no proposal are never refused (T4, FR-023)', () => {
    it('resubmit succeeds with the lock on', async () => {
      const source = await createOk(lockedBuyer, [{ productId: SEED_PRODUCT_101_ID, quantity: 1 }]);
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/v1/quote-requests/${source}/resubmit`,
        cookies: { b2b_session: cookieOf(lockedBuyer) },
        payload: {},
      });
      expect(res.statusCode, res.body).toBe(201);
    });

    it('cart → quote conversion succeeds with the lock on (US4 #4)', async () => {
      const add = await h.app.inject({
        method: 'POST',
        url: '/api/v1/cart/items',
        cookies: { b2b_session: cookieOf(lockedBuyer) },
        payload: { productId: SEED_PRODUCT_101_ID, quantity: 3 },
      });
      expect(add.statusCode, add.body).toBe(200);
      const convert = await h.app.inject({
        method: 'POST',
        url: '/api/v1/cart/convert-to-quote-request',
        cookies: { b2b_session: cookieOf(lockedBuyer) },
        payload: {},
      });
      expect(convert.statusCode, convert.body).toBe(200);
      const id = (convert.json() as { data: { quoteRequestId: string } }).data.quoteRequestId;
      const [line] = await linesOf(id);
      expect(line?.desiredUnitPrice ?? null).toBeNull();
    });
  });

  describe('customer draft edit (FR-022, FR-037)', () => {
    it('a locked owner’s edit with a proposal → 422, nothing written', async () => {
      const id = await createOk(lockedBuyer, [{ productId: SEED_PRODUCT_101_ID, quantity: 2 }]);
      const before = await requestRow(id);
      expectRefusal(
        await patch(lockedBuyer, id, {
          headerNote: 'should not be written',
          items: [{ productId: SEED_PRODUCT_101_ID, quantity: 5, desiredUnitPrice: 0 }],
        }),
      );
      const after = await requestRow(id);
      expect(after.version).toBe(before.version);
      expect(after.currentRevisionNumber).toBe(before.currentRevisionNumber);
      expect(after.headerNote ?? null).toBeNull();
      const lines = await linesOf(id);
      expect(lines).toHaveLength(1);
      expect(lines[0]?.quantity).toBe(2);
      expect(lines[0]?.desiredUnitPrice ?? null).toBeNull();
    });

    it('a refused edit asks price_lists nothing — the lock is checked before pricing (review fix N9)', async () => {
      const id = await createOk(lockedBuyer, [{ productId: SEED_PRODUCT_101_ID, quantity: 2 }]);
      const original = h.container.registrations['buyerLinePricePort'] as Resolver<unknown>;
      const real = h.container.resolve('buyerLinePricePort') as BuyerLinePricePort;
      let asked = 0;
      h.container.register({
        buyerLinePricePort: asValue({
          resolveForBuyer: async (query: Parameters<BuyerLinePricePort['resolveForBuyer']>[0]) => {
            asked += 1;
            return real.resolveForBuyer(query);
          },
        }),
      });
      try {
        expectRefusal(
          await patch(lockedBuyer, id, {
            items: [{ productId: SEED_PRODUCT_101_ID, quantity: 5, desiredUnitPrice: 3 }],
          }),
        );
        expect(asked).toBe(0);
        // The counting port is the one an accepted edit asks — otherwise the
        // zero above proves nothing.
        const accepted = await patch(lockedBuyer, id, {
          items: [{ productId: SEED_PRODUCT_101_ID, quantity: 5 }],
        });
        expect(accepted.statusCode, accepted.body).toBe(200);
        expect(asked).toBe(1);
      } finally {
        h.container.register('buyerLinePricePort', original);
      }
    });

    it('an accepted edit carrying a proposal opens the lock’s system scope once — one escape-hatch audit record (review fix round 1, part B)', async () => {
      const id = await createOk(colleagueAllowed, [{ productId: SEED_PRODUCT_101_ID, quantity: 2 }]);
      const lockReads: string[] = [];
      const previous = setEscapeHatchAuditSink((record) => {
        if (record.reason.startsWith('quote_requests: negotiation lock')) lockReads.push(record.reason);
        previous(record);
      });
      try {
        const res = await patch(colleagueAllowed, id, {
          items: [{ productId: SEED_PRODUCT_101_ID, quantity: 3, desiredUnitPrice: 9 }],
        });
        expect(res.statusCode, res.body).toBe(200);
      } finally {
        setEscapeHatchAuditSink(previous);
      }
      // The pre-check before pricing is a display read in the caller's scope;
      // only the authoritative check inside the row lock opens the system scope.
      expect(lockReads).toHaveLength(1);
    });

    it('existing proposals are untouched by a lock, and an edit omitting them keeps them (US4 #5, T5, FR-024)', async () => {
      // Raised while the account was allowed, then locked.
      const id = await createOk(colleagueAllowed, [{ productId: SEED_PRODUCT_101_ID, quantity: 2, desiredUnitPrice: 77 }]);
      await withSystemScope('146 T065: lock an account after it proposed', async () => {
        const em = h.orm.em.fork();
        em.create(QuoteRequestAccountPolicy, { customerAccountId: colleagueAllowed, priceProposalsAllowed: false });
        await em.flush();
      });
      try {
        const [stored] = await linesOf(id);
        expect(stored?.desiredUnitPrice).toBe('77.0000');

        const res = await patch(colleagueAllowed, id, {
          headerNote: 'more pieces',
          items: [{ productId: SEED_PRODUCT_101_ID, quantity: 4 }],
        });
        expect(res.statusCode, res.body).toBe(200);
        const [line] = await linesOf(id);
        expect(line?.quantity).toBe(4);
        expect(line?.desiredUnitPrice).toBe('77.0000');

        // A header-only edit carries no lines at all.
        const headerOnly = await patch(colleagueAllowed, id, { headerNote: 'note only' });
        expect(headerOnly.statusCode, headerOnly.body).toBe(200);
      } finally {
        await withSystemScope('146 T065: unlock the account again', async () => {
          const em = h.orm.em.fork();
          const row = await em.findOneOrFail(QuoteRequestAccountPolicy, { customerAccountId: colleagueAllowed });
          await em.removeAndFlush(row);
        });
      }
    });

    it('organization administrator B (allowed) editing locked colleague A’s draft with a proposal → 422 (US4 #7d, T1)', async () => {
      const id = await createOk(overrideLocked, [{ productId: SEED_PRODUCT_101_ID, quantity: 2 }]);
      const before = await requestRow(id);
      expectRefusal(
        await patch(adminAllowed, id, { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 2, desiredUnitPrice: 60 }] }),
      );
      expect((await requestRow(id)).version).toBe(before.version);
      // The same administrator without a proposal is let through.
      const plain = await patch(adminAllowed, id, { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 3 }] });
      expect(plain.statusCode, plain.body).toBe(200);
    });

    it('locked administrator B proposing on an allowed colleague’s draft succeeds (US4 #7d, T13)', async () => {
      const id = await createOk(colleagueAllowed, [{ productId: SEED_PRODUCT_101_ID, quantity: 2 }]);
      const res = await patch(adminLocked, id, {
        items: [{ productId: SEED_PRODUCT_101_ID, quantity: 2, desiredUnitPrice: 61 }],
      });
      expect(res.statusCode, res.body).toBe(200);
      const [line] = await linesOf(id);
      expect(line?.desiredUnitPrice).toBe('61.0000');
    });
  });

  describe('the administrator side is unaffected (US4 #6, FR-024)', () => {
    const admin = { b2b_session: 'stub-admin-session' };

    it('admin create and modify for a locked customer succeed', async () => {
      const created = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/quote-requests',
        cookies: admin,
        payload: {
          organizationId: orgLocked,
          customerAccountId: lockedBuyer,
          items: [{ productId: SEED_PRODUCT_101_ID, quantity: 2, agreedUnitPrice: 10 }],
        },
      });
      expect(created.statusCode, created.body).toBe(201);
      const { id, version } = (created.json() as { data: { id: string; version: number } }).data;
      const modified = await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/quote-requests/${id}`,
        cookies: admin,
        headers: { 'if-match': `"${version}"` },
        payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 3, agreedUnitPrice: 9 }] },
      });
      expect(modified.statusCode, modified.body).toBe(200);
    });
  });

  describe('an unreadable lock fails the request (M5)', () => {
    const withUnreadableLock = async (run: () => Promise<void>) => {
      const original = h.container.registrations[POLICY_SERVICE] as Resolver<unknown>;
      const real = policyService();
      const broken: NegotiationPolicy = Object.create(real as object) as NegotiationPolicy;
      broken.effectiveFor = async () => {
        throw new Error('policy table read failed (test)');
      };
      h.container.register({ [POLICY_SERVICE]: asValue(broken) });
      try {
        await run();
      } finally {
        h.container.register({ [POLICY_SERVICE]: original });
      }
    };

    it('create with a proposal → 5xx, nothing written; without a proposal → created', async () => {
      await withUnreadableLock(async () => {
        const before = await countRequests(colleagueAllowed);
        const refused = await create(colleagueAllowed, [{ productId: SEED_PRODUCT_101_ID, quantity: 1, desiredUnitPrice: 5 }]);
        expect(refused.statusCode, refused.body).toBeGreaterThanOrEqual(500);
        expect(await countRequests(colleagueAllowed)).toBe(before);

        await createOk(colleagueAllowed, [{ productId: SEED_PRODUCT_101_ID, quantity: 1 }]);
        expect(await countRequests(colleagueAllowed)).toBe(before + 1);
      });
    });

    it('draft edit with a proposal → 5xx, nothing written', async () => {
      const id = await createOk(colleagueAllowed, [{ productId: SEED_PRODUCT_101_ID, quantity: 2 }]);
      const before = await requestRow(id);
      await withUnreadableLock(async () => {
        const refused = await patch(colleagueAllowed, id, {
          items: [{ productId: SEED_PRODUCT_101_ID, quantity: 7, desiredUnitPrice: 5 }],
        });
        expect(refused.statusCode, refused.body).toBeGreaterThanOrEqual(500);
      });
      expect((await requestRow(id)).version).toBe(before.version);
      const [line] = await linesOf(id);
      expect(line?.quantity).toBe(2);
    });
  });

  describe('tenant-blind reads (T1, M3, T065a)', () => {
    const buyerOfOther = (): TenantContext => ({
      mode: 'single-org',
      organizationId: orgOther,
      customerAccountId: otherBuyer,
      actor: { kind: 'customer', id: otherBuyer },
    });
    const repNotOfLocked = (): TenantContext => ({
      mode: 'allowed-set',
      allowedOrganizationIds: [orgFree],
      actor: { kind: 'admin', id: `146-neg-rep-${stamp}` },
    });

    const effectiveIn = (ctx: TenantContext, accountId: string) =>
      runWithTenantContext(ctx, () => policyService().effectiveFor(accountId, h.orm.em.fork() as EntityManager));

    it('a locked organization row reads as locked from a context the filter would exclude it from', async () => {
      // Control: the filter really does hide the row in this context, so the
      // assertion below is about the system-scoped read and not a pass-through.
      const hidden = await runWithTenantContext(buyerOfOther(), () =>
        (h.orm.em.fork() as EntityManager).findOne(QuoteRequestOrgPolicy, { organizationId: orgLocked }),
      );
      expect(hidden).toBeNull();

      expect(await effectiveIn(buyerOfOther(), lockedBuyer)).toEqual({ allowed: false, source: 'organization' });
      expect(await effectiveIn(repNotOfLocked(), lockedBuyer)).toEqual({ allowed: false, source: 'organization' });
    });

    it('a locked account row reads as locked from a context the filter would exclude it from', async () => {
      expect(await effectiveIn(buyerOfOther(), overrideLocked)).toEqual({ allowed: false, source: 'account' });
      expect(await effectiveIn({ ...repNotOfLocked(), allowedOrganizationIds: [orgOther] }, overrideLocked)).toEqual({
        allowed: false,
        source: 'account',
      });
    });

    it('reads each policy row by its primary key only, with two organizations’ rows present', async () => {
      const em = h.orm.em.fork() as EntityManager;
      const findOne = vi.spyOn(em, 'findOne');
      const answer = await runWithTenantContext(buyerOfOther(), () => policyService().effectiveFor(lockedBuyer, em));
      expect(answer).toEqual({ allowed: false, source: 'organization' });
      const policyReads = findOne.mock.calls
        .filter(([entity]) => entity === QuoteRequestAccountPolicy || entity === QuoteRequestOrgPolicy)
        .map(([entity, where]) => [entity === QuoteRequestAccountPolicy ? 'account' : 'organization', where]);
      expect(policyReads).toEqual([
        ['account', { customerAccountId: lockedBuyer }],
        ['organization', { organizationId: orgLocked }],
      ]);
    });

    it('moved account: from a locked organization to an allowed one, its old draft follows the new one (D-3L)', async () => {
      const id = await createOk(movedToFree, [{ productId: SEED_PRODUCT_101_ID, quantity: 2 }]);
      expect((await requestRow(id)).organizationId).toBe(orgLocked);
      // The role moves with the Organization (`specs/170-organization-roles/` WP-02b).
      await moveAccountToOrganization(h.em(), movedToFree, orgFree);
      // The session still names the organization it was opened in, which is the draft's stamp.
      const res = await patch(movedToFree, id, {
        items: [{ productId: SEED_PRODUCT_101_ID, quantity: 2, desiredUnitPrice: 70 }],
      });
      expect(res.statusCode, res.body).toBe(200);
    });

    it('moved account: from an allowed organization to a locked one, its old draft is refused (D-3L)', async () => {
      const id = await createOk(movedToLocked, [{ productId: SEED_PRODUCT_101_ID, quantity: 2 }]);
      expect((await requestRow(id)).organizationId).toBe(orgFree);
      // The role moves with the Organization (`specs/170-organization-roles/` WP-02b).
      await moveAccountToOrganization(h.em(), movedToLocked, orgLocked);
      expectRefusal(
        await patch(movedToLocked, id, { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 2, desiredUnitPrice: 70 }] }),
      );
    });
  });
});
