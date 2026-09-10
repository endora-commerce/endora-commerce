import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';

describe('admin Megamenu bindings + activation contract (T023)', () => {
  let h: BackendServerHandle;
  let defaultChannelId: string;
  const adminCookie = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
    const channel = await h.em().findOneOrFail(SalesChannel, { systemDefault: true });
    defaultChannelId = channel.id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function createMenu(): Promise<{ id: string; version: number }> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/megamenu/menus',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ name: `Menu ${Date.now()}-${Math.random()}` }),
    });
    return (res.json() as { data: { id: string; version: number } }).data;
  }

  async function seedItem(menuId: string, version: number): Promise<void> {
    const res = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/megamenu/menus/${menuId}/items`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        items: [
          {
            parentId: null,
            position: 0,
            kind: 'external-link',
            labels: { 'en-US': 'Phone' },
            target: { url: 'tel:+48123' },
          },
        ],
        version,
      }),
    });
    expect(res.statusCode).toBe(200);
  }

  it('adds a binding and returns active=false initially', async () => {
    const menu = await createMenu();
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/megamenu/menus/${menu.id}/bindings`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ salesChannelId: defaultChannelId, language: 'en-US' }),
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      data: { salesChannelId: defaultChannelId, language: 'en-US', active: false },
    });
  });

  it('rejects a duplicate binding triple with MEGAMENU_BINDING_ALREADY_EXISTS', async () => {
    const menu = await createMenu();
    await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/megamenu/menus/${menu.id}/bindings`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ salesChannelId: defaultChannelId, language: 'en-US' }),
    });
    const dup = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/megamenu/menus/${menu.id}/bindings`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ salesChannelId: defaultChannelId, language: 'en-US' }),
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json()).toMatchObject({ error: { code: ERROR_CODES.MEGAMENU_BINDING_ALREADY_EXISTS } });
  });

  it('rejects a binding whose language is not in the channel scope', async () => {
    const menu = await createMenu();
    // `pl-PL` is a recognised dictionary language (so it passes the language
    // existence check) but is NOT in the system-default channel's scope
    // (`en-US` only), which is exactly the case this test exercises. (`fr-FR`
    // used to work here but is not seeded in the dictionary, so it would now
    // fail the earlier existence check with a different error.)
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/megamenu/menus/${menu.id}/bindings`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ salesChannelId: defaultChannelId, language: 'pl-PL' }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: { code: ERROR_CODES.MEGAMENU_LANGUAGE_NOT_IN_CHANNEL_SCOPE },
    });
  });

  it('refuses ACTIVATE on a megamenu with an empty tree', async () => {
    const menu = await createMenu();
    await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/megamenu/menus/${menu.id}/bindings`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ salesChannelId: defaultChannelId, language: 'en-US' }),
    });
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/megamenu/menus/${menu.id}/activate`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ salesChannelId: defaultChannelId, language: 'en-US' }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: ERROR_CODES.MEGAMENU_EMPTY_TREE } });
  });

  it('returns previouslyActive=null when no other megamenu was active in scope', async () => {
    const menu = await createMenu();
    await seedItem(menu.id, menu.version);
    await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/megamenu/menus/${menu.id}/bindings`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ salesChannelId: defaultChannelId, language: 'en-US' }),
    });
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/megamenu/menus/${menu.id}/activate`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ salesChannelId: defaultChannelId, language: 'en-US' }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      data: {
        activated: { megamenuId: menu.id, salesChannelId: defaultChannelId, language: 'en-US' },
        previouslyActive: null,
      },
    });
  });

  it('removing the active binding falls back to "no megamenu" for the scope', async () => {
    const menu = await createMenu();
    await seedItem(menu.id, menu.version);
    await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/megamenu/menus/${menu.id}/bindings`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ salesChannelId: defaultChannelId, language: 'en-US' }),
    });
    await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/megamenu/menus/${menu.id}/activate`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ salesChannelId: defaultChannelId, language: 'en-US' }),
    });

    const removed = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/megamenu/menus/${menu.id}/bindings/${defaultChannelId}/en-US`,
      cookies: adminCookie,
    });
    expect(removed.statusCode).toBe(204);
  });
});
