import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { ADMIN_COOKIES } from '../../helpers/test-actors.js';
import { bindOrganizationToDefaultChannel } from '../../helpers/sales-channel-access.js';
import {
  AdminRole,
  AdminUser,
  CustomerAccount,
  Organization,
  OrganizationSalesRepAssignment,
} from '../../helpers/package-entities.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';

/**
 * Feature 146, QA — a sales representative's reach over every route this
 * feature added or reshaped, including the organization nobody is assigned to.
 */
describe('146 — sales representative scope [integration]', () => {
  let h: BackendServerHandle;
  const stamp = Date.now();
  const PLATFORM = { b2b_session: 'stub-admin-session' };
  const REP_SESSION = `stub-146-scope-rep-${stamp}`;
  const REP = { b2b_session: REP_SESSION };
  const UNKNOWN_ID = '00000000-0000-4000-8000-0000001462ff';

  let accountOwn: string;
  let orgOwnId: string;
  let orgForeign: string;
  let orgUnassigned: string;
  let accountForeign: string;
  let accountUnassigned: string;
  let rfqOwn: string;
  let rfqForeign: string;
  let rfqUnassigned: string;
  let otherRepId: string;

  const errorOf = (res: { json: () => unknown }) => {
    const { error } = res.json() as { error: Record<string, unknown> };
    const { requestId: _r, ...rest } = error;
    return rest;
  };
  const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, cookies: Record<string, string>, payload?: unknown) =>
    h.app.inject({
      method,
      url,
      cookies,
      headers: { 'if-match': '"1"' },
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });

  beforeAll(async () => {
    h = await setupBackendServer();
    await withSystemScope('146 QA: seed the representative-scope tenants', async () => {
      const em = h.orm.em.fork();
      const grants = ['rfqs:handle', 'customers:read', 'customers:manage', 'price_lists:read'];
      let role = await em.findOne(AdminRole, { code: 'sales_representative' });
      if (!role) {
        role = em.create(AdminRole, { code: 'sales_representative', name: 'Sales Representative', permissions: grants });
      } else {
        role.permissions = Array.from(new Set([...role.permissions, ...grants]));
      }
      await em.persistAndFlush(role);
      const org = (label: string) =>
        em.create(Organization, {
          name: `146 scope ${label}`,
          taxId: `PL146S${label}${String(stamp).slice(-7)}`,
          status: 'active',
          vatStatus: 'vat_payer',
          registeredAddress: { street: 'ul. Testowa 1', city: 'Warszawa', postalCode: '00-100', country: 'PL' },
        });
      const own = org('O');
      const foreign = org('F');
      const unassigned = org('U');
      await em.persistAndFlush([own, foreign, unassigned]);
      orgOwnId = own.id;
      orgForeign = foreign.id;
      orgUnassigned = unassigned.id;
      const admin = (label: string) =>
        em.create(AdminUser, {
          email: `146-scope-${label}-${stamp}@scope.local`,
          passwordHash: 'x'.repeat(60),
          adminRoleId: role.id,
          firstName: '146',
          lastName: label,
        });
      const rep = admin('rep');
      const otherRep = admin('other');
      await em.persistAndFlush([rep, otherRep]);
      otherRepId = otherRep.id;
      await em.persistAndFlush([
        em.create(OrganizationSalesRepAssignment, { organizationId: own.id, adminUserId: rep.id }),
        em.create(OrganizationSalesRepAssignment, { organizationId: foreign.id, adminUserId: otherRep.id }),
      ]);
      const account = (organizationId: string, label: string) =>
        em.create(CustomerAccount, {
          organizationId,
          email: `146-scope-${label}-${stamp}@scope.local`,
          passwordHash: 'x'.repeat(60),
          firstName: '146',
          lastName: label,
        });
      const aOwn = account(own.id, 'own');
      const aForeign = account(foreign.id, 'foreign');
      const aUnassigned = account(unassigned.id, 'unassigned');
      await em.persistAndFlush([aOwn, aForeign, aUnassigned]);
      accountOwn = aOwn.id;
      accountForeign = aForeign.id;
      accountUnassigned = aUnassigned.id;
      ADMIN_COOKIES[REP_SESSION] = { adminUserId: rep.id };
    });
    const raise = async (organizationId: string, customerAccountId: string): Promise<string> => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/quote-requests',
        cookies: PLATFORM,
        payload: {
          organizationId,
          customerAccountId,
          items: [{ productId: SEED_PRODUCT_101_ID, quantity: 2, agreedUnitPrice: 10 }],
        },
      });
      expect(res.statusCode, res.body).toBe(201);
      return (res.json() as { data: { id: string } }).data.id;
    };
    // `raise` names no channel, so each request is raised on the system default,
    // which `createOnBehalf` accepts only for an Organization assigned to it
    // (feature 163, owner decision 2026-10-29 "A").
    for (const organizationId of [orgOwnId, orgForeign, orgUnassigned]) {
      await bindOrganizationToDefaultChannel(h, organizationId);
    }
    rfqOwn = await raise(orgOwnId, accountOwn);
    rfqForeign = await raise(orgForeign, accountForeign);
    rfqUnassigned = await raise(orgUnassigned, accountUnassigned);
  }, 90_000);

  afterAll(async () => {
    delete ADMIN_COOKIES[REP_SESSION];
    await teardownBackendServer(h);
  });

  it('a representative outside the request\'s organization gets one 404 on every admin RFQ route (C1)', async () => {
    const attempts = (id: string) =>
      [
        ['GET', `/api/v1/admin/quote-requests/${id}`, undefined],
        ['GET', `/api/v1/admin/quote-requests/${id}/history`, undefined],
        ['POST', `/api/v1/admin/quote-requests/${id}/approve`, {}],
        ['POST', `/api/v1/admin/quote-requests/${id}/cancel`, {}],
        ['POST', `/api/v1/admin/quote-requests/${id}/assign`, { adminUserId: otherRepId }],
        [
          'PATCH',
          `/api/v1/admin/quote-requests/${id}`,
          { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 3, agreedUnitPrice: 9 }] },
        ],
      ] as const;
    const snapshot = async () => {
      const d = (await call('GET', `/api/v1/admin/quote-requests/${rfqForeign}`, PLATFORM)).json() as {
        data: { version: number; status: string; currentRevisionNumber: number; events: unknown[] };
      };
      return { v: d.data.version, s: d.data.status, r: d.data.currentRevisionNumber, e: d.data.events.length };
    };
    const before = await snapshot();
    const seen: string[] = [];
    for (const [i, [method, , payload]] of attempts(UNKNOWN_ID).entries()) {
      const unknown = await call(method, attempts(UNKNOWN_ID)[i]![1], REP, payload);
      const foreign = await call(method, attempts(rfqForeign)[i]![1], REP, payload);
      seen.push(`${method} ${attempts(rfqForeign)[i]![1].replace(rfqForeign, ':id')} → ${foreign.statusCode}/${unknown.statusCode}`);
      expect(unknown.statusCode, `unknown ${seen.at(-1)}`).toBe(404);
      expect(foreign.statusCode, `foreign ${seen.at(-1)}: ${foreign.body}`).toBe(404);
      expect(errorOf(foreign), seen.at(-1)).toEqual(errorOf(unknown));
    }
    // Nothing was written to the foreign request.
    expect(await snapshot()).toEqual(before);
  });

  it('the representative\'s own request is reachable on the same routes', async () => {
    expect((await call('GET', `/api/v1/admin/quote-requests/${rfqOwn}`, REP)).statusCode).toBe(200);
    expect((await call('GET', `/api/v1/admin/quote-requests/${rfqOwn}/history`, REP)).statusCode).toBe(200);
  });

  it('negotiation GET and PUT on a foreign organization / customer answer the unknown-id 404 (T2, C1)', async () => {
    const unknownOrg = await call('GET', `/api/v1/admin/organizations/${UNKNOWN_ID}/quote-price-negotiation`, PLATFORM);
    const unknownCustomer = await call('GET', `/api/v1/admin/customers/${UNKNOWN_ID}/quote-price-negotiation`, PLATFORM);
    for (const [method, url, payload] of [
      ['GET', `/api/v1/admin/organizations/${orgForeign}/quote-price-negotiation`, undefined],
      ['PUT', `/api/v1/admin/organizations/${orgForeign}/quote-price-negotiation`, { priceProposalsAllowed: false }],
    ] as const) {
      const res = await call(method, url, REP, payload);
      expect(res.statusCode, `${method} ${url}`).toBe(404);
      expect(errorOf(res)).toEqual(errorOf(unknownOrg));
    }
    for (const [method, url, payload] of [
      ['GET', `/api/v1/admin/customers/${accountForeign}/quote-price-negotiation`, undefined],
      ['PUT', `/api/v1/admin/customers/${accountForeign}/quote-price-negotiation`, { override: 'not_allowed' }],
    ] as const) {
      const res = await call(method, url, REP, payload);
      expect(res.statusCode, `${method} ${url}`).toBe(404);
      expect(errorOf(res)).toEqual(errorOf(unknownCustomer));
    }
  });

  /**
   * Phase 4's open question, answered by issue #305 (owner ruling 2026-11-07):
   * there is one reach rule, `canSeeOrganization`'s — assigned, roll-up and the
   * unassigned fallback — and the tenant filter the reads run under now applies
   * it too. An organization with no assignment at all is therefore reachable on
   * every surface: its requests, its members, its negotiation panels and the
   * price probe answer as they do for the representative's own organization.
   * This pinned the split the platform used to have (`@OrgScoped` reads 404,
   * the organization row 200) and pins its end.
   */
  it('a representative and an organization nobody is assigned to: reachable on every surface (#305)', async () => {
    const rows: Record<string, number> = {};
    const probe = async (label: string, method: 'GET' | 'PUT' | 'POST', url: string, payload?: unknown) => {
      rows[label] = (await call(method, url, REP, payload)).statusCode;
    };
    await probe('rfq detail', 'GET', `/api/v1/admin/quote-requests/${rfqUnassigned}`);
    await probe('rfq history', 'GET', `/api/v1/admin/quote-requests/${rfqUnassigned}/history`);
    await probe('neg org GET', 'GET', `/api/v1/admin/organizations/${orgUnassigned}/quote-price-negotiation`);
    await probe('neg customer GET', 'GET', `/api/v1/admin/customers/${accountUnassigned}/quote-price-negotiation`);
    // Feature 160 — the price explanation replaced the per-product probe, with its scope.
    const line = [{ key: 'probe', productId: SEED_PRODUCT_101_ID, quantity: 1 }];
    await probe('probe org', 'POST', '/api/v1/admin/price-books/resolve', { buyer: { organizationId: orgUnassigned }, lines: line });
    await probe('probe account', 'POST', '/api/v1/admin/price-books/resolve', { buyer: { customerAccountId: accountUnassigned }, lines: line });
    await probe('neg org PUT', 'PUT', `/api/v1/admin/organizations/${orgUnassigned}/quote-price-negotiation`, { priceProposalsAllowed: true });
    await probe('neg customer PUT', 'PUT', `/api/v1/admin/customers/${accountUnassigned}/quote-price-negotiation`, { override: 'inherit' });
    await probe('customer detail (pre-existing)', 'GET', `/api/v1/admin/customers/${accountUnassigned}`);
    await probe('organization detail (pre-existing)', 'GET', `/api/v1/admin/organizations/${orgUnassigned}`);
    expect(rows).toEqual({
      'rfq detail': 200,
      'rfq history': 200,
      'neg org GET': 200,
      'neg customer GET': 200,
      'probe org': 200,
      'probe account': 200,
      'neg org PUT': 200,
      'neg customer PUT': 200,
      'customer detail (pre-existing)': 200,
      'organization detail (pre-existing)': 200,
    });
  });

  /**
   * Issue #957 (product-owner ruling 2026-11-08, option A): only the
   * `sales_representative` role is reach-scoped. A custom role holding
   * `rfqs:handle` is platform-wide on the quote-request surfaces, as on every
   * other one — list, detail and actions alike — including an organization
   * another representative is assigned to.
   */
  it('a custom role holding rfqs:handle reaches the requests of every organization (#957)', async () => {
    const CUSTOM_SESSION = `stub-957-custom-${stamp}`;
    const CUSTOM = { b2b_session: CUSTOM_SESSION };
    await withSystemScope('957: seed a custom rfqs:handle role and its admin', async () => {
      const em = h.orm.em.fork();
      const role = em.create(AdminRole, {
        code: `rfq_desk_957_${stamp}`,
        name: 'RFQ desk (957)',
        permissions: ['rfqs:handle'],
      });
      await em.persistAndFlush(role);
      const admin = em.create(AdminUser, {
        email: `957-custom-${stamp}@scope.local`,
        passwordHash: 'x'.repeat(60),
        adminRoleId: role.id,
        firstName: '957',
        lastName: 'Custom',
      });
      await em.persistAndFlush(admin);
      ADMIN_COOKIES[CUSTOM_SESSION] = { adminUserId: admin.id };
    });
    try {
      const list = await call('GET', '/api/v1/admin/quote-requests', CUSTOM);
      expect(list.statusCode, list.body).toBe(200);
      const listed = new Set((list.json() as { data: Array<{ id: string }> }).data.map((r) => r.id));
      expect([rfqOwn, rfqForeign, rfqUnassigned].filter((id) => !listed.has(id))).toEqual([]);

      const rows: Record<string, number> = {};
      for (const [label, id] of [['own', rfqOwn], ['foreign', rfqForeign], ['unassigned', rfqUnassigned]] as const) {
        rows[`detail ${label}`] = (await call('GET', `/api/v1/admin/quote-requests/${id}`, CUSTOM)).statusCode;
        rows[`history ${label}`] = (await call('GET', `/api/v1/admin/quote-requests/${id}/history`, CUSTOM)).statusCode;
      }
      const assign = await call('POST', `/api/v1/admin/quote-requests/${rfqForeign}/assign`, CUSTOM, {
        adminUserId: otherRepId,
      });
      rows['assign foreign'] = assign.statusCode;
      const onBehalf = await call('POST', '/api/v1/admin/quote-requests', CUSTOM, {
        organizationId: orgForeign,
        customerAccountId: accountForeign,
        items: [{ productId: SEED_PRODUCT_101_ID, quantity: 2, agreedUnitPrice: 10 }],
      });
      rows['create on behalf foreign'] = onBehalf.statusCode;
      expect(rows, `${assign.body}\n${onBehalf.body}`).toEqual({
        'detail own': 200,
        'history own': 200,
        'detail foreign': 200,
        'history foreign': 200,
        'detail unassigned': 200,
        'history unassigned': 200,
        'assign foreign': 200,
        'create on behalf foreign': 201,
      });

      // The representative's own list is unchanged by the ruling: their own
      // organization's request and the unassigned one, never the foreign one.
      const repList = await call('GET', '/api/v1/admin/quote-requests', REP);
      expect(repList.statusCode, repList.body).toBe(200);
      const repIds = new Set((repList.json() as { data: Array<{ id: string }> }).data.map((r) => r.id));
      expect({ own: repIds.has(rfqOwn), unassigned: repIds.has(rfqUnassigned), foreign: repIds.has(rfqForeign) }).toEqual({
        own: true,
        unassigned: true,
        foreign: false,
      });
    } finally {
      delete ADMIN_COOKIES[CUSTOM_SESSION];
    }
  });

  describe('effectiveFor and an account row that is deleted or missing', () => {
    const POLICY_SERVICE = 'quoteRequestNegotiationPolicyService';
    type Policy = {
      effectiveFor(id: string, em: ReturnType<BackendServerHandle['orm']['em']['fork']>): Promise<{ allowed: boolean; source: string }>;
    };
    let deletedAccountId: string;

    it('a soft-deleted owner still resolves, and follows its organization', async () => {
      await withSystemScope('146 QA: seed a soft-deleted account in a locked organization', async () => {
        const em = h.orm.em.fork();
        const acc = em.create(CustomerAccount, {
          organizationId: orgUnassigned,
          email: `146-scope-gone-${stamp}@scope.local`,
          passwordHash: 'x'.repeat(60),
          firstName: 'Gone',
          lastName: 'Buyer',
          deletedAt: new Date(),
        });
        await em.persistAndFlush(acc);
        deletedAccountId = acc.id;
      });
      const lock = await call('PUT', `/api/v1/admin/organizations/${orgUnassigned}/quote-price-negotiation`, PLATFORM, {
        priceProposalsAllowed: false,
      });
      expect(lock.statusCode, lock.body).toBe(200);
      const service = h.container.resolve(POLICY_SERVICE) as Policy;
      expect(await service.effectiveFor(deletedAccountId, h.orm.em.fork())).toEqual({
        allowed: false,
        source: 'organization',
      });
    });

    it('an account that does not exist at all is an error, never a default "allowed" (analyze M5)', async () => {
      const service = h.container.resolve(POLICY_SERVICE) as Policy;
      await expect(service.effectiveFor(UNKNOWN_ID, h.orm.em.fork())).rejects.toMatchObject({
        statusCode: 404,
        code: 'NOT_FOUND',
      });
    });
  });
});
