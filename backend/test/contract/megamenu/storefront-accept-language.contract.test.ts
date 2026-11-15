import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';

/**
 * Issue #1011 — `GET /api/v1/megamenu/by-channel` reads its language from the whole
 * `Accept-Language` header through `requestScopeLanguage`: q-weighted, each tag matched against
 * the channel's languages (exact, then base language), else the channel's default. Before, it
 * took the header's first entry with its `;q=` parameter, so `en;q=0.2, pl-PL;q=0.9` looked up
 * an `en;q=0.2` binding and `pl` a `pl` one, and neither exists.
 *
 * The run's own channel offers `en-US` (default) and `pl-PL`; one menu is active for each. An
 * explicit `?language=` still wins over the header.
 */
describe('Megamenu language from Accept-Language (issue #1011)', () => {
  let h: BackendServerHandle;
  const run = randomUUID().slice(0, 8);
  const adminCookie = { b2b_session: 'stub-admin-session' };
  let channel: SalesChannel;
  const menuIds: string[] = [];

  async function admin(url: string, method: 'POST' | 'PUT', payload: unknown): Promise<{ id: string; version: number }> {
    const res = await h.app.inject({
      method,
      url,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify(payload),
    });
    expect(res.statusCode, res.body).toBeLessThan(300);
    return (res.json() as { data: { id: string; version: number } }).data;
  }

  async function activeMenu(language: string, label: string): Promise<void> {
    const menu = await admin('/api/v1/admin/megamenu/menus', 'POST', { name: `Accept-Language ${language} ${run}` });
    menuIds.push(menu.id);
    await admin(`/api/v1/admin/megamenu/menus/${menu.id}/items`, 'PUT', {
      items: [
        {
          parentId: null,
          presentation: 'mega',
          position: 0,
          kind: 'external-link',
          labels: { [language]: label },
          target: { url: 'tel:+48123456789' },
        },
      ],
      version: menu.version,
    });
    const scope = { salesChannelId: channel.id, language };
    await admin(`/api/v1/admin/megamenu/menus/${menu.id}/bindings`, 'POST', scope);
    await admin(`/api/v1/admin/megamenu/menus/${menu.id}/activate`, 'POST', scope);
  }

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
    const em = h.em();
    channel = em.create(SalesChannel, {
      code: `mm1011-${run}`,
      name: { 'en-US': `Megamenu Accept-Language ${run}` },
      languages: ['en-US', 'pl-PL'],
      defaultLanguage: 'en-US',
      currencies: ['PLN'],
      defaultCurrency: 'PLN',
      active: true,
      systemDefault: false,
      status: 'active',
    });
    await em.persistAndFlush(channel);
    await activeMenu('en-US', 'Phone');
    await activeMenu('pl-PL', 'Telefon');
  });

  afterAll(async () => {
    if (h) {
      const connection = h.em().getConnection();
      for (const id of menuIds) await connection.execute(`delete from megamenus where id = ?`, [id]);
      if (channel) await connection.execute(`delete from sales_channels where id = ?`, [channel.id]);
      await teardownBackendServer(h);
    }
  });

  async function menu(acceptLanguage: string, query = ''): Promise<{ language: string; label: string | undefined }> {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/megamenu/by-channel${query}`,
      headers: { 'x-sales-channel': channel.code, 'accept-language': acceptLanguage },
    });
    expect(res.statusCode, res.body).toBe(200);
    const data = (res.json() as { data: { language: string; items: Array<{ label: string }> } }).data;
    return { language: data.language, label: data.items[0]?.label };
  }

  it('honours the q-weights: `en;q=0.2, pl-PL;q=0.9` is the Polish menu', async () => {
    expect(await menu('en;q=0.2, pl-PL;q=0.9')).toEqual({ language: 'pl-PL', label: 'Telefon' });
  });

  it('matches a language-only tag to the channel language: `pl` is `pl-PL`', async () => {
    expect(await menu('pl')).toEqual({ language: 'pl-PL', label: 'Telefon' });
  });

  it('skips an unoffered tag for the next offered one', async () => {
    expect(await menu('de-DE, pl;q=0.5')).toEqual({ language: 'pl-PL', label: 'Telefon' });
  });

  it('answers a language the channel does not offer with the channel default menu', async () => {
    expect(await menu('de-DE')).toEqual({ language: 'en-US', label: 'Phone' });
  });

  it('keeps an explicit `?language=` ahead of the header', async () => {
    expect(await menu('pl-PL', '?language=en-US')).toEqual({ language: 'en-US', label: 'Phone' });
  });
});
