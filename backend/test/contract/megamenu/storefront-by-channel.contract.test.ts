import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';

describe('storefront megamenu /by-channel contract (T024)', () => {
  let h: BackendServerHandle;
  let defaultChannelId: string;
  let defaultChannelCode: string;
  const adminCookie = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
    const channel = await h.em().findOneOrFail(SalesChannel, { systemDefault: true });
    defaultChannelId = channel.id;
    defaultChannelCode = channel.code;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function createAndActivate(): Promise<string> {
    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/megamenu/menus',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ name: `M ${Date.now()}` }),
    });
    const menu = (create.json() as { data: { id: string; version: number } }).data;

    const items = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/megamenu/menus/${menu.id}/items`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        items: [
          {
            parentId: null,
            position: 0,
            kind: 'external-link',
            labels: { 'en-US': 'Phone', 'pl-PL': 'Telefon' },
            target: { url: 'tel:+48123456789' },
          },
        ],
        version: menu.version,
      }),
    });
    expect(items.statusCode).toBe(200);

    const bind = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/megamenu/menus/${menu.id}/bindings`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ salesChannelId: defaultChannelId, language: 'en-US' }),
    });
    expect(bind.statusCode).toBe(201);

    const activate = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/megamenu/menus/${menu.id}/activate`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ salesChannelId: defaultChannelId, language: 'en-US' }),
    });
    expect(activate.statusCode).toBe(200);
    return menu.id;
  }

  it('returns the active megamenu with resolved labels for the requested scope', async () => {
    const menuId = await createAndActivate();
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/megamenu/by-channel?language=en-US',
      headers: { 'x-sales-channel': defaultChannelCode },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: {
        megamenuId: string;
        language: string;
        items: Array<{
          kind: string;
          label: string;
          url?: string;
          children: unknown[];
        }>;
      };
    };
    expect(body.data.megamenuId).toBe(menuId);
    expect(body.data.language).toBe('en-US');
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0]?.kind).toBe('external-link');
    expect(body.data.items[0]?.label).toBe('Phone');
    expect(body.data.items[0]?.url).toBe('tel:+48123456789');
  });

  it('returns 404 MEGAMENU_NOT_FOUND when no active binding for the (valid) scope', async () => {
    // Pass a language with no active binding (the helper only activates
    // en-US, so pl-PL has nothing — but it IS in the channel's language
    // set, so the sales-channel-resolver middleware lets us through).
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/megamenu/by-channel?language=pl-PL',
      headers: { 'x-sales-channel': defaultChannelCode },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: ERROR_CODES.MEGAMENU_NOT_FOUND } });
  });
});
