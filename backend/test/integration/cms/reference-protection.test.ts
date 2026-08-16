import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';

/**
 * T078 — Reference protection across the CMS entity graph.
 *
 * Verifies that deletion is blocked across every reference edge in the
 * CmsReferenceRegistry, and that removing the reference unblocks deletion.
 *
 *   page  → block      (Page contains InsertBlock { code })       → block delete blocked
 *   page  → template   (Page contains InsertTemplate { code })    → template delete blocked
 *   block → template   (Block contains InsertTemplate { code })   → template delete blocked
 *   template → block   (Template contains InsertBlock { code })   → block delete blocked
 *   hook  → block      (Hook attachment)                          → block delete blocked
 */
describe('CMS reference protection (T078)', () => {
  let h: BackendServerHandle;
  let defaultChannelId: string;
  const adminCookie = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
    const em = h.em();
    const channel = await em.findOneOrFail(SalesChannel, { systemDefault: true });
    defaultChannelId = channel.id;
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
        description: null,
        salesChannelIds: [defaultChannelId],
        languages: ['en-US'],
      }),
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { data: { id: string; version: number } }).data;
  }

  async function createTemplate(code: string) {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/cms/templates',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        name: `Template ${code}`,
        code,
        description: null,
        salesChannelIds: [defaultChannelId],
        languages: ['en-US'],
      }),
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { data: { id: string; version: number } }).data;
  }

  async function createPage(slug: string) {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/cms/pages',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        name: `Page ${slug}`,
        slug,
        active: true,
        description: null,
        salesChannelIds: [defaultChannelId],
        languages: ['en-US'],
      }),
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { data: { id: string; version: number } }).data;
  }

  async function setBlockContent(id: string, version: number, embedType: 'InsertBlock' | 'InsertTemplate', refCode: string | null) {
    const data = refCode
      ? { root: { props: {} }, content: [{ type: embedType, props: { code: refCode } }] }
      : { root: { props: {} }, content: [{ type: 'Heading', props: { level: 'h2', text: 'no-embed' } }] };
    const res = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/cms/blocks/${id}/content/en-US`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ data, version }),
    });
    expect(res.statusCode).toBe(200);
    return (res.json() as { data: { version: number } }).data.version;
  }

  async function setTemplateContent(id: string, version: number, embedType: 'InsertBlock' | 'InsertTemplate', refCode: string | null) {
    const data = refCode
      ? { root: { props: {} }, content: [{ type: embedType, props: { code: refCode } }] }
      : { root: { props: {} }, content: [{ type: 'Heading', props: { level: 'h2', text: 'no-embed' } }] };
    const res = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/cms/templates/${id}/content/en-US`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ data, version }),
    });
    expect(res.statusCode).toBe(200);
    return (res.json() as { data: { version: number } }).data.version;
  }

  async function setPageContent(id: string, version: number, embedType: 'InsertBlock' | 'InsertTemplate', refCode: string) {
    const data = {
      root: { props: {} },
      content: [{ type: embedType, props: { code: refCode } }],
    };
    const res = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/cms/pages/${id}/content/en-US`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ data, version }),
    });
    expect(res.statusCode).toBe(200);
    return (res.json() as { data: { version: number } }).data.version;
  }

  it('page → block: deleting a Block referenced by a Page returns 409 CMS_REFERENCED', async () => {
    const stamp = Date.now();
    const block = await createBlock(`pb-block-${stamp}`);
    const page = await createPage(`pb-page-${stamp}`);
    await setPageContent(page.id, page.version, 'InsertBlock', `pb-block-${stamp}`);

    const blocked = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/cms/blocks/${block.id}`,
      cookies: adminCookie,
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ error: { code: ERROR_CODES.CMS_REFERENCED } });
  });

  it('page → template: deleting a Template referenced by a Page returns 409 CMS_REFERENCED', async () => {
    const stamp = Date.now();
    const template = await createTemplate(`pt-tpl-${stamp}`);
    const page = await createPage(`pt-page-${stamp}`);
    await setPageContent(page.id, page.version, 'InsertTemplate', `pt-tpl-${stamp}`);

    const blocked = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/cms/templates/${template.id}`,
      cookies: adminCookie,
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ error: { code: ERROR_CODES.CMS_REFERENCED } });
  });

  it('block → template: deleting a Template referenced by a Block returns 409 CMS_REFERENCED', async () => {
    const stamp = Date.now();
    const template = await createTemplate(`bt-tpl-${stamp}`);
    const host = await createBlock(`bt-block-${stamp}`);
    await setBlockContent(host.id, host.version, 'InsertTemplate', `bt-tpl-${stamp}`);

    const blocked = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/cms/templates/${template.id}`,
      cookies: adminCookie,
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ error: { code: ERROR_CODES.CMS_REFERENCED } });
  });

  it('template → block: deleting a Block referenced by a Template returns 409 CMS_REFERENCED', async () => {
    const stamp = Date.now();
    const block = await createBlock(`tb-block-${stamp}`);
    const host = await createTemplate(`tb-tpl-${stamp}`);
    await setTemplateContent(host.id, host.version, 'InsertBlock', `tb-block-${stamp}`);

    const blocked = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/cms/blocks/${block.id}`,
      cookies: adminCookie,
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ error: { code: ERROR_CODES.CMS_REFERENCED } });
  });

  it('hook → block: deleting a Block referenced by a Hook attachment returns 409 CMS_REFERENCED', async () => {
    const stamp = Date.now();
    const block = await createBlock(`hb-block-${stamp}`);

    const hookCreated = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/cms/hooks',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        name: `Hook ${stamp}`,
        code: `hb-hook-${stamp}`,
        active: true,
        description: null,
        salesChannelIds: [defaultChannelId],
      }),
    });
    expect(hookCreated.statusCode).toBe(201);
    const hook = (hookCreated.json() as { data: { id: string } }).data;

    const attached = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/cms/hooks/${hook.id}/attachments`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ blockId: block.id, position: 0 }),
    });
    expect(attached.statusCode).toBe(201);

    const blocked = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/cms/blocks/${block.id}`,
      cookies: adminCookie,
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ error: { code: ERROR_CODES.CMS_REFERENCED } });
  });

  it('removing the reference unblocks deletion', async () => {
    const stamp = Date.now();
    const template = await createTemplate(`unblock-tpl-${stamp}`);
    const host = await createBlock(`unblock-block-${stamp}`);
    const v1 = await setBlockContent(host.id, host.version, 'InsertTemplate', `unblock-tpl-${stamp}`);

    const blocked = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/cms/templates/${template.id}`,
      cookies: adminCookie,
    });
    expect(blocked.statusCode).toBe(409);

    await setBlockContent(host.id, v1, 'InsertBlock', null);

    const ok = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/cms/templates/${template.id}`,
      cookies: adminCookie,
    });
    expect(ok.statusCode).toBe(204);
  });
});
