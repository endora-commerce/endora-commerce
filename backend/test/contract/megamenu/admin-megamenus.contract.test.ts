import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@b2b/contracts';
import {
  setupBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '../../../src/modules/sales_channels/entities/sales-channel.entity.js';

describe('admin Megamenu CRUD contract (T021)', () => {
  let h: BackendServerHandle;
  let defaultChannelId: string;
  const adminCookie = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
    const channel = await h.em().findOneOrFail(SalesChannel, { systemDefault: true });
    defaultChannelId = channel.id;
  });

  afterAll(async () => {
    await h.app.close();
    h.redis.disconnect();
    await h.orm.close(true);
  });

  async function createMenu(name = `Menu ${Date.now()}`): Promise<{ id: string; version: number }> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/megamenu/menus',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ name, description: null }),
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { data: { id: string; version: number } }).data;
  }

  it('creates, fetches, patches, and deletes a Megamenu', async () => {
    const created = await createMenu('Initial');
    expect(created.version).toBe(1);

    const fetched = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/megamenu/menus/${created.id}`,
      cookies: adminCookie,
    });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json()).toMatchObject({
      data: { id: created.id, name: 'Initial', items: [], bindings: [], activeIn: 0 },
    });

    const patched = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/megamenu/menus/${created.id}`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ name: 'Renamed', version: created.version }),
    });
    expect(patched.statusCode).toBe(200);

    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/megamenu/menus/${created.id}`,
      cookies: adminCookie,
    });
    expect(del.statusCode).toBe(204);
  });

  it('rejects PATCH with stale version (VERSION_CONFLICT)', async () => {
    const created = await createMenu();
    const patch = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/megamenu/menus/${created.id}`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ name: 'Stale', version: 99 }),
    });
    expect(patch.statusCode).toBe(409);
    expect(patch.json()).toMatchObject({ error: { code: ERROR_CODES.VERSION_CONFLICT } });
  });

  it('refuses DELETE while a binding has active=true and allows it after deactivation', async () => {
    const created = await createMenu();
    // Add a single child item so activate is allowed.
    const setItems = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/megamenu/menus/${created.id}/items`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        items: [
          {
            parentId: null,
            position: 0,
            kind: 'external-link',
            labels: { 'en-US': 'Phone' },
            target: { url: 'tel:+48123456789' },
          },
        ],
        version: created.version,
      }),
    });
    expect(setItems.statusCode).toBe(200);

    const bind = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/megamenu/menus/${created.id}/bindings`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ salesChannelId: defaultChannelId, language: 'en-US' }),
    });
    expect(bind.statusCode).toBe(201);

    const activate = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/megamenu/menus/${created.id}/activate`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ salesChannelId: defaultChannelId, language: 'en-US' }),
    });
    expect(activate.statusCode).toBe(200);

    const refused = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/megamenu/menus/${created.id}`,
      cookies: adminCookie,
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ error: { code: ERROR_CODES.MEGAMENU_HAS_ACTIVE_BINDINGS } });

    const deactivate = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/megamenu/menus/${created.id}/deactivate`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ salesChannelId: defaultChannelId, language: 'en-US' }),
    });
    expect(deactivate.statusCode).toBe(200);

    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/megamenu/menus/${created.id}`,
      cookies: adminCookie,
    });
    expect(del.statusCode).toBe(204);
  });
});
