import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ERROR_CODES } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T118 — Contract test for the public bundle-configuration validation
 * endpoint (feature 002 US5). This is the only POST on the public
 * surface — pure compute, no state mutation.
 *
 *   POST /api/v1/catalog/products/:idOrSlug/bundle-configuration/validate
 *   Body: { selections: [{ slotId, optionId, quantity }, ...] }
 *   Response: { valid, errors: [{ code, slotId?, message }], resolvedSelections }
 *
 * Errors surface inside the response envelope (`errors[]`), not as
 * non-2xx — the storefront's bundle configurator wants the structured
 * list so it can highlight the offending slot. HTTP-level rejections
 * (404, 400 VALIDATION_FAILED for malformed body) still apply.
 *
 * Per Constitution Principle III: written FIRST, fails for the right
 * reason — endpoint doesn't exist yet.
 */

describe('Public bundle-configuration validation contract (T118)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const adminCookie = { b2b_session: 'stub-admin-session' };

  async function createProduct(
    suffix: string,
    type: 'simple' | 'bundle' = 'simple',
  ): Promise<{ id: string; slug: string }> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: {
        sku: `BV-${type.toUpperCase()}-${suffix}`,
        type,
        name: { 'en-US': `BV ${type} ${suffix}` },
        description: { 'en-US': '' },
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(201);
    const data = (res.json() as { data: { id: string; slug: string } }).data;
    const conn = h.orm.em.getConnection();
    const [retail] = await conn.execute<{ id: string }[]>(
      `select id from sales_channels where code = 'pl_retail'`,
    );
    if (retail) {
      await conn.execute(
        `insert into sales_channel_products (sales_channel_id, product_id) values (?, ?) on conflict do nothing`,
        [retail.id, data.id],
      );
    }
    await conn.execute(`update products set status = 'active' where id = ?`, [data.id]);
    return data;
  }

  async function setupBundle(
    suffix: string,
  ): Promise<{
    parent: { id: string; slug: string };
    slot: { id: string };
    optionA: { id: string; productId: string };
    optionB: { id: string; productId: string };
  }> {
    const parent = await createProduct(suffix, 'bundle');
    const optionAProd = await createProduct(`${suffix}-OA`);
    const optionBProd = await createProduct(`${suffix}-OB`);

    const slotRes = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${parent.id}/bundle-slots`,
      payload: { name: { 'en-US': 'Pick' }, minQuantity: 1, maxQuantity: 3 },
      cookies: adminCookie,
    });
    expect(slotRes.statusCode).toBe(201);
    const slotId = (slotRes.json() as { data: { id: string } }).data.id;

    const optA = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${parent.id}/bundle-slots/${slotId}/options`,
      payload: { optionProductId: optionAProd.id },
      cookies: adminCookie,
    });
    const optAId = (optA.json() as { data: { id: string } }).data.id;
    const optB = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${parent.id}/bundle-slots/${slotId}/options`,
      payload: { optionProductId: optionBProd.id },
      cookies: adminCookie,
    });
    const optBId = (optB.json() as { data: { id: string } }).data.id;

    return {
      parent,
      slot: { id: slotId },
      optionA: { id: optAId, productId: optionAProd.id },
      optionB: { id: optBId, productId: optionBProd.id },
    };
  }

  it('happy path: { valid: true, errors: [] } when all slots satisfied', async () => {
    const { parent, slot, optionA } = await setupBundle('HAPPY');
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/catalog/products/${parent.slug}/bundle-configuration/validate`,
      payload: {
        selections: [{ slotId: slot.id, optionId: optionA.id, quantity: 2 }],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { valid: boolean; errors: Array<{ code: string }> };
    };
    expect(body.data.valid).toBe(true);
    expect(body.data.errors.length).toBe(0);
  });

  it('MIN_NOT_MET: slot requires 1 but no selection provided', async () => {
    const { parent, slot } = await setupBundle('MIN');
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/catalog/products/${parent.slug}/bundle-configuration/validate`,
      payload: { selections: [] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { valid: boolean; errors: Array<{ code: string; slotId?: string }> };
    };
    expect(body.data.valid).toBe(false);
    const minError = body.data.errors.find((e) => e.code === 'MIN_NOT_MET');
    expect(minError).toBeDefined();
    expect(minError?.slotId).toBe(slot.id);
  });

  it('MAX_EXCEEDED: total selected quantity > max', async () => {
    const { parent, slot, optionA } = await setupBundle('MAX');
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/catalog/products/${parent.slug}/bundle-configuration/validate`,
      payload: {
        selections: [{ slotId: slot.id, optionId: optionA.id, quantity: 99 }],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { valid: boolean; errors: Array<{ code: string }> };
    };
    expect(body.data.valid).toBe(false);
    expect(body.data.errors.some((e) => e.code === 'MAX_EXCEEDED')).toBe(true);
  });

  it('UNKNOWN_OPTION: optionId not part of slot', async () => {
    const { parent, slot } = await setupBundle('UNK');
    const fakeOption = '00000000-0000-4000-8000-00000000ffff';
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/catalog/products/${parent.slug}/bundle-configuration/validate`,
      payload: {
        selections: [{ slotId: slot.id, optionId: fakeOption, quantity: 1 }],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { valid: boolean; errors: Array<{ code: string }> };
    };
    expect(body.data.valid).toBe(false);
    expect(body.data.errors.some((e) => e.code === 'UNKNOWN_OPTION')).toBe(true);
  });

  it('400 PRODUCT_TYPE_MISMATCH when product is not a bundle', async () => {
    const simple = await createProduct('NB', 'simple');
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/catalog/products/${simple.slug}/bundle-configuration/validate`,
      payload: { selections: [] },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.PRODUCT_TYPE_MISMATCH,
    );
  });
});
