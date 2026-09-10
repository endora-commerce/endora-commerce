import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';

describe('CMS storefront hook by code contract (T068)', () => {
  let h: BackendServerHandle;
  let defaultChannel: SalesChannel;
  let plChannel: SalesChannel;
  const adminCookie = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
    const em = h.em();
    defaultChannel = await em.findOneOrFail(SalesChannel, { systemDefault: true });
    plChannel = em.create(SalesChannel, {
      code: `cms-sf-pl-${Date.now()}`,
      name: { 'pl-PL': 'CMS storefront hooks PL' },
      languages: ['pl-PL'],
      defaultLanguage: 'pl-PL',
      currencies: ['PLN'],
      defaultCurrency: 'PLN',
      active: true,
      systemDefault: false,
      isPublic: true,
      status: 'active',
    });
    await em.persistAndFlush(plChannel);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function createBlock(input: {
    code: string;
    text: string;
    salesChannelId: string;
    language: string;
    active?: boolean;
  }) {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/cms/blocks',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        name: `Block ${input.code}`,
        code: input.code,
        active: input.active ?? true,
        salesChannelIds: [input.salesChannelId],
        languages: [input.language],
      }),
    });
    expect(created.statusCode).toBe(201);
    const block = (created.json() as { data: { id: string; version: number } }).data;
    const data = {
      root: { props: {} },
      content: [{ type: 'cms.Heading', props: { level: 'h2', text: input.text } }],
    };
    const put = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/cms/blocks/${block.id}/content/${input.language}`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ data, version: block.version }),
    });
    expect(put.statusCode).toBe(200);
    return block;
  }

  async function createHook(code: string, salesChannelIds: string[]) {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/cms/hooks',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        name: `Hook ${code}`,
        code,
        active: true,
        salesChannelIds,
      }),
    });
    expect(created.statusCode).toBe(201);
    return (created.json() as { data: { id: string } }).data;
  }

  async function attach(hookId: string, blockId: string, position: number) {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/cms/hooks/${hookId}/attachments`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ blockId, position }),
    });
    expect(res.statusCode).toBe(201);
  }

  it('resolves ordered active Blocks by hook code and sales channel', async () => {
    const code = `storefront.homepage.top.${Date.now()}`;
    const first = await createBlock({
      code: `hook-sf-first-${Date.now()}`,
      text: 'First',
      salesChannelId: defaultChannel.id,
      language: 'en-US',
    });
    const second = await createBlock({
      code: `hook-sf-second-${Date.now()}`,
      text: 'Second',
      salesChannelId: defaultChannel.id,
      language: 'en-US',
    });
    const inactive = await createBlock({
      code: `hook-sf-inactive-${Date.now()}`,
      text: 'Inactive',
      salesChannelId: defaultChannel.id,
      language: 'en-US',
      active: false,
    });
    const plOnly = await createBlock({
      code: `hook-sf-pl-${Date.now()}`,
      text: 'Polski',
      salesChannelId: plChannel.id,
      language: 'pl-PL',
    });
    const hook = await createHook(code, [defaultChannel.id, plChannel.id]);
    await attach(hook.id, second.id, 20);
    await attach(hook.id, inactive.id, 10);
    await attach(hook.id, first.id, 0);
    await attach(hook.id, plOnly.id, 5);

    const defaultRes = await h.app.inject({
      method: 'GET',
      url: `/api/v1/cms/hooks/by-code?code=${encodeURIComponent(code)}&language=en-US`,
      headers: { 'x-sales-channel': defaultChannel.code },
    });
    expect(defaultRes.statusCode).toBe(200);
    expect(defaultRes.json()).toMatchObject({
      data: {
        hookCode: code,
        blocks: [
          { id: first.id, code: expect.stringContaining('hook-sf-first'), language: 'en-US' },
          { id: second.id, code: expect.stringContaining('hook-sf-second'), language: 'en-US' },
        ],
      },
    });

    const plRes = await h.app.inject({
      method: 'GET',
      url: `/api/v1/cms/hooks/by-code?code=${encodeURIComponent(code)}&language=pl-PL`,
      headers: { 'x-sales-channel': plChannel.code },
    });
    expect(plRes.statusCode).toBe(200);
    expect(plRes.json()).toMatchObject({
      data: {
        hookCode: code,
        blocks: [{ id: plOnly.id, code: expect.stringContaining('hook-sf-pl') }],
      },
    });
  });

  it('returns an empty block list for a known Hook with no active attachments', async () => {
    const code = `storefront.empty.${Date.now()}`;
    await createHook(code, [defaultChannel.id]);

    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/cms/hooks/by-code?code=${encodeURIComponent(code)}&language=en-US`,
      headers: { 'x-sales-channel': defaultChannel.code },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ data: { hookCode: code, blocks: [] } });
  });

  it('returns CMS_HOOK_NOT_FOUND for an unknown Hook code', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/cms/hooks/by-code?code=${encodeURIComponent(`missing.${Date.now()}`)}`,
      headers: { 'x-sales-channel': defaultChannel.code },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: ERROR_CODES.CMS_HOOK_NOT_FOUND } });
  });
});
