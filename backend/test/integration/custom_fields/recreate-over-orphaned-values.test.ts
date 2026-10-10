import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };

/**
 * Deleting a definition keeps its stored values (a mis-deletion is
 * recoverable). Re-creating the key as a customer-visible field would answer
 * those old values — written when the field may have been internal — to
 * customers at once, so that one step is refused: the field comes back as
 * internal, and opening it is a second, deliberate change.
 */
describe('custom_fields — re-creating a key over values a deleted field left behind', () => {
  let h: BackendServerHandle;
  const key = `orphaned_${randomUUID().replace(/-/g, '').slice(0, 10)}`;

  const create = (k: string, audience: 'customer' | 'internal') =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/custom-fields/definitions',
      ...ADMIN,
      payload: {
        entityType: 'organization',
        key: k,
        label: {},
        labelDefault: k,
        valueType: 'text',
        required: false,
        audience,
        sortOrder: 0,
        config: {},
        options: [],
      },
    });

  beforeAll(async () => {
    h = await setupBackendServer();
    await h
      .em()
      .getConnection()
      .execute(
        `update "organizations" set custom_field_values = custom_field_values || ?::jsonb where id = ?`,
        [JSON.stringify({ [key]: 'written while the field was internal' }), TEST_ORGANIZATION_ID],
      );
  });
  afterAll(async () => {
    await h
      .em()
      .getConnection()
      .execute(`update "organizations" set custom_field_values = custom_field_values - ? where id = ?`, [
        key,
        TEST_ORGANIZATION_ID,
      ]);
    await teardownBackendServer(h);
  });

  it('refuses a customer-visible definition over stored values', async () => {
    const res = await create(key, 'customer');
    expect(res.statusCode, res.body).toBe(409);
    expect(res.body).toContain('Create the field as internal');
  });

  it('accepts it as internal, and then lets the audience be opened deliberately', async () => {
    const res = await create(key, 'internal');
    expect(res.statusCode, res.body).toBe(201);
    const id = (res.json() as { data: { id: string } }).data.id;
    const opened = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/custom-fields/definitions/${id}`,
      ...ADMIN,
      payload: { audience: 'customer' },
    });
    expect(opened.statusCode, opened.body).toBe(200);
    expect((opened.json() as { data: { audience: string } }).data.audience).toBe('customer');
  });

  it('creates a customer-visible definition under a key nothing is stored under', async () => {
    const res = await create(`fresh_${randomUUID().replace(/-/g, '').slice(0, 10)}`, 'customer');
    expect(res.statusCode, res.body).toBe(201);
  });
});
