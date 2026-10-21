import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import {
  ADMIN_COOKIES,
  TEST_CUSTOMER_ID,
  TEST_ORGANIZATION_ID,
} from '../../helpers/test-actors.js';
import {
  AdminRole,
  AdminUser,
  CustomerAccount,
  Organization,
  OrganizationSalesRepAssignment,
} from '../../helpers/package-entities.js';
import { ensureSalesChannel } from '../../helpers/sales-channel-fixtures.js';
import { seedBasePriceSql, seedPriceBookSql } from '../../helpers/price-book-sql.js';

/**
 * Admin resolver endpoint for customer-specific pricing.
 *
 * Covers `GET /api/v1/admin/products/:id/resolved-price`, used by the admin
 * "create quote request on behalf of a customer" UI to pre-fill the agreed
 * unit price from the customer's price lists.
 */
describe('Admin resolved-price endpoint', () => {
  let h: BackendServerHandle;
  const ADMIN_COOKIE = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  beforeEach(async () => {
    await h
      .em()
      .getConnection()
      .execute(
        `truncate table "price_list_price_brackets", "price_list_products", "price_lists" cascade`,
      );
    await seedBasePriceSql(h.em(), SEED_PRODUCT_101_ID, '199.0000');
  });

  it('resolves the unit price for a customer + product', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url:
        `/api/v1/admin/products/${SEED_PRODUCT_101_ID}/resolved-price` +
        `?organizationId=${TEST_ORGANIZATION_ID}&customerAccountId=${TEST_CUSTOMER_ID}&quantity=1`,
      cookies: ADMIN_COOKIE,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { resolvedPrice: { amount: string; currency: string } | null };
    };
    expect(body.data.resolvedPrice).not.toBeNull();
    expect(Number(body.data.resolvedPrice?.amount)).toBeCloseTo(199, 2);
    expect(body.data.resolvedPrice?.currency).toBe('PLN');
  });

  it('returns 404 for an unknown product', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/products/00000000-0000-4000-8000-0000000000ff/resolved-price?quantity=1`,
      cookies: ADMIN_COOKIE,
    });
    expect(res.statusCode).toBe(404);
  });
});

/**
 * Feature 146, Phase 4 (T020) — the probe on a sales channel, and its authority.
 *
 * `salesChannelId` resolves on that channel (US1 #4b: 120.00 on channel A, the
 * base book's 130.00 everywhere else). The probe also answers only
 * about organizations the caller may see (threat model T8, decision D-3M): a
 * sales representative asking about an organization they are not assigned to —
 * by `organizationId` or through a customer account of it — is refused with the
 * same status and body as an organization that does not exist (C1), and a
 * customer account that is not a member of the organization named beside it is
 * a 400. A platform administrator is unaffected.
 */
describe('Admin resolved-price endpoint — channel and authority (feature 146)', () => {
  let h: BackendServerHandle;
  const stamp = Date.now();
  const PLATFORM = { b2b_session: 'stub-admin-session' };
  const REP_SESSION = `stub-146-rep-${stamp}`;
  const NO_READ_SESSION = `stub-146-no-read-${stamp}`;
  const REP = { b2b_session: REP_SESSION };
  const NO_READ = { b2b_session: NO_READ_SESSION };
  const UNKNOWN_ORGANIZATION_ID = '00000000-0000-4000-8000-0000001460ff';
  const UNKNOWN_CHANNEL_ID = '00000000-0000-4000-8000-0000001460cc';
  let channelAId: string;
  let assignedOrgId: string;
  let foreignOrgId: string;
  let assignedCustomerId: string;
  let foreignCustomerId: string;

  const probe = (cookies: Record<string, string>, query: Record<string, string>) =>
    h.app.inject({
      method: 'GET',
      url:
        `/api/v1/admin/products/${SEED_PRODUCT_101_ID}/resolved-price?` +
        new URLSearchParams({ quantity: '1', ...query }).toString(),
      cookies,
    });

  /** The refusal body without the per-request correlation id, which always differs. */
  const refusal = (res: { json: () => unknown }): unknown => {
    const { error } = res.json() as { error: Record<string, unknown> };
    const { requestId: _requestId, ...rest } = error;
    return { error: rest };
  };

  const amountOf = (res: { json: () => unknown }): number =>
    Number(
      (res.json() as { data: { resolvedPrice: { amount: string } | null } }).data.resolvedPrice
        ?.amount,
    );

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    // `setupBackendServer` has just emptied the price tables (`price_lists` is
    // a seeded table, truncated with cascade), so this block adds its lists
    // and wipes nothing (`check-shared-table-wipes`).
    await seedBasePriceSql(em, SEED_PRODUCT_101_ID, '130.0000');

    const channelA = await ensureSalesChannel(em, `pl146_channel_a`);
    channelAId = channelA.id;
    // A channel catalogue book bound to channel A only (feature 160 US3).
    await seedPriceBookSql(em, {
      name: 'Feature 146 channel A',
      audience: 'everyone',
      channelIds: [channelAId],
      rows: [{ productId: SEED_PRODUCT_101_ID, fixed: '120.0000' }],
    });

    // The admin scope keys on this exact role code and the row is shared with
    // every other file in the run: widen it with the one code these cases need.
    let repRole = await em.findOne(AdminRole, { code: 'sales_representative' });
    if (!repRole) {
      repRole = em.create(AdminRole, {
        code: 'sales_representative',
        name: 'Sales Representative',
        permissions: ['price_lists:read'],
      });
    } else {
      repRole.permissions = Array.from(new Set([...repRole.permissions, 'price_lists:read']));
    }
    const noReadRole = em.create(AdminRole, {
      code: `pl146_no_read_${stamp}`,
      name: 'Feature 146 — no pricing read',
      permissions: [],
    });
    await em.persistAndFlush([repRole, noReadRole]);

    const organization = (label: string) =>
      em.create(Organization, {
        name: `Feature 146 ${label}`,
        taxId: `PL146${label}${String(stamp).slice(-7)}`,
        status: 'active',
        vatStatus: 'vat_payer',
        registeredAddress: {
          street: 'ul. Cenowa 1',
          city: 'Warszawa',
          postalCode: '00-100',
          country: 'PL',
        },
      });
    const assigned = organization('A');
    const foreign = organization('B');
    await em.persistAndFlush([assigned, foreign]);
    assignedOrgId = assigned.id;
    foreignOrgId = foreign.id;

    const customer = (organizationId: string, label: string) =>
      em.create(CustomerAccount, {
        organizationId,
        email: `pl146-${label}-${stamp}@example.com`,
        passwordHash: 'x',
        firstName: 'Feature',
        lastName: label,
        role: 'regular_user',
        emailVerifiedAt: new Date(),
      });
    const assignedCustomer = customer(assigned.id, 'assigned');
    const foreignCustomer = customer(foreign.id, 'foreign');
    await em.persistAndFlush([assignedCustomer, foreignCustomer]);
    assignedCustomerId = assignedCustomer.id;
    foreignCustomerId = foreignCustomer.id;

    const admin = (label: string, adminRoleId: string) =>
      em.create(AdminUser, {
        email: `pl146-${label}-${stamp}@audit.local`,
        passwordHash: 'x'.repeat(60),
        adminRoleId,
        firstName: 'Feature',
        lastName: label,
      });
    const rep = admin('rep', repRole.id);
    // The foreign organization has a representative of its own, so the
    // unassigned-organization fallback does not make it visible to `rep`.
    const otherRep = admin('other-rep', repRole.id);
    const noRead = admin('no-read', noReadRole.id);
    await em.persistAndFlush([rep, otherRep, noRead]);
    await em.persistAndFlush([
      em.create(OrganizationSalesRepAssignment, { organizationId: assigned.id, adminUserId: rep.id }),
      em.create(OrganizationSalesRepAssignment, {
        organizationId: foreign.id,
        adminUserId: otherRep.id,
      }),
    ]);
    ADMIN_COOKIES[REP_SESSION] = { adminUserId: rep.id };
    ADMIN_COOKIES[NO_READ_SESSION] = { adminUserId: noRead.id };
  });

  afterAll(async () => {
    delete ADMIN_COOKIES[REP_SESSION];
    delete ADMIN_COOKIES[NO_READ_SESSION];
    await teardownBackendServer(h);
  });

  it('resolves on the named channel (120.00 on A) and on the system default without one (130.00)', async () => {
    const onA = await probe(PLATFORM, {
      organizationId: TEST_ORGANIZATION_ID,
      customerAccountId: TEST_CUSTOMER_ID,
      salesChannelId: channelAId,
    });
    expect(onA.statusCode, onA.body).toBe(200);
    expect(amountOf(onA)).toBeCloseTo(120, 2);

    const onDefault = await probe(PLATFORM, {
      organizationId: TEST_ORGANIZATION_ID,
      customerAccountId: TEST_CUSTOMER_ID,
    });
    expect(onDefault.statusCode, onDefault.body).toBe(200);
    expect(amountOf(onDefault)).toBeCloseTo(130, 2);
  });

  it('answers an unknown channel id with the same 400 body as a malformed one, without echoing it', async () => {
    const unknown = await probe(PLATFORM, { salesChannelId: UNKNOWN_CHANNEL_ID });
    const malformed = await probe(PLATFORM, { salesChannelId: 'not-a-channel' });
    expect(unknown.statusCode).toBe(400);
    expect(malformed.statusCode).toBe(400);
    expect((unknown.json() as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
    expect(refusal(unknown)).toEqual(refusal(malformed));
    expect(unknown.body).not.toContain(UNKNOWN_CHANNEL_ID);
  });

  it('still requires price_lists:read', async () => {
    const res = await probe(NO_READ, { organizationId: TEST_ORGANIZATION_ID });
    expect(res.statusCode).toBe(403);
  });

  it('answers a sales representative about an organization they are assigned to', async () => {
    const res = await probe(REP, {
      organizationId: assignedOrgId,
      customerAccountId: assignedCustomerId,
      salesChannelId: channelAId,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(amountOf(res)).toBeCloseTo(120, 2);
  });

  it('refuses a representative asking about a foreign organization exactly like an unknown one (T8, C1)', async () => {
    const unknown = await probe(REP, { organizationId: UNKNOWN_ORGANIZATION_ID });
    expect(unknown.statusCode).toBe(404);

    const byOrganization = await probe(REP, { organizationId: foreignOrgId });
    expect(byOrganization.statusCode).toBe(unknown.statusCode);
    expect(refusal(byOrganization)).toEqual(refusal(unknown));

    const byAccount = await probe(REP, { customerAccountId: foreignCustomerId });
    expect(byAccount.statusCode).toBe(unknown.statusCode);
    expect(refusal(byAccount)).toEqual(refusal(unknown));

    // Naming an assigned organization beside a foreign account discloses nothing either.
    const mixed = await probe(REP, {
      organizationId: assignedOrgId,
      customerAccountId: foreignCustomerId,
    });
    expect(mixed.statusCode).toBe(unknown.statusCode);
    expect(refusal(mixed)).toEqual(refusal(unknown));

    // An account that does not exist answers the same.
    const unknownAccount = await probe(REP, { customerAccountId: UNKNOWN_ORGANIZATION_ID });
    expect(unknownAccount.statusCode).toBe(unknown.statusCode);
    expect(refusal(unknownAccount)).toEqual(refusal(unknown));

    // The platform administrator's answer for an unknown organization is the same body.
    const platformUnknown = await probe(PLATFORM, { organizationId: UNKNOWN_ORGANIZATION_ID });
    expect(platformUnknown.statusCode).toBe(unknown.statusCode);
    expect(refusal(platformUnknown)).toEqual(refusal(unknown));
  });

  it('refuses a customer account that is not a member of the given organization with 400', async () => {
    const res = await probe(PLATFORM, {
      organizationId: assignedOrgId,
      customerAccountId: foreignCustomerId,
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
  });

  it('leaves a platform administrator unaffected by the representative scope', async () => {
    const res = await probe(PLATFORM, {
      organizationId: foreignOrgId,
      customerAccountId: foreignCustomerId,
      salesChannelId: channelAId,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(amountOf(res)).toBeCloseTo(120, 2);
  });
});
