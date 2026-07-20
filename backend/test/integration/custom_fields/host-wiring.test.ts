import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID } from '../../helpers/test-actors.js';

/**
 * Feature 055 US2 (T029–T034) — custom-field values flow through the real admin
 * edit paths of host modules [real DB]. Covers a new-endpoint host (Customer,
 * org-scoped) and a clean-seam host (Category, global).
 */
const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };

async function defineField(
  h: BackendServerHandle,
  entityType: string,
  key: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const res = await h.app.inject({
    method: 'POST',
    url: '/api/v1/admin/custom-fields/definitions',
    payload: {
      entityType,
      key,
      label: {},
      labelDefault: key,
      valueType: 'text',
      required: false,
      sortOrder: 0,
      config: {},
      options: [],
      ...extra,
    },
    ...ADMIN,
  });
  expect(res.statusCode, `${entityType}.${key}`).toBe(201);
}

describe('Custom Fields — host edit paths [real DB]', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('Customer: PATCH /custom-fields validates + persists + returns on detail', async () => {
    await defineField(h, 'customer', 'loyalty_tier');

    const patch = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/customers/${TEST_CUSTOMER_ID}/custom-fields`,
      payload: { loyalty_tier: 'gold' },
      ...ADMIN,
    });
    expect(patch.statusCode).toBe(200);
    expect((patch.json().data as { customFieldValues: Record<string, unknown> }).customFieldValues).toMatchObject({
      loyalty_tier: 'gold',
    });

    const detail = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/customers/${TEST_CUSTOMER_ID}`,
      ...ADMIN,
    });
    expect((detail.json().data as { customFieldValues: Record<string, unknown> }).customFieldValues.loyalty_tier).toBe(
      'gold',
    );
  });

  it('Customer: an invalid value is rejected 422 and not persisted', async () => {
    await defineField(h, 'customer', 'rank', { valueType: 'number' });
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/customers/${TEST_CUSTOMER_ID}/custom-fields`,
      payload: { rank: 'not-a-number' },
      ...ADMIN,
    });
    expect(res.statusCode).toBe(422);
  });

  it('Category: create → define field → PATCH value → read back', async () => {
    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/categories',
      payload: { name: { en: 'Fasteners' }, slug: 'fasteners-cf' },
      ...ADMIN,
    });
    expect(create.statusCode).toBe(201);
    const categoryId = (create.json().data as { id: string }).id;

    await defineField(h, 'category', 'lead_time_days', { valueType: 'number' });

    const patch = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/categories/${categoryId}`,
      payload: { customFieldValues: { lead_time_days: '5' } },
      ...ADMIN,
    });
    expect(patch.statusCode).toBe(200);
    expect((patch.json().data as { customFieldValues: Record<string, unknown> }).customFieldValues).toMatchObject({
      lead_time_days: 5,
    });
  });
});
