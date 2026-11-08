import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Organization, Product, Tax } from '../../helpers/package-entities.js';
import { seedBasePriceSql } from '../../helpers/price-book-sql.js';
import { seedOtherTestCustomer } from '../../helpers/seed-organizations.js';
import { OTHER_TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Issue #852 — a catalogue product carries the VAT rate its buyer is charged
 * for it, resolved by the rule the cart and the order use: the product's tax
 * class against the Organization's VAT status and registered country, an
 * exempt or reverse-charge Organization at 0, a buyer with no Organization a
 * VAT payer in PL. The storefront derived every product's gross at a flat 23 %.
 *
 * The rate is the buyer's, so the cache half matters as much as the figure:
 * two Organizations reading the same URL get their own rates, and neither
 * answer may enter a shared cache (`markPersonalisedPricing`). The anonymous
 * answer is the one the shared caches hold, and it carries the guest's rate.
 */

const VAT_PAYER = { b2b_session: 'stub-customer-session' };
const EXEMPT = { b2b_session: 'stub-customer-session-other-org' };

interface VatProduct {
  id: string;
  type: string;
  vatRate?: number | null;
}

describe('#852 — the catalogue answers each product’s VAT rate for the buyer', () => {
  let h: BackendServerHandle;
  const taxCodes: string[] = [];
  let simpleId: string;
  let reducedId: string;
  let reducedSlug: string;

  async function createProduct(type: 'simple' | 'virtual', price: string, stamp: string) {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: {
        sku: `VAT852-${type}-${stamp}`,
        type,
        name: `VAT ${type} ${stamp}`,
        description: '',
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
        status: 'active',
        ...(type === 'virtual' ? { downloadUrl: 'https://example.com/vat852.pdf' } : {}),
      },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(created.statusCode, created.body).toBe(201);
    const data = (created.json() as { data: { id: string; slug: string } }).data;
    await h.em().nativeUpdate(Product, { id: data.id }, { manageStock: false });
    await seedBasePriceSql(h.em(), data.id, price);
    return data;
  }

  async function list(cookies?: Record<string, string>) {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products?ids=${simpleId},${reducedId}`,
      ...(cookies ? { cookies } : {}),
    });
    expect(res.statusCode, res.body).toBe(200);
    const rows = (res.json() as { data: VatProduct[] }).data;
    return { res, byId: new Map(rows.map((p) => [p.id, p])) };
  }

  async function detail(cookies?: Record<string, string>) {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products/${reducedSlug}`,
      ...(cookies ? { cookies } : {}),
    });
    expect(res.statusCode, res.body).toBe(200);
    return { res, product: (res.json() as { data: VatProduct }).data };
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    const stamp = `${Date.now()}-${randomUUID().slice(0, 6)}`;
    const em = h.em();
    // One rule per product tax class; a rule naming a class outranks the default.
    for (const [productType, rate] of [
      ['simple', '0.2300'],
      ['virtual', '0.0800'],
    ] as const) {
      const code = `vat852-${productType}-${stamp}`;
      taxCodes.push(code);
      em.create(Tax, { code, name: code, rate, productType, priority: 1000 });
    }
    await em.flush();

    simpleId = (await createProduct('simple', '100.00', stamp)).id;
    const reduced = await createProduct('virtual', '100.00', stamp);
    reducedId = reduced.id;
    reducedSlug = reduced.slug;
    await (h.container as unknown as { resolve<T>(name: string): T })
      .resolve<{ handle: { pricingGeneration: { bump(): Promise<void> } } }>('priceLists')
      .handle.pricingGeneration.bump();

    // The second buyer's Organization is VAT-exempt.
    await seedOtherTestCustomer(em);
    await em.nativeUpdate(Organization, { id: OTHER_TEST_ORGANIZATION_ID }, { vatStatus: 'vat_exempt' });
  }, 60_000);

  afterAll(async () => {
    await h.em().nativeUpdate(Organization, { id: OTHER_TEST_ORGANIZATION_ID }, { vatStatus: 'vat_payer' });
    await h.em().nativeDelete(Tax, { code: { $in: taxCodes } });
    await teardownBackendServer(h);
  });

  it('answers a reduced-rate product its own rate, on the listing and the product page', async () => {
    const { byId } = await list(VAT_PAYER);
    expect(byId.get(reducedId)?.vatRate).toBe(0.08);
    expect(byId.get(simpleId)?.vatRate).toBe(0.23);
    const { product } = await detail(VAT_PAYER);
    expect(product.vatRate).toBe(0.08);
  });

  it('answers 0 for a VAT-exempt Organization', async () => {
    const { byId } = await list(EXEMPT);
    expect(byId.get(reducedId)?.vatRate).toBe(0);
    expect(byId.get(simpleId)?.vatRate).toBe(0);
    const { product } = await detail(EXEMPT);
    expect(product.vatRate).toBe(0);
  });

  it('answers a visitor with no Organization as a VAT payer in PL', async () => {
    const { byId } = await list();
    expect(byId.get(reducedId)?.vatRate).toBe(0.08);
    const { product } = await detail();
    expect(product.vatRate).toBe(0.08);
  });

  it('keeps one buyer’s rate out of every cache another buyer reads', async () => {
    const payer = await list(VAT_PAYER);
    const exempt = await list(EXEMPT);
    const anonymous = await list();
    // Same URL, different buyers, different rates.
    expect(payer.byId.get(reducedId)?.vatRate).not.toBe(exempt.byId.get(reducedId)?.vatRate);
    // Each Organization's answer is private and unstorable…
    expect(payer.res.headers['cache-control']).toBe('private, no-store');
    expect(exempt.res.headers['cache-control']).toBe('private, no-store');
    expect((await detail(VAT_PAYER)).res.headers['cache-control']).toBe('private, no-store');
    expect((await detail(EXEMPT)).res.headers['cache-control']).toBe('private, no-store');
    // …and the shareable answer is the guest's, which names no Organization.
    expect(anonymous.res.headers['cache-control']).toBeUndefined();
    expect((await detail()).res.headers['cache-control']).toBeUndefined();
  });
});
