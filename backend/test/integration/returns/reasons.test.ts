import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ADMIN_COOKIE, CUSTOMER_COOKIE, resetReturnGraph } from './helpers.js';

/**
 * Feature 046 (US7) — managed reasons + active reasons on the storefront form.
 */
describe('returns — reasons (US7)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await resetReturnGraph(h.em());
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('ships EU-aligned default reasons', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/returns/reasons', cookies: ADMIN_COOKIE });
    expect(res.statusCode).toBe(200);
    const rows = (res.json() as { data: Array<{ appliesTo: string }> }).data;
    expect(rows.length).toBeGreaterThanOrEqual(5);
  });

  it('admin can add, deactivate, and reorder reasons; the storefront sees only active ones in order', async () => {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/returns/reasons',
      cookies: ADMIN_COOKIE,
      payload: { label: { en: 'Custom defect' }, appliesTo: 'complaint', weight: 5 },
    });
    expect(created.statusCode).toBe(201);
    const id = (created.json() as { data: { id: string } }).data.id;

    // Active complaint reasons, ordered by weight — our weight-5 entry leads.
    const active = await h.app.inject({
      method: 'GET',
      url: '/api/v1/returns/reasons?kind=complaint',
      cookies: CUSTOMER_COOKIE,
    });
    const list = (active.json() as { data: Array<{ id: string; appliesTo: string }> }).data;
    expect(list[0]!.id).toBe(id);
    expect(list.every((r) => r.appliesTo === 'complaint' || r.appliesTo === 'both')).toBe(true);

    // Deactivate it — the storefront no longer offers it.
    await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/returns/reasons/${id}`,
      cookies: ADMIN_COOKIE,
      payload: { isActive: false },
    });
    const after = await h.app.inject({
      method: 'GET',
      url: '/api/v1/returns/reasons?kind=complaint',
      cookies: CUSTOMER_COOKIE,
    });
    const afterList = (after.json() as { data: Array<{ id: string }> }).data;
    expect(afterList.some((r) => r.id === id)).toBe(false);
  });
});
