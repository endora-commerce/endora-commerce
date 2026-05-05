import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 012 / T055 — Promotion attribute-criterion contract (US8).
 *
 * Covers `contracts/promotions-attribute-criterion.contract.md`:
 *   - GET /api/v1/admin/promotions/rule-targets/attributes returns every
 *     `isPromoRule = true` attribute with its `valueType` + (for select-style)
 *     options inline.
 *   - POST /api/v1/admin/promotions accepts the `'attribute'` criterion
 *     variant, with per-`valueType` validation:
 *       * `attribute_not_promo_eligible` when `isPromoRule = false`
 *       * `attribute_not_found`          when the key is unknown
 *       * `invalid_criterion_op`         when op is not in the valueType's
 *         allowed list
 *       * `invalid_criterion_values`     when the values shape is wrong
 *       * `invalid_option_value`         for select-style attributes when
 *         a value is not in the option list
 */
describe('Promotion attribute criterion (T055)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const adminCookie = { b2b_session: 'stub-admin-session' };

  beforeEach(async () => {
    await h.em().getConnection().execute('truncate table promotions cascade');
    // Reset the seeded `material` attribute back to non-promo so each test
    // can opt into the flag explicitly.
    await h.app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/catalog/attributes/material',
      payload: { isPromoRule: false },
      cookies: adminCookie,
    });
  });

  it('omits the attribute from the picker until isPromoRule is flipped on', async () => {
    const before = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/promotions/rule-targets/attributes',
      cookies: adminCookie,
    });
    expect(before.statusCode).toBe(200);
    const beforeBody = before.json() as { data: { items: Array<{ key: string }> } };
    expect(beforeBody.data.items.find((i) => i.key === 'material')).toBeUndefined();

    await h.app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/catalog/attributes/material',
      payload: { isPromoRule: true },
      cookies: adminCookie,
    });

    const after = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/promotions/rule-targets/attributes',
      cookies: adminCookie,
    });
    expect(after.statusCode).toBe(200);
    const afterBody = after.json() as {
      data: { items: Array<{ key: string; valueType: string; options?: Array<{ value: string }> }> };
    };
    const item = afterBody.data.items.find((i) => i.key === 'material');
    expect(item).toBeDefined();
    expect(item?.valueType).toBe('enum');
    // Seed populated steel/aluminium/plastic options.
    expect(item?.options?.map((o) => o.value).sort()).toEqual(['aluminium', 'plastic', 'steel']);
  });

  it('accepts a well-formed attribute criterion when the attribute is promo-eligible', async () => {
    await h.app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/catalog/attributes/material',
      payload: { isPromoRule: true },
      cookies: adminCookie,
    });

    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/promotions',
      payload: {
        name: '10% off brass',
        kind: 'percentage_off',
        value: 10,
        criteria: [
          { type: 'attribute', attributeKey: 'material', op: 'in', values: ['steel'] },
        ],
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(201);
  });

  it('rejects a criterion when the attribute is not promo-eligible', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/promotions',
      payload: {
        name: 'Should not save',
        kind: 'percentage_off',
        value: 10,
        criteria: [
          { type: 'attribute', attributeKey: 'material', op: 'in', values: ['steel'] },
        ],
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/attribute_not_promo_eligible/);
  });

  it('rejects a criterion referencing an unknown attribute', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/promotions',
      payload: {
        name: 'Should not save',
        kind: 'percentage_off',
        value: 10,
        criteria: [
          { type: 'attribute', attributeKey: 'no_such_attr', op: 'equals', values: ['x'] },
        ],
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/attribute_not_found/);
  });

  it('rejects an op that is not allowed for the attribute valueType', async () => {
    await h.app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/catalog/attributes/material',
      payload: { isPromoRule: true },
      cookies: adminCookie,
    });
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/promotions',
      payload: {
        name: 'Range on enum?',
        kind: 'percentage_off',
        value: 10,
        criteria: [
          { type: 'attribute', attributeKey: 'material', op: 'range', values: [1, 2] },
        ],
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/invalid_criterion_op/);
  });

  it('rejects an option value that is not part of the attribute option list', async () => {
    await h.app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/catalog/attributes/material',
      payload: { isPromoRule: true },
      cookies: adminCookie,
    });
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/promotions',
      payload: {
        name: 'Bad option',
        kind: 'percentage_off',
        value: 10,
        criteria: [
          { type: 'attribute', attributeKey: 'material', op: 'in', values: ['unobtainium'] },
        ],
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/invalid_option_value/);
  });
});
