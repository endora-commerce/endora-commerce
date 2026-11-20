import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { CustomerAccount, PriceDisplayModeOverride, Tax } from '../../helpers/package-entities.js';
import { CUSTOMER_COOKIES } from '../../helpers/test-actors.js';
import { seedPriceBookSql } from '../../helpers/price-book-sql.js';
import { createUnpricedProduct } from '../../helpers/tiered-product-fixture.js';
import { predefinedRoleIdOf } from '../../helpers/seed-organization-roles.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import { ADMIN, makeAddress, makeOrganization } from './fixtures.js';

/**
 * `specs/182-related-payers/` T056 + T056a (FR-115, FR-120, RP-14, SC-008) — on a payer's
 * commercial terms every price-carrying read prices for the payer **and takes the payer's VAT**,
 * while the display mode — and with it whether price sorting is offered — stays the buyer's.
 *
 * Its own buyer X (`vat_payer`, PL, organization display mode `gross_only`), so no override
 * reaches another file. Payers: Y1 `reverse_charge` registered in DE, whose own organization
 * display mode is `none`; Y2 `vat_exempt`. Products are this file's own, priced only by the
 * payers' books, so no other file's book or override reaches them.
 *
 * Search hits and type-ahead are not asserted here: the search index needs Meilisearch, whose
 * suite answers on its own (`test/integration/search/`). Cross-sell tiles and comparisons read
 * through the same `pricingViewerFields` / priced audience as the listing.
 */
describe('related_payers — every surface on the payer\'s terms (RP-14)', () => {
  let h: BackendServerHandle;
  let channelId: string;
  let x: string;
  let y1: string;
  let y2: string;
  let product: string;
  let overridden: string;
  const COOKIE = `stub-rp182-surfaces-${randomUUID().slice(0, 8)}`;
  /** A 23 % rule for simple products, so a buyer that pays VAT reads a rate the payers' 0 % can differ from. */
  const TAX_CODE = `rp182-vat-${randomUUID().slice(0, 8)}`;
  let category: string;
  let categorised: string;
  let tileSource: string;
  const SESSION = { b2b_session: COOKIE };

  const get = (url: string) => h.app.inject({ method: 'GET', url, cookies: SESSION });
  const put = (url: string, payload: unknown, cookies: Record<string, string> = SESSION) =>
    h.app.inject({ method: 'PUT', url, cookies, payload: payload as object });

  async function override(scope: 'organization' | 'product', targetId: string, mode: 'gross_only' | 'net_only' | 'both' | 'none') {
    await h.em().getConnection().execute(
      `insert into price_display_mode_overrides (scope, target_id, mode, created_at, updated_at) values (?, ?, ?, now(), now())
       on conflict (scope, target_id) do update set mode = excluded.mode, updated_at = now()`,
      [scope, targetId, mode],
    );
  }

  const listing = async (id: string) => {
    const res = await get(`/api/v1/catalog/products?ids=${id}`);
    expect(res.statusCode, res.body).toBe(200);
    return (res.json().data as Array<{ id: string; price: { amount: number } | null; vatRate?: number | null }>).find((p) => p.id === id);
  };
  const detail = async (id: string) => {
    const res = await get(`/api/v1/catalog/products/${id}`);
    expect(res.statusCode, res.body).toBe(200);
    return res.json().data as { price: { amount: number } | null; vatRate?: number | null };
  };
  const cartLine = async (id: string) => {
    const res = await get('/api/v1/cart');
    expect(res.statusCode, res.body).toBe(200);
    return (res.json().data.items as Array<{ productId: string; unitPrice: { amount: number }; taxRate?: number | null }>).find(
      (i) => i.productId === id,
    );
  };
  const buyFor = async (payer: string | null) => {
    const res = await put('/api/v1/cart/buying-for', { payerOrganizationId: payer });
    expect(res.statusCode, res.body).toBe(200);
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    channelId = (await em.findOneOrFail(SalesChannel, { systemDefault: true })).id;
    expect((await put('/api/v1/admin/settings/related_payers.enabled/value', { scope: 'all', value: true }, ADMIN)).statusCode).toBe(200);
    x = await makeOrganization(em, 'Surfaces buyer X');
    y1 = await makeOrganization(em, 'Surfaces payer Y1');
    y2 = await makeOrganization(em, 'Surfaces payer Y2');
    await em.getConnection().execute(
      `update organizations set vat_status = 'reverse_charge', registered_address = jsonb_set(registered_address, '{country}', '"DE"') where id = ?`,
      [y1],
    );
    await em.getConnection().execute(`update organizations set vat_status = 'vat_exempt' where id = ?`, [y2]);
    await makeAddress(em, y1, 'billing');
    await makeAddress(em, y2, 'billing');
    const accountId = randomUUID();
    await withSystemScope('test seed: surfaces buyer', async () => {
      em.create(CustomerAccount, {
        id: accountId,
        organizationId: x,
        email: `rp182-surfaces-${accountId.slice(0, 8)}@example.com`,
        passwordHash: 'not-a-real-hash',
        firstName: 'Surfaces',
        lastName: 'Buyer',
        organizationRoleId: await predefinedRoleIdOf(em, x, 'administrator'),
        emailVerifiedAt: new Date(),
        blockedAt: null,
      } as never);
      await em.flush();
    });
    CUSTOMER_COOKIES[COOKIE] = { customerAccountId: accountId, organizationId: x };
    em.create(Tax, { code: TAX_CODE, name: TAX_CODE, rate: '0.2300', productType: 'simple', priority: 1000 } as never);
    await em.flush();
    product = await createUnpricedProduct(h, `rp182-s-${randomUUID().slice(0, 8)}`);
    overridden = await createUnpricedProduct(h, `rp182-o-${randomUUID().slice(0, 8)}`);
    tileSource = await createUnpricedProduct(h, `rp182-t-${randomUUID().slice(0, 8)}`);
    const cat = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/categories',
      cookies: ADMIN,
      payload: { name: { en: 'RP182 category' }, slug: `rp182-cat-${randomUUID().slice(0, 8)}` },
    });
    expect(cat.statusCode, cat.body).toBe(201);
    category = cat.json().data.id;
    const made = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      cookies: ADMIN,
      payload: {
        sku: `RP182-CAT-${randomUUID().slice(0, 8)}`,
        type: 'simple',
        name: 'Categorised',
        description: '',
        categoryIds: [category],
        attributeValues: {},
        visibility: 'public',
        status: 'active',
      },
    });
    expect(made.statusCode, made.body).toBe(201);
    categorised = made.json().data.id;
    // Cross-sell: the tile shows `product` from `tileSource`'s page.
    const linked = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${tileSource}/links`,
      cookies: ADMIN,
      payload: { links: [{ targetProductId: product, kind: 'cross_sell' }] },
    });
    expect(linked.statusCode, linked.body).toBe(201);
    // X's own book: 5, so its own context has a price and a 23 % rate to compare with.
    await seedPriceBookSql(em, {
      name: `Surfaces buyer ${x.slice(0, 8)}`,
      audience: { organizations: [x] },
      channelIds: [channelId],
      rows: [
        { productId: product, fixed: '5' },
        { productId: tileSource, fixed: '5' },
      ],
    });
    for (const [payer, amount] of [
      [y1, '50'],
      [y2, '60'],
    ] as const) {
      await seedPriceBookSql(em, {
        name: `Surfaces ${payer.slice(0, 8)}`,
        audience: { organizations: [payer] },
        channelIds: [channelId],
        rows: [
          { productId: product, fixed: amount },
          { productId: overridden, fixed: amount },
          { productId: categorised, fixed: amount },
          { productId: tileSource, fixed: amount },
        ],
      });
      const link = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/organizations/${x}/related-payers`,
        cookies: ADMIN,
        payload: { payerOrganizationId: payer, commercialTerms: 'payer' },
      });
      expect(link.statusCode, link.body).toBe(201);
    }
    // RP-14 — X's display mode is the one shown; Y1's `none` must not hide prices from X.
    await override('organization', x, 'gross_only');
    await override('organization', y1, 'none');
    // Product- and category-level overrides still win over X's organization mode.
    await override('product', overridden, 'net_only');
    await h.em().getConnection().execute(
      `insert into price_display_mode_overrides (scope, target_id, mode, created_at, updated_at) values ('category', ?, 'both', now(), now())`,
      [category],
    );
    // Control: X's own context — X's price and X's 23 %.
    expect(await listing(product)).toMatchObject({ price: { amount: 5 }, vatRate: 0.23 });
  }, 5 * 60_000);

  afterAll(async () => {
    delete CUSTOMER_COOKIES[COOKIE];
    await h.em().nativeDelete(PriceDisplayModeOverride, { targetId: { $in: [x, y1, overridden, category] } } as never);
    await h.em().nativeDelete(Tax, { code: TAX_CODE });
    await teardownBackendServer(h);
  });

  it('Y1 reverse_charge: listing, product page, price endpoint and cart at Y1\'s price with Y1\'s 0 % VAT', async () => {
    // The cart must hold a line before it can be bought for a payer's prices to be seen on it.
    await buyFor(y1);
    const add = await h.app.inject({ method: 'POST', url: '/api/v1/cart/items', cookies: SESSION, payload: { productId: product, quantity: 1 } });
    expect(add.statusCode, add.body).toBe(200);
    expect(await listing(product)).toMatchObject({ price: { amount: 50 }, vatRate: 0 });
    expect(await detail(product)).toMatchObject({ price: { amount: 50 }, vatRate: 0 });
    const resolved = await get(`/api/v1/storefront/products/${product}/resolved-price?quantity=1`);
    expect(resolved.statusCode, resolved.body).toBe(200);
    const r = resolved.json().data.resolvedPrice as { basePrice: { amount: string } | null; salePrice: { amount: string } | null };
    expect(Number((r.salePrice ?? r.basePrice)?.amount)).toBe(50);
    expect(await cartLine(product)).toMatchObject({ unitPrice: { amount: 50 }, taxRate: 0 });
  });

  it('the display mode is X\'s: Y1\'s `none` hides nothing, price sort is offered', async () => {
    const mode = await get(`/api/v1/storefront/pricing/display-mode/${product}`);
    expect(mode.statusCode, mode.body).toBe(200);
    expect(mode.json().data.displayMode).toBe('gross_only');
    const sorted = await get('/api/v1/catalog/products?sort=price&limit=5');
    expect(sorted.statusCode, sorted.body).toBe(200);
  });

  it('product- and category-level overrides still win over X\'s organization mode', async () => {
    const mode = await get(`/api/v1/storefront/pricing/display-mode/${overridden}`);
    expect(mode.statusCode, mode.body).toBe(200);
    expect(mode.json().data.displayMode).toBe('net_only');
    const byCategory = await get(`/api/v1/storefront/pricing/display-mode/${categorised}`);
    expect(byCategory.statusCode, byCategory.body).toBe(200);
    expect(byCategory.json().data.displayMode).toBe('both');
  });

  it('cross-sell tiles and the comparison price as Y1', async () => {
    const tiles = await get(`/api/v1/catalog/products/${tileSource}/links?kind=cross_sell`);
    expect(tiles.statusCode, tiles.body).toBe(200);
    const tile = (tiles.json().data as Array<{ product: { id: string; price: { amount: number } | null } }>).find((t) => t.product.id === product);
    expect(tile?.product.price?.amount).toBe(50);
    const added = await h.app.inject({ method: 'POST', url: '/api/v1/comparisons/me/products', cookies: SESSION, payload: { productId: product } });
    expect([200, 201]).toContain(added.statusCode);
    const comparison = await get('/api/v1/comparisons/me');
    expect(comparison.statusCode, comparison.body).toBe(200);
    const column = (comparison.json().data.products as Array<{ id: string; price: { amount: number } | null }>).find((p) => p.id === product);
    expect(column?.price?.amount).toBe(50);
  });

  it('Y2 vat_exempt: Y2\'s price and 0 % VAT', async () => {
    await buyFor(y2);
    expect(await listing(product)).toMatchObject({ price: { amount: 60 }, vatRate: 0 });
    expect(await cartLine(product)).toMatchObject({ unitPrice: { amount: 60 }, taxRate: 0 });
  });

  it('X\'s own mode `none`: prices withheld and price sort refused, as today', async () => {
    await override('organization', x, 'none');
    try {
      expect((await listing(product))?.price).toBeNull();
      const sorted = await get('/api/v1/catalog/products?sort=price&limit=5');
      expect(sorted.statusCode, sorted.body).toBe(400);
      expect(sorted.json().error.code).toBe('PRICE_ORDERING_UNAVAILABLE');
    } finally {
      await override('organization', x, 'gross_only');
    }
  });

  it('switching back restores X\'s own context: X\'s price and X\'s VAT (SC-009)', async () => {
    await buyFor(null);
    expect(await listing(product)).toMatchObject({ price: { amount: 5 }, vatRate: 0.23 });
    expect(await cartLine(product)).toMatchObject({ unitPrice: { amount: 5 }, taxRate: 0.23 });
  });
});
