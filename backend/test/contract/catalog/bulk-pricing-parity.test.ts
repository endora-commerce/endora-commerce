import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  CUSTOMER_COOKIES,
  TEST_CUSTOMER_ID,
  TEST_ORGANIZATION_ID,
} from '../../helpers/test-actors.js';
import { STUB_CUSTOMER_PASSWORD } from '../../helpers/seed-organizations.js';
import { SalesChannel } from '../../../src/modules/sales_channels/entities/sales-channel.entity.js';
import { Product } from '../../../src/modules/catalog/entities/product.entity.js';
import { Organization } from '../../../src/modules/organizations/entities/organization.entity.js';
import { CustomerAccount } from '../../../src/modules/customer_accounts/entities/customer-account.entity.js';
import { AuditLogEntry } from '../../../src/modules/audit_logs/entities/audit-log-entry.entity.js';
import { hashPassword } from '../../../src/modules/auth/services/password-hasher.js';
import { PriceListService } from '../../../src/modules/price_lists/services/price-list-service.js';

/**
 * Feature 062 / T015 — bulk pricing parity (SC-001).
 *
 * For any (sku, quantity) the amount returned by
 * `POST /api/v1/external/catalog/prices` equals what the cart charges the
 * bound org on the bound channel at that quantity — same resolver, same
 * inputs. Two orgs with different price lists prove per-line parity AND that
 * neither org ever receives the other's amount. Plus: per-line
 * `sku_not_in_assortment` / `price_unavailable` reasons, >200 lines ⇒ 422,
 * unbound ⇒ 403 API_KEY_NOT_BOUND, missing scope ⇒ 403 out-of-scope (audited).
 */

const ADMIN_COOKIE = { b2b_session: 'stub-admin-session' };
const ORG_B_ID = '00000000-0000-4000-8000-00000000b062';
const CUSTOMER_B_ID = '00000000-0000-4000-8000-00000000b063';
const ORG_B_COOKIE = 'stub-parity-org-b-session';

type BulkLine =
  | {
      sku: string;
      quantity: number;
      price: {
        amount: string;
        currency: string;
        isSale: boolean;
        bracketStartQuantity: number;
        priceListId: string;
      };
    }
  | { sku: string; quantity: number; price: null; reason: string };

describe('External bulk pricing parity with cart pricing (062 / T015, SC-001)', () => {
  let h: BackendServerHandle;
  let keyOrgA: string;
  let keyOrgB: string;
  let unboundToken: string;
  let ordersOnlyToken: string;
  let productSharedId: string;

  const mint = async (payload: Record<string, unknown>): Promise<string> => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/api-keys',
      payload,
      cookies: ADMIN_COOKIE,
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { data: { bearerToken: string } }).data.bearerToken;
  };

  const bulkPrice = async (
    token: string,
    lines: Array<{ sku: string; quantity: number }>,
  ): Promise<{ statusCode: number; data?: BulkLine[]; errorCode?: string }> => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/external/catalog/prices',
      payload: { lines },
      headers: { authorization: `Bearer ${token}` },
    });
    const body = res.json() as { data?: BulkLine[]; error?: { code: string } };
    return {
      statusCode: res.statusCode,
      ...(body.data ? { data: body.data } : {}),
      ...(body.error ? { errorCode: body.error.code } : {}),
    };
  };

  /** Cart oracle: add the line as the given customer, read the resolved unit price, remove the line. */
  const cartUnitPrice = async (
    sessionCookie: string,
    productId: string,
    quantity: number,
  ): Promise<number> => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId, quantity },
      cookies: { b2b_session: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
    const cart = (res.json() as {
      data: { items: Array<{ id: string; productId: string; unitPrice: { amount: number } }> };
    }).data;
    const line = cart.items.find((i) => i.productId === productId);
    expect(line).toBeDefined();
    const removed = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/cart/items/${line!.id}`,
      cookies: { b2b_session: sessionCookie },
    });
    expect(removed.statusCode).toBe(200);
    return line!.unitPrice.amount;
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();

    const defaultChannel = await em.findOne(SalesChannel, { systemDefault: true });
    expect(defaultChannel).not.toBeNull();

    // Second Organization + its service/customer account (different price list).
    const passwordHash = await hashPassword(STUB_CUSTOMER_PASSWORD);
    const orgB = em.create(Organization, {
      id: ORG_B_ID,
      name: 'Parity Org B',
      taxId: 'PL0000000062',
      status: 'active',
      vatStatus: 'vat_payer',
      registeredAddress: {
        street: 'ul. Parytetu 62',
        city: 'Warszawa',
        postalCode: '00-062',
        country: 'PL',
      },
    });
    await em.persistAndFlush(orgB);
    const customerB = em.create(CustomerAccount, {
      id: CUSTOMER_B_ID,
      organizationId: ORG_B_ID,
      email: 'parity-org-b@example.com',
      passwordHash,
      firstName: 'Parity',
      lastName: 'OrgB',
      role: 'organization_admin',
      emailVerifiedAt: new Date(),
    });
    await em.persistAndFlush(customerB);
    CUSTOMER_COOKIES[ORG_B_COOKIE] = {
      customerAccountId: CUSTOMER_B_ID,
      organizationId: ORG_B_ID,
    };

    // Products: PAR-1 priced for both orgs; PAR-2 in assortment, no brackets;
    // PAR-3 exists but only on another channel (⇒ not in assortment).
    const otherChannel = em.create(SalesChannel, {
      code: 'parity-other',
      name: { 'en-US': 'Parity other channel' },
      languages: ['en-US'],
      defaultLanguage: 'en-US',
      currencies: ['PLN'],
      defaultCurrency: 'PLN',
      active: true,
    });
    await em.persistAndFlush(otherChannel);
    await h.salesChannels.cache.invalidate('parity-other');

    const shared = em.create(Product, {
      sku: 'PAR-SHARED-001',
      slug: 'parity-shared-product',
      type: 'simple',
      status: 'active',
      name: { 'en-US': 'Parity shared product' },
      description: { 'en-US': '' },
      visibility: 'public',
      manageStock: false,
      attributeValues: {},
    });
    const bracketless = em.create(Product, {
      sku: 'PAR-NOBRACKET-002',
      slug: 'parity-bracketless-product',
      type: 'simple',
      status: 'active',
      name: { 'en-US': 'Parity bracketless product' },
      description: { 'en-US': '' },
      visibility: 'public',
      manageStock: false,
      attributeValues: {},
    });
    const foreign = em.create(Product, {
      sku: 'PAR-FOREIGN-003',
      slug: 'parity-foreign-product',
      type: 'simple',
      status: 'active',
      name: { 'en-US': 'Parity foreign-channel product' },
      description: { 'en-US': '' },
      visibility: 'public',
      manageStock: false,
      attributeValues: {},
    });
    await em.persistAndFlush([shared, bracketless, foreign]);
    productSharedId = shared.id;

    const conn = em.getConnection();
    await conn.execute(
      `insert into sales_channel_products (sales_channel_id, product_id) values (?,?), (?,?), (?,?)`,
      [
        defaultChannel!.id, shared.id,
        defaultChannel!.id, bracketless.id,
        otherChannel.id, foreign.id,
      ],
    );

    // Two org-targeted price lists with DIFFERENT bracket ladders.
    const priceLists = new PriceListService(() => h.em());
    const listA = await priceLists.create({
      name: 'Parity list org A',
      type: 'base',
      applicationRule: {
        kind: 'criterion',
        type: 'organization',
        values: [TEST_ORGANIZATION_ID],
      },
    });
    await priceLists.addProduct(listA.id, shared.id);
    await priceLists.replaceBrackets(listA.id, shared.id, {
      PLN: [
        { minQuantity: 1, maxQuantity: 9, amount: '111.00' },
        { minQuantity: 10, maxQuantity: null, amount: '99.00' },
      ],
    });
    await priceLists.activate(listA.id);

    const listB = await priceLists.create({
      name: 'Parity list org B',
      type: 'base',
      applicationRule: {
        kind: 'criterion',
        type: 'organization',
        values: [ORG_B_ID],
      },
    });
    await priceLists.addProduct(listB.id, shared.id);
    await priceLists.replaceBrackets(listB.id, shared.id, {
      PLN: [
        { minQuantity: 1, maxQuantity: 9, amount: '88.00' },
        { minQuantity: 10, maxQuantity: null, amount: '77.00' },
      ],
    });
    await priceLists.activate(listB.id);

    keyOrgA = await mint({
      name: 'Parity key org A',
      scopes: ['catalog:read'],
      binding: {
        organizationId: TEST_ORGANIZATION_ID,
        salesChannelId: defaultChannel!.id,
        customerAccountId: TEST_CUSTOMER_ID,
      },
    });
    keyOrgB = await mint({
      name: 'Parity key org B',
      scopes: ['catalog:read'],
      binding: {
        organizationId: ORG_B_ID,
        salesChannelId: defaultChannel!.id,
        customerAccountId: CUSTOMER_B_ID,
      },
    });
    unboundToken = await mint({ name: 'Parity unbound key', scopes: ['catalog:read'] });
    ordersOnlyToken = await mint({
      name: 'Parity orders-only key',
      scopes: ['orders:read', 'orders:write'],
      binding: {
        organizationId: TEST_ORGANIZATION_ID,
        salesChannelId: defaultChannel!.id,
        customerAccountId: TEST_CUSTOMER_ID,
      },
    });
  });

  afterAll(async () => {
    delete CUSTOMER_COOKIES[ORG_B_COOKIE];
    await teardownBackendServer(h);
  });

  it('org A amounts equal cart pricing for the same org/channel/quantity (SC-001)', async () => {
    const matrix: Array<{ quantity: number; expected: string }> = [
      { quantity: 1, expected: '111.00' },
      { quantity: 9, expected: '111.00' },
      { quantity: 10, expected: '99.00' },
      { quantity: 25, expected: '99.00' },
    ];
    for (const { quantity, expected } of matrix) {
      const bulk = await bulkPrice(keyOrgA, [{ sku: 'PAR-SHARED-001', quantity }]);
      expect(bulk.statusCode).toBe(200);
      const line = bulk.data![0]!;
      expect(line.price).not.toBeNull();
      if (line.price === null) throw new Error('unreachable');
      expect(Number(line.price.amount)).toBe(Number(expected));
      expect(line.price.currency).toBe('PLN');

      const cartAmount = await cartUnitPrice('stub-customer-session', productSharedId, quantity);
      expect(Number(line.price.amount)).toBe(cartAmount);
    }
  });

  it('org B amounts equal ITS cart pricing and never org A amounts', async () => {
    const matrix: Array<{ quantity: number; expected: string }> = [
      { quantity: 1, expected: '88.00' },
      { quantity: 10, expected: '77.00' },
    ];
    for (const { quantity, expected } of matrix) {
      const bulk = await bulkPrice(keyOrgB, [{ sku: 'PAR-SHARED-001', quantity }]);
      expect(bulk.statusCode).toBe(200);
      const line = bulk.data![0]!;
      expect(line.price).not.toBeNull();
      if (line.price === null) throw new Error('unreachable');
      expect(Number(line.price.amount)).toBe(Number(expected));

      const cartAmount = await cartUnitPrice(ORG_B_COOKIE, productSharedId, quantity);
      expect(Number(line.price.amount)).toBe(cartAmount);

      // Cross-org negative: org B never sees org A's ladder.
      expect(['111.00', '99.00'].map(Number)).not.toContain(Number(line.price.amount));
    }
  });

  it('per-line reasons are data, order-preserving: assortment miss and price miss', async () => {
    const bulk = await bulkPrice(keyOrgA, [
      { sku: 'PAR-SHARED-001', quantity: 1 },
      { sku: 'PAR-NOBRACKET-002', quantity: 1 },
      { sku: 'PAR-FOREIGN-003', quantity: 1 },
      { sku: 'PAR-DOES-NOT-EXIST', quantity: 1 },
    ]);
    expect(bulk.statusCode).toBe(200);
    expect(bulk.data).toHaveLength(4);
    const [ok, noPrice, foreign, unknown] = bulk.data!;
    expect(ok!.price).not.toBeNull();
    expect(noPrice!.price).toBeNull();
    expect((noPrice as { reason: string }).reason).toBe('price_unavailable');
    expect(foreign!.price).toBeNull();
    expect((foreign as { reason: string }).reason).toBe('sku_not_in_assortment');
    expect(unknown!.price).toBeNull();
    expect((unknown as { reason: string }).reason).toBe('sku_not_in_assortment');
  });

  it('more than 200 lines ⇒ 422 VALIDATION_FAILED', async () => {
    const lines = Array.from({ length: 201 }, (_, i) => ({
      sku: `BULK-${i}`,
      quantity: 1,
    }));
    const res = await bulkPrice(keyOrgA, lines);
    expect(res.statusCode).toBe(422);
    expect(res.errorCode).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it('unbound key ⇒ 403 API_KEY_NOT_BOUND', async () => {
    const res = await bulkPrice(unboundToken, [{ sku: 'PAR-SHARED-001', quantity: 1 }]);
    expect(res.statusCode).toBe(403);
    expect(res.errorCode).toBe(ERROR_CODES.API_KEY_NOT_BOUND);
  });

  it('key without catalog:read ⇒ 403 API_KEY_OUT_OF_SCOPE (audited)', async () => {
    const before = await h.em().count(AuditLogEntry, { action: 'api_key.out_of_scope' });
    const res = await bulkPrice(ordersOnlyToken, [{ sku: 'PAR-SHARED-001', quantity: 1 }]);
    expect(res.statusCode).toBe(403);
    expect(res.errorCode).toBe(ERROR_CODES.API_KEY_OUT_OF_SCOPE);
    const after = await h.em().count(AuditLogEntry, { action: 'api_key.out_of_scope' });
    expect(after).toBe(before + 1);
  });

  it('anonymous ⇒ 401; every bulk response is no-store', async () => {
    const anon = await h.app.inject({
      method: 'POST',
      url: '/api/v1/external/catalog/prices',
      payload: { lines: [{ sku: 'PAR-SHARED-001', quantity: 1 }] },
    });
    expect(anon.statusCode).toBe(401);
    expect(anon.headers['cache-control']).toBe('private, no-store');

    const ok = await h.app.inject({
      method: 'POST',
      url: '/api/v1/external/catalog/prices',
      payload: { lines: [{ sku: 'PAR-SHARED-001', quantity: 1 }] },
      headers: { authorization: `Bearer ${keyOrgA}` },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['cache-control']).toBe('private, no-store');
  });
});
