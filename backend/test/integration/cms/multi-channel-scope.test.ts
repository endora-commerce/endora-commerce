import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@b2b/contracts';
import {
  setupBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';

describe('CMS multi-channel scope (T061)', () => {
  let h: BackendServerHandle;
  let retail: SalesChannel;
  let vip: SalesChannel;

  const adminCookie = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
    const em = h.em();
    retail = em.create(SalesChannel, {
      code: `pl-retail-${Date.now()}`,
      name: { 'pl-PL': 'PL retail' },
      languages: ['pl-PL', 'en-US'],
      defaultLanguage: 'pl-PL',
      currencies: ['PLN'],
      defaultCurrency: 'PLN',
      active: true,
      systemDefault: false,
      isPublic: true,
      status: 'active',
    });
    vip = em.create(SalesChannel, {
      code: `pl-b2b-vip-${Date.now()}`,
      name: { 'pl-PL': 'PL B2B VIP' },
      languages: ['pl-PL', 'en-US'],
      defaultLanguage: 'pl-PL',
      currencies: ['PLN'],
      defaultCurrency: 'PLN',
      active: true,
      systemDefault: false,
      isPublic: true,
      status: 'active',
    });
    await em.persistAndFlush([retail, vip]);
  });

  afterAll(async () => {
    await h.app.close();
    h.redis.disconnect();
    await h.orm.close(true);
  });

  async function createPage(name: string, salesChannelId: string) {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/cms/pages',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        name,
        slug: 'about',
        active: true,
        description: null,
        salesChannelIds: [salesChannelId],
        languages: ['pl-PL'],
      }),
    });
    expect(res.statusCode).toBe(201);
    const page = (res.json() as { data: { id: string; version: number } }).data;
    const put = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/cms/pages/${page.id}/content/pl-PL`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        data: {
          root: { props: {} },
          content: [{ type: 'Heading', props: { level: 'h1', text: name } }],
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
    return page.id;
  }

  async function createBlock(code: string, salesChannelId: string) {
    return h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/cms/blocks',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        name: `Block ${salesChannelId}`,
        code,
        active: true,
        salesChannelIds: [salesChannelId],
        languages: ['pl-PL'],
      }),
    });
  }

  it('resolves the same slug to different Pages per sales channel', async () => {
    const retailPageId = await createPage('Retail About', retail.id);
    const vipPageId = await createPage('VIP About', vip.id);

    const retailRes = await h.app.inject({
      method: 'GET',
      url: '/api/v1/cms/pages/by-slug?slug=about&language=pl-PL',
      headers: { 'x-sales-channel': retail.code },
    });
    expect(retailRes.statusCode).toBe(200);
    expect(retailRes.json()).toMatchObject({ data: { id: retailPageId, name: 'Retail About' } });

    const vipRes = await h.app.inject({
      method: 'GET',
      url: '/api/v1/cms/pages/by-slug?slug=about&language=pl-PL',
      headers: { 'x-sales-channel': vip.code },
    });
    expect(vipRes.statusCode).toBe(200);
    expect(vipRes.json()).toMatchObject({ data: { id: vipPageId, name: 'VIP About' } });
  });

  it('rejects duplicate page slug within one channel', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/cms/pages',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        name: 'Retail About duplicate',
        slug: 'about',
        active: true,
        salesChannelIds: [retail.id],
        languages: ['pl-PL'],
      }),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: ERROR_CODES.CMS_SLUG_CONFLICT } });
  });

  it('allows duplicate block code across different channels', async () => {
    const a = await createBlock('shared-hero', retail.id);
    expect(a.statusCode).toBe(201);
    const b = await createBlock('shared-hero', vip.id);
    expect(b.statusCode).toBe(201);
  });
});
