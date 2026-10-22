import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 160 (FR-043) — a product has no price of its own any more: a price
 * is a row of a price book (D-287 §5.8). Product and variant create, update and
 * import **refuse** the old fields — the product *default price*
 * (`attributeValues.defaultPrice`, `attributeValues.price`) and the variant
 * price override (`priceOverride`) — with `400 PRICE_SET_IN_PRICE_BOOKS`,
 * rather than storing them where nothing reads them or dropping them silently.
 * A refused write changes nothing.
 */
describe('catalog — the old price fields are refused (FR-043)', () => {
  let h: BackendServerHandle;
  const cookies = { b2b_session: 'stub-admin-session' };
  const stamp = randomUUID().slice(0, 8);

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const productPayload = (sku: string, attributeValues: Record<string, unknown> = {}, type = 'simple') => ({
    sku,
    type,
    name: { 'en-US': sku },
    description: { 'en-US': '' },
    categoryIds: [],
    attributeValues,
    visibility: 'public',
  });

  async function create(sku: string, type = 'simple'): Promise<string> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: productPayload(sku, {}, type),
      cookies,
    });
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { data: { id: string } }).data.id;
  }

  const expectRefused = (res: { statusCode: number; body: string; json: () => unknown }) => {
    expect(res.statusCode, res.body).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.PRICE_SET_IN_PRICE_BOOKS);
  };

  const skuExists = async (sku: string) =>
    (await h.em().getConnection().execute<Array<{ n: string }>>(`select count(*) as n from products where sku = ?`, [sku]))[0]!
      .n !== '0';

  it.each(['defaultPrice', 'price'])('create refuses attributeValues.%s and creates nothing', async (key) => {
    const sku = `PFR-CREATE-${key}-${stamp}`;
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: productPayload(sku, { [key]: 49.99 }),
      cookies,
    });
    expectRefused(res);
    expect(await skuExists(sku)).toBe(false);
  });

  it('create refuses a top-level defaultPrice too', async () => {
    const sku = `PFR-CREATE-TOP-${stamp}`;
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: { ...productPayload(sku), defaultPrice: 49.99 },
      cookies,
    });
    expectRefused(res);
    expect(await skuExists(sku)).toBe(false);
  });

  it.each(['defaultPrice', 'price'])('update refuses attributeValues.%s and changes nothing', async (key) => {
    const sku = `PFR-UPDATE-${key}-${stamp}`;
    const id = await create(sku);
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${id}`,
      payload: { name: { 'en-US': 'Renamed' }, attributeValues: { [key]: 12 } },
      cookies,
    });
    expectRefused(res);
    const [row] = await h
      .em()
      .getConnection()
      .execute<Array<{ name: Record<string, string>; attribute_values: Record<string, unknown> }>>(
        `select name, attribute_values from products where id = ?`,
        [id],
      );
    expect(row!.name['en-US']).toBe(sku);
    expect(row!.attribute_values).not.toHaveProperty(key);
  });

  it('a product without them is created and updated as before', async () => {
    const id = await create(`PFR-PLAIN-${stamp}`);
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${id}`,
      payload: { name: { 'en-US': 'Renamed' } },
      cookies,
    });
    expect(res.statusCode, res.body).toBe(200);
  });

  it('variant create refuses priceOverride and creates nothing', async () => {
    const parent = await create(`PFR-CONF-${stamp}`, 'configurable');
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${parent}/variants`,
      payload: { sku: `PFR-VAR-${stamp}`, variantAttributeValues: { color: 'red' }, priceOverride: 49.99 },
      cookies,
    });
    expectRefused(res);
    expect(await skuExists(`PFR-VAR-${stamp}`)).toBe(false);
    const [count] = await h
      .em()
      .getConnection()
      .execute<Array<{ n: string }>>(`select count(*) as n from product_variants where sku = ?`, [`PFR-VAR-${stamp}`]);
    expect(count!.n).toBe('0');
  });

  it('variant update refuses priceOverride; a variant without it is written as before', async () => {
    const parent = await create(`PFR-CONF2-${stamp}`, 'configurable');
    const created = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${parent}/variants`,
      payload: { sku: `PFR-VAR2-${stamp}`, variantAttributeValues: { color: 'blue' }, stockLevel: 3 },
      cookies,
    });
    expect(created.statusCode, created.body).toBe(201);
    const variant = (created.json() as { data: { id: string } }).data;
    expect(variant).not.toHaveProperty('priceOverride');
    const refused = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${parent}/variants/${variant.id}`,
      payload: { priceOverride: 10, stockLevel: 9 },
      cookies,
    });
    expectRefused(refused);
    const [row] = await h
      .em()
      .getConnection()
      .execute<Array<{ stock_level: number }>>(`select stock_level from product_variants where id = ?`, [variant.id]);
    expect(Number(row!.stock_level)).toBe(3);
  });

  it.each(['default_price', 'defaultPrice', 'price', 'price_override'])(
    'the products import refuses a %s column and imports nothing',
    async (column) => {
      const csv = [
        `sku,status,visibility,name_en,description_en,${column}`,
        'EXAMPLE-SIMPLE-001,active,public,Price import,desc,10.00',
      ].join('\n');
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/import/products',
        headers: { 'content-type': 'text/csv', cookie: 'b2b_session=stub-admin-session' },
        payload: csv,
      });
      expectRefused(res);
      const [row] = await h
        .em()
        .getConnection()
        .execute<Array<{ name: Record<string, string> }>>(`select name from products where sku = 'EXAMPLE-SIMPLE-001'`);
      expect(row!.name['en-US']).not.toBe('Price import');
    },
  );
});
