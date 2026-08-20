import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { STUB_CUSTOMER_PASSWORD } from '../../helpers/seed-organizations.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';
import { Product } from '../../../src/modules/catalog/entities/product.entity.js';
import { Category } from '../../../src/modules/catalog/entities/category.entity.js';
import { Organization } from '../../../src/modules/organizations/entities/organization.entity.js';
import { CustomerAccount } from '../../../src/modules/customer_accounts/entities/customer-account.entity.js';
import { hashPassword } from '../../../src/modules/auth/services/password-hasher.js';
import { PriceListService } from '../../../src/modules/price_lists/services/price-list-service.js';
import { neighbourReadPorts } from '../../helpers/price-list-neighbour-ports.js';

/**
 * Feature 062 / T016 — tenant + channel isolation on the external catalog
 * surface (SC-002 catalog half; contracts/catalog-api-key-reads.md §6).
 *
 *  - a key bound to org A / channel 1 sees exactly channel 1's assortment;
 *  - a channel-2-exclusive product fetched by id ⇒ 404 (indistinguishable
 *    from non-existence);
 *  - the same SKU priced via org A's vs org B's key yields each org's own
 *    price — never the other's;
 *  - explicit foreign-channel header ⇒ 403 API_KEY_CHANNEL_MISMATCH;
 *  - categories are channel-scoped too;
 *  - a revoked key ⇒ 401 everywhere.
 */

const ADMIN_COOKIE = { b2b_session: 'stub-admin-session' };
const ORG_B_ID = '00000000-0000-4000-8000-00000000c062';
const CUSTOMER_B_ID = '00000000-0000-4000-8000-00000000c063';

interface Summary {
  id: string;
  sku: string;
  price: { amount: number; currency: string } | null;
}

describe('External catalog tenant/channel isolation (062 / T016, SC-002)', () => {
  let h: BackendServerHandle;
  let keyOrgA: string;
  let keyOrgB: string;
  let channel2ProductId: string;

  const mint = async (payload: Record<string, unknown>): Promise<{ id: string; token: string }> => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/api-keys',
      payload,
      cookies: ADMIN_COOKIE,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { data: { apiKey: { id: string }; bearerToken: string } };
    return { id: body.data.apiKey.id, token: body.data.bearerToken };
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();

    const makeChannel = async (code: string): Promise<SalesChannel> => {
      const ch = em.create(SalesChannel, {
        code,
        name: { 'en-US': code },
        languages: ['en-US'],
        defaultLanguage: 'en-US',
        currencies: ['PLN'],
        defaultCurrency: 'PLN',
        active: true,
        isPublic: true,
      });
      await em.persistAndFlush(ch);
      await h.salesChannels.cache.invalidate(code);
      return ch;
    };
    const channel1 = await makeChannel('iso-1');
    const channel2 = await makeChannel('iso-2');

    const passwordHash = await hashPassword(STUB_CUSTOMER_PASSWORD);
    const orgB = em.create(Organization, {
      id: ORG_B_ID,
      name: 'Isolation Org B',
      taxId: 'PL0000000063',
      status: 'active',
      vatStatus: 'vat_payer',
      registeredAddress: {
        street: 'ul. Izolacji 63',
        city: 'Warszawa',
        postalCode: '00-063',
        country: 'PL',
      },
    });
    await em.persistAndFlush(orgB);
    const customerB = em.create(CustomerAccount, {
      id: CUSTOMER_B_ID,
      organizationId: ORG_B_ID,
      email: 'isolation-org-b@example.com',
      passwordHash,
      firstName: 'Isolation',
      lastName: 'OrgB',
      role: 'organization_admin',
      emailVerifiedAt: new Date(),
    });
    await em.persistAndFlush(customerB);

    const makeProduct = async (sku: string, slug: string): Promise<Product> => {
      const p = em.create(Product, {
        sku,
        slug,
        type: 'simple',
        status: 'active',
        name: { 'en-US': sku },
        description: { 'en-US': '' },
        visibility: 'public',
        manageStock: false,
        attributeValues: {},
      });
      await em.persistAndFlush(p);
      return p;
    };
    const productCh1 = await makeProduct('ISO-CH1-ONLY', 'iso-ch1-only');
    const productCh2 = await makeProduct('ISO-CH2-ONLY', 'iso-ch2-only');
    const productShared = await makeProduct('ISO-SHARED', 'iso-shared');
    channel2ProductId = productCh2.id;

    const categoryCh1 = em.create(Category, {
      name: { 'en-US': 'Iso channel 1 cat' },
      slug: 'iso-cat-1',
    });
    const categoryCh2 = em.create(Category, {
      name: { 'en-US': 'Iso channel 2 cat' },
      slug: 'iso-cat-2',
    });
    await em.persistAndFlush([categoryCh1, categoryCh2]);

    const conn = em.getConnection();
    await conn.execute(
      `insert into sales_channel_products (sales_channel_id, product_id) values (?,?), (?,?), (?,?), (?,?)`,
      [
        channel1.id, productCh1.id,
        channel2.id, productCh2.id,
        channel1.id, productShared.id,
        channel2.id, productShared.id,
      ],
    );
    await conn.execute(
      `insert into sales_channel_categories (sales_channel_id, category_id) values (?,?), (?,?)`,
      [channel1.id, categoryCh1.id, channel2.id, categoryCh2.id],
    );

    // Different org price lists for the shared SKU.
    const priceLists = new PriceListService(() => h.em(), undefined, undefined, undefined, neighbourReadPorts(() => h.em()));
    const seedList = async (name: string, orgId: string, amount: string): Promise<void> => {
      const list = await priceLists.create({
        name,
        type: 'base',
        applicationRule: { kind: 'criterion', type: 'organization', values: [orgId] },
      });
      await priceLists.addProduct(list.id, productShared.id);
      await priceLists.replaceBrackets(list.id, productShared.id, {
        PLN: [{ minQuantity: 1, maxQuantity: null, amount }],
      });
      await priceLists.activate(list.id);
    };
    await seedList('Iso list org A', TEST_ORGANIZATION_ID, '50.00');
    await seedList('Iso list org B', ORG_B_ID, '40.00');

    keyOrgA = (
      await mint({
        name: 'Iso key org A / channel 1',
        scopes: ['catalog:read'],
        binding: {
          organizationId: TEST_ORGANIZATION_ID,
          salesChannelId: channel1.id,
          customerAccountId: TEST_CUSTOMER_ID,
        },
      })
    ).token;
    keyOrgB = (
      await mint({
        name: 'Iso key org B / channel 2',
        scopes: ['catalog:read'],
        binding: {
          organizationId: ORG_B_ID,
          salesChannelId: channel2.id,
          customerAccountId: CUSTOMER_B_ID,
        },
      })
    ).token;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('key A lists exactly channel 1 assortment with org A prices — never channel 2 products', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/external/catalog/products',
      headers: { authorization: `Bearer ${keyOrgA}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-sales-channel']).toBe('iso-1');
    const skus = (res.json() as { data: Summary[] }).data.map((p) => p.sku).sort();
    expect(skus).toContain('ISO-CH1-ONLY');
    expect(skus).toContain('ISO-SHARED');
    expect(skus).not.toContain('ISO-CH2-ONLY');
    const shared = (res.json() as { data: Summary[] }).data.find((p) => p.sku === 'ISO-SHARED');
    expect(shared!.price).toEqual({ amount: 50, currency: 'PLN' });
  });

  it('channel-2-exclusive product detail via key A ⇒ 404, indistinguishable from non-existence', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/external/catalog/products/${channel2ProductId}`,
      headers: { authorization: `Bearer ${keyOrgA}` },
    });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.PRODUCT_NOT_FOUND,
    );
  });

  it('same SKU priced via org A vs org B keys yields each org its own price, never the other', async () => {
    const priceFor = async (token: string): Promise<string> => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/external/catalog/prices',
        payload: { lines: [{ sku: 'ISO-SHARED', quantity: 1 }] },
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const line = (res.json() as {
        data: Array<{ price: { amount: string } | null }>;
      }).data[0]!;
      expect(line.price).not.toBeNull();
      return line.price!.amount;
    };
    const amountA = await priceFor(keyOrgA);
    const amountB = await priceFor(keyOrgB);
    expect(Number(amountA)).toBe(50);
    expect(Number(amountB)).toBe(40);
    expect(amountA).not.toBe(amountB);
  });

  it('bulk pricing for a foreign-channel SKU ⇒ sku_not_in_assortment', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/external/catalog/prices',
      payload: { lines: [{ sku: 'ISO-CH2-ONLY', quantity: 1 }] },
      headers: { authorization: `Bearer ${keyOrgA}` },
    });
    expect(res.statusCode).toBe(200);
    const line = (res.json() as {
      data: Array<{ price: null; reason?: string }>;
    }).data[0]!;
    expect(line.price).toBeNull();
    expect(line.reason).toBe('sku_not_in_assortment');
  });

  it('explicit foreign-channel header with a bound key ⇒ 403 API_KEY_CHANNEL_MISMATCH', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/external/catalog/products',
      headers: { authorization: `Bearer ${keyOrgA}`, 'x-sales-channel': 'iso-2' },
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.API_KEY_CHANNEL_MISMATCH,
    );
  });

  it('categories resolve in the KEY-PINNED channel context, same shape as the public tree', async () => {
    // The public tree is not membership-filtered (only product counts are
    // channel-scoped), so the isolation proof here is context equality: the
    // bound key's tree must equal the public tree of ITS channel — proving
    // the pinned channel drove resolution, with no key-only variation.
    const external = await h.app.inject({
      method: 'GET',
      url: '/api/v1/external/catalog/categories',
      headers: { authorization: `Bearer ${keyOrgA}` },
    });
    expect(external.statusCode).toBe(200);
    const publicTree = await h.app.inject({
      method: 'GET',
      url: '/api/v1/catalog/categories',
      headers: { 'x-sales-channel': 'iso-1' },
    });
    expect(publicTree.statusCode).toBe(200);
    expect(external.body).toBe(publicTree.body);
    const slugs = (external.json() as { data: Array<{ slug: string }> }).data.map((n) => n.slug);
    expect(slugs).toContain('iso-cat-1');
  });

  it('a revoked key ⇒ 401 everywhere on the external namespace', async () => {
    const em = h.em();
    const channel1 = await em.findOne(SalesChannel, { code: 'iso-1' });
    const { id, token } = await mint({
      name: 'Iso key to revoke',
      scopes: ['catalog:read'],
      binding: {
        organizationId: TEST_ORGANIZATION_ID,
        salesChannelId: channel1!.id,
        customerAccountId: TEST_CUSTOMER_ID,
      },
    });
    const revoked = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/api-keys/${id}`,
      cookies: ADMIN_COOKIE,
    });
    expect(revoked.statusCode).toBe(204);

    const list = await h.app.inject({
      method: 'GET',
      url: '/api/v1/external/catalog/products',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(list.statusCode).toBe(401);
    const prices = await h.app.inject({
      method: 'POST',
      url: '/api/v1/external/catalog/prices',
      payload: { lines: [{ sku: 'ISO-SHARED', quantity: 1 }] },
      headers: { authorization: `Bearer ${token}` },
    });
    expect(prices.statusCode).toBe(401);
  });
});
