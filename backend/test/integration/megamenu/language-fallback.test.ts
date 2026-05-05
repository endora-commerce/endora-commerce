import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '../../../src/modules/sales_channels/entities/sales-channel.entity.js';

/**
 * T053 — Language fallback. The storefront resolver falls back to the
 * channel's default language when an item's label is missing in the
 * requested language. Items with no label in either the requested
 * language or the channel default are silently omitted.
 */
describe('Megamenu language fallback (T053)', () => {
  let h: BackendServerHandle;
  let multiLangChannelId: string;
  let multiLangChannelCode: string;
  const adminCookie = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
    const em = h.em();
    multiLangChannelCode = `multilang-${Date.now()}`;
    const channel = em.create(SalesChannel, {
      code: multiLangChannelCode,
      name: { 'en-US': 'Multilang' },
      languages: ['en-US', 'pl-PL'],
      defaultLanguage: 'en-US',
      currencies: ['PLN'],
      defaultCurrency: 'PLN',
      active: true,
      systemDefault: false,
      isPublic: true,
      status: 'active',
    });
    await em.persistAndFlush(channel);
    multiLangChannelId = channel.id;
  });

  afterAll(async () => {
    await h.app.close();
    h.redis.disconnect();
    await h.orm.close(true);
  });

  it('falls back to the channel default language when label is missing', async () => {
    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/megamenu/menus',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ name: `Fallback test ${Date.now()}` }),
    });
    const menu = (create.json() as { data: { id: string; version: number } }).data;

    // Three items: one labelled in en-US only, one labelled in pl-PL only,
    // one labelled in both.
    await h.app.inject({
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
            labels: { 'en-US': 'EN only' },
            target: { url: 'https://example.com/a' },
          },
          {
            parentId: null,
            position: 1,
            kind: 'external-link',
            labels: { 'pl-PL': 'PL only' },
            target: { url: 'https://example.com/b' },
          },
          {
            parentId: null,
            position: 2,
            kind: 'external-link',
            labels: { 'en-US': 'Both EN', 'pl-PL': 'Both PL' },
            target: { url: 'https://example.com/c' },
          },
        ],
        version: menu.version,
      }),
    });
    await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/megamenu/menus/${menu.id}/bindings`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ salesChannelId: multiLangChannelId, language: 'pl-PL' }),
    });
    await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/megamenu/menus/${menu.id}/activate`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ salesChannelId: multiLangChannelId, language: 'pl-PL' }),
    });

    // Channel default is 'en-US' (the foundation seed). When we request
    // pl-PL: the EN-only item falls back to 'EN only'; the PL-only item
    // resolves directly; the both-langs item picks pl-PL.
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/megamenu/by-channel?language=pl-PL',
      headers: { 'x-sales-channel': multiLangChannelCode },
    });
    expect(res.statusCode).toBe(200);
    const labels = (res.json() as { data: { items: Array<{ label: string }> } }).data.items.map(
      (i) => i.label,
    );
    expect(labels).toEqual(['EN only', 'PL only', 'Both PL']);
  });

  it('omits items with no label in either the requested language or the channel default', async () => {
    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/megamenu/menus',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ name: `Omit test ${Date.now()}` }),
    });
    const menu = (create.json() as { data: { id: string; version: number } }).data;
    await h.app.inject({
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
            labels: { 'fr-FR': 'Bonjour' },
            target: { url: 'https://example.com/fr' },
          },
        ],
        version: menu.version,
      }),
    });
    await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/megamenu/menus/${menu.id}/bindings`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ salesChannelId: multiLangChannelId, language: 'en-US' }),
    });
    await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/megamenu/menus/${menu.id}/activate`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ salesChannelId: multiLangChannelId, language: 'en-US' }),
    });

    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/megamenu/by-channel?language=en-US',
      headers: { 'x-sales-channel': multiLangChannelCode },
    });
    expect(res.statusCode).toBe(200);
    const items = (res.json() as { data: { items: unknown[] } }).data.items;
    expect(items).toEqual([]);
  });
});
