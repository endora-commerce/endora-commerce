import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

/**
 * Feature 062 / T025 — additive `organizationId` on webhook admin CRUD
 * (contracts/order-webhooks.md §4).
 *
 *  - create without `organizationId` ⇒ platform-wide subscription (NULL,
 *    legacy semantics preserved — FR-015);
 *  - create with `organizationId` ⇒ org-bound subscription, echoed in the
 *    response and on the list;
 *  - PATCH can bind and unbind (set / clear to null);
 *  - existing gate unchanged: `requireAdmin('integrations:manage')`.
 */

const ADMIN_COOKIE = { b2b_session: 'stub-admin-session' };

interface WebhookBody {
  data: {
    id: string;
    name: string;
    organizationId: string | null;
    status: string;
    secret?: string;
  };
}

describe('webhook admin CRUD — organization binding (062/T025)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const createWebhook = async (payload: Record<string, unknown>) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/webhooks',
      payload,
      cookies: ADMIN_COOKIE,
    });

  it('create without organizationId → platform-wide (organizationId null)', async () => {
    const res = await createWebhook({
      name: 'Platform-wide hook',
      url: 'https://receiver.example.com/platform',
      eventTypes: ['order.created.v1'],
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as WebhookBody;
    expect(body.data.organizationId).toBeNull();
    expect(body.data.secret).toMatch(/^[0-9a-f]{64}$/);
  });

  it('create with organizationId → org-bound, echoed on create + list', async () => {
    const res = await createWebhook({
      name: 'Org-bound hook',
      url: 'https://receiver.example.com/org',
      eventTypes: ['order.created.v1'],
      organizationId: TEST_ORGANIZATION_ID,
    });
    expect(res.statusCode).toBe(201);
    const created = (res.json() as WebhookBody).data;
    expect(created.organizationId).toBe(TEST_ORGANIZATION_ID);

    const list = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/webhooks',
      cookies: ADMIN_COOKIE,
    });
    expect(list.statusCode).toBe(200);
    const rows = (list.json() as { data: Array<{ id: string; organizationId: string | null }> })
      .data;
    const row = rows.find((r) => r.id === created.id);
    expect(row).toBeDefined();
    expect(row!.organizationId).toBe(TEST_ORGANIZATION_ID);
  });

  it('PATCH binds and unbinds the organization', async () => {
    const res = await createWebhook({
      name: 'Rebindable hook',
      url: 'https://receiver.example.com/rebind',
      eventTypes: ['order.status_changed.v1'],
    });
    expect(res.statusCode).toBe(201);
    const id = (res.json() as WebhookBody).data.id;

    const bind = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/webhooks/${id}`,
      payload: { organizationId: TEST_ORGANIZATION_ID },
      cookies: ADMIN_COOKIE,
    });
    expect(bind.statusCode).toBe(200);
    expect((bind.json() as WebhookBody).data.organizationId).toBe(TEST_ORGANIZATION_ID);

    const unbind = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/webhooks/${id}`,
      payload: { organizationId: null },
      cookies: ADMIN_COOKIE,
    });
    expect(unbind.statusCode).toBe(200);
    expect((unbind.json() as WebhookBody).data.organizationId).toBeNull();
  });

  it('gate unchanged: anonymous create is refused', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/webhooks',
      payload: {
        name: 'No auth',
        url: 'https://receiver.example.com/no-auth',
        eventTypes: ['order.created.v1'],
      },
    });
    expect([401, 403]).toContain(res.statusCode);
  });
});
