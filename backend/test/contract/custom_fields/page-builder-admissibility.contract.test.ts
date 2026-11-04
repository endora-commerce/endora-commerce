import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 172 (`specs/172-product-content-attributes/`, FR-002, research R-5) —
 * the generic custom-field definition routes never accept the `page_builder`
 * value type: it is admissible only on an entity type whose registry entry
 * offers it (`product`), and product definitions are the catalogue's to write.
 */
const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };

function definition(entityType: string, key: string, valueType: string): Record<string, unknown> {
  return {
    entityType,
    key,
    label: { en: 'Guide' },
    labelDefault: 'Guide',
    valueType,
    required: false,
    audience: 'internal',
    sortOrder: 0,
    config: {},
    carryTo: [],
    options: [],
  };
}

describe('Custom Fields — page_builder admissibility [contract]', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('refuses a page_builder definition on an order with 400 value_type_unsupported, storing nothing', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/custom-fields/definitions',
      ...ADMIN,
      payload: definition('order', 'cf172_order_guide', 'page_builder'),
    });
    expect(res.statusCode, res.body).toBe(400);
    const body = res.json() as { error: { code: string; details?: { code?: string } } };
    expect(body.error.code).toBe('CUSTOM_FIELD_DEFINITION_INVALID');
    expect(body.error.details?.code).toBe('value_type_unsupported');

    const list = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/custom-fields/definitions?entityType=order',
      ...ADMIN,
    });
    const keys = (list.json() as { data: Array<{ key: string }> }).data.map((row) => row.key);
    expect(keys).not.toContain('cf172_order_guide');
  });

  it('refuses turning an order definition into page_builder (value type locked)', async () => {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/custom-fields/definitions',
      ...ADMIN,
      payload: definition('order', 'cf172_order_note', 'text'),
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = (created.json() as { data: { id: string } }).data.id;

    const patch = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/custom-fields/definitions/${id}`,
      ...ADMIN,
      payload: { valueType: 'page_builder' },
    });
    expect(patch.statusCode, patch.body).toBe(409);
    expect((patch.json() as { error: { code: string } }).error.code).toBe('CUSTOM_FIELD_VALUE_TYPE_LOCKED');

    const read = await h.app.inject({ method: 'GET', url: `/api/v1/admin/custom-fields/definitions/${id}`, ...ADMIN });
    expect((read.json() as { data: { valueType: string } }).data.valueType).toBe('text');
  });

  it('refuses a PATCH turning a product definition into page_builder', async () => {
    const attribute = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/attributes',
      cookies: ADMIN.cookies,
      payload: {
        key: 'cf172_product_note',
        label: { 'en-US': 'Note' },
        type: 'input',
        isSearchable: false,
        isFilterable: false,
        isVariantAxis: false,
      },
    });
    expect(attribute.statusCode, attribute.body).toBe(201);
    const definitionId = (attribute.json() as { data: { customFieldDefinitionId: string } }).data
      .customFieldDefinitionId;

    const patch = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/custom-fields/definitions/${definitionId}`,
      ...ADMIN,
      payload: { valueType: 'page_builder' },
    });
    expect(patch.statusCode, patch.body).toBe(409);

    const read = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/catalog/attributes/cf172_product_note',
      cookies: ADMIN.cookies,
    });
    expect((read.json() as { data: { valueType: string } }).data.valueType).toBe('string');
  });
});
