import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { SEEDED_HOOKS } from '../../../../packages/modules/cms/src/backend/services/seed-hooks.js';

describe('admin CMS Hooks contract (T067)', () => {
  let h: BackendServerHandle;
  let defaultChannelId: string;
  let plOnlyChannelId: string;
  const adminCookie = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
    const em = h.em();
    const defaultChannel = await em.findOneOrFail(SalesChannel, { systemDefault: true });
    defaultChannelId = defaultChannel.id;
    const plOnly = em.create(SalesChannel, {
      code: `cms-hooks-pl-${Date.now()}`,
      name: { 'pl-PL': 'CMS hooks PL' },
      languages: ['pl-PL'],
      defaultLanguage: 'pl-PL',
      currencies: ['PLN'],
      defaultCurrency: 'PLN',
      active: true,
      systemDefault: false,
      isPublic: true,
      status: 'active',
    });
    await em.persistAndFlush(plOnly);
    plOnlyChannelId = plOnly.id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function createBlock(code: string) {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/cms/blocks',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        name: `Block ${code}`,
        code,
        active: true,
        salesChannelIds: [defaultChannelId],
        languages: ['en-US'],
      }),
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { data: { id: string } }).data;
  }

  it('lists seeded Hooks and protects system Hooks from deletion', async () => {
    const list = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/cms/hooks',
      cookies: adminCookie,
    });
    expect(list.statusCode).toBe(200);
    const hooks = (list.json() as { data: Array<{ id: string; code: string; isSystem: boolean }> })
      .data;
    for (const seed of SEEDED_HOOKS) {
      expect(hooks.some((hook) => hook.code === seed.code && hook.isSystem)).toBe(true);
    }

    const homepageTop = hooks.find((hook) => hook.code === 'homepage.top');
    expect(homepageTop).toBeDefined();
    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/cms/hooks/${homepageTop?.id}`,
      cookies: adminCookie,
    });

    expect(del.statusCode).toBe(409);
    expect(del.json()).toMatchObject({
      error: { code: ERROR_CODES.CMS_HOOK_SYSTEM_PROTECTED },
    });
  });

  it('creates, patches, attaches, reorders, detaches, and deletes a non-system Hook', async () => {
    const code = `quote.cta.${Date.now()}`;
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/cms/hooks',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        name: 'Quote CTA',
        code,
        active: true,
        description: 'Quote call to action',
        salesChannelIds: [defaultChannelId],
      }),
    });
    expect(created.statusCode).toBe(201);
    const hook = (
      created.json() as { data: { id: string; code: string; isSystem: boolean; version: number } }
    ).data;
    expect(hook).toMatchObject({ code, isSystem: false });

    const patched = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/cms/hooks/${hook.id}`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        name: 'Quote CTA renamed',
        description: null,
        salesChannelIds: [defaultChannelId, plOnlyChannelId],
        version: hook.version,
      }),
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({
      data: {
        name: 'Quote CTA renamed',
        description: null,
        salesChannelIds: expect.arrayContaining([defaultChannelId, plOnlyChannelId]),
      },
    });

    const firstBlock = await createBlock(`hook-first-${Date.now()}`);
    const secondBlock = await createBlock(`hook-second-${Date.now()}`);

    const attachSecond = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/cms/hooks/${hook.id}/attachments`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ blockId: secondBlock.id, position: 10 }),
    });
    expect(attachSecond.statusCode).toBe(201);

    const attachFirst = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/cms/hooks/${hook.id}/attachments`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ blockId: firstBlock.id, position: 0 }),
    });
    expect(attachFirst.statusCode).toBe(201);

    const ordered = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/cms/hooks/${hook.id}/attachments`,
      cookies: adminCookie,
    });
    expect(ordered.statusCode).toBe(200);
    expect((ordered.json() as { data: Array<{ blockId: string }> }).data.map((x) => x.blockId)).toEqual([
      firstBlock.id,
      secondBlock.id,
    ]);

    const reorder = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/cms/hooks/${hook.id}/attachments/${firstBlock.id}`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ position: 20 }),
    });
    expect(reorder.statusCode).toBe(200);

    const reordered = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/cms/hooks/${hook.id}/attachments`,
      cookies: adminCookie,
    });
    expect(reordered.statusCode).toBe(200);
    expect(
      (reordered.json() as { data: Array<{ blockId: string }> }).data.map((x) => x.blockId),
    ).toEqual([secondBlock.id, firstBlock.id]);

    const detach = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/cms/hooks/${hook.id}/attachments/${secondBlock.id}`,
      cookies: adminCookie,
    });
    expect(detach.statusCode).toBe(204);

    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/cms/hooks/${hook.id}`,
      cookies: adminCookie,
    });
    expect(del.statusCode).toBe(204);
  });
});
