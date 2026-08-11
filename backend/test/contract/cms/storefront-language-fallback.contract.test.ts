import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';

describe('CMS storefront language fallback (T062)', () => {
  let h: BackendServerHandle;
  let channel: SalesChannel;
  const adminCookie = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
    const em = h.em();
    channel = em.create(SalesChannel, {
      code: `fallback-pl-${Date.now()}`,
      name: { 'pl-PL': 'Fallback PL' },
      languages: ['pl-PL', 'en-US'],
      defaultLanguage: 'pl-PL',
      currencies: ['PLN'],
      defaultCurrency: 'PLN',
      active: true,
      systemDefault: false,
      isPublic: true,
      status: 'active',
    });
    await em.persistAndFlush(channel);
  });

  afterAll(async () => {
    await h.app.close();
    h.redis.disconnect();
    await h.orm.close(true);
  });

  it('falls back to the channel default language when requested language is unsupported', async () => {
    const slug = `fallback-${Date.now()}`;
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/cms/pages',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        name: 'Fallback page',
        slug,
        active: true,
        salesChannelIds: [channel.id],
        languages: ['pl-PL', 'en-US'],
      }),
    });
    expect(created.statusCode).toBe(201);
    const page = (created.json() as { data: { id: string; version: number } }).data;
    const put = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/cms/pages/${page.id}/content/pl-PL`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        data: {
          root: { props: {} },
          content: [{ type: 'Heading', props: { level: 'h1', text: 'Polski fallback' } }],
        },
        version: page.version,
      }),
    });
    expect(put.statusCode).toBe(200);
    const publish = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/cms/pages/${page.id}/publish`,
      cookies: adminCookie,
    });
    expect(publish.statusCode).toBe(200);

    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/cms/pages/by-slug?slug=${encodeURIComponent(slug)}&language=fr-FR`,
      headers: { 'x-sales-channel': channel.code },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      data: {
        slug,
        language: 'pl-PL',
      },
    });
  });
});
