import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { CustomerGroup } from '../../helpers/package-entities.js';

/**
 * Feature 076 (D-79) — the customer-group admin surface, served by
 * `customer_accounts`.
 *
 * Two things are asserted together on purpose. The **paths and payloads are
 * unchanged**: the admin SPA's three pickers call the same URLs they always
 * have, and a relocation that moved them would have been a relocation nobody
 * could deploy. The **gate changed**: `price_lists` served these routes under
 * `catalog:write`, which asks a pricing question about a customer's
 * segmentation. An admin holding only `catalog:write` is refused now, and an
 * admin role has to be granted `customer_groups:read` / `customer_groups:write`
 * deliberately.
 */
const ADMIN_COOKIE = { b2b_session: 'stub-admin-session' };
/** Holds `orders:read` and nothing else — see `helpers/seed-admins.ts`. */
const RESTRICTED_COOKIE = { b2b_session: 'stub-restricted-admin-session' };

describe('Customer-group admin surface (feature 076)', () => {
  let h: BackendServerHandle;
  const code = `cg-crud-${Date.now()}`;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('creates, lists, edits and deletes a group at the unchanged paths', async () => {
    const created = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/customer-groups/${code}`,
      cookies: ADMIN_COOKIE,
      payload: { code, name: 'Wholesale', description: 'Bulk buyers' },
    });
    expect(created.statusCode).toBe(200);
    const createdBody = created.json() as {
      data: { id: string; code: string; name: string; description: string | null };
    };
    expect(createdBody.data.code).toBe(code);
    expect(createdBody.data.name).toBe('Wholesale');
    expect(createdBody.data.description).toBe('Bulk buyers');

    const listed = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/customer-groups',
      cookies: ADMIN_COOKIE,
    });
    expect(listed.statusCode).toBe(200);
    const listBody = listed.json() as { data: Array<{ id: string; code: string }> };
    expect(listBody.data.some((g) => g.code === code)).toBe(true);

    const edited = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/customer-groups/${code}`,
      cookies: ADMIN_COOKIE,
      payload: { code, name: 'Wholesale (EU)' },
    });
    expect(edited.statusCode).toBe(200);
    expect((edited.json() as { data: { name: string } }).data.name).toBe('Wholesale (EU)');

    const removed = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/customer-groups/${createdBody.data.id}`,
      cookies: ADMIN_COOKIE,
    });
    expect(removed.statusCode).toBe(204);
    expect(await h.em().findOne(CustomerGroup, { code })).toBeNull();
  });

  it('refuses an admin who holds neither customer-group code', async () => {
    const read = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/customer-groups',
      cookies: RESTRICTED_COOKIE,
    });
    expect(read.statusCode).toBe(403);

    const write = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/customer-groups/never-created',
      cookies: RESTRICTED_COOKIE,
      payload: { code: 'never-created', name: 'Nope' },
    });
    expect(write.statusCode).toBe(403);
    expect(await h.em().findOne(CustomerGroup, { code: 'never-created' })).toBeNull();
  });

  it('refuses an unauthenticated caller', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/customer-groups' });
    expect([401, 403]).toContain(res.statusCode);
  });
});
