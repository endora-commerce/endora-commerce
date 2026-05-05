import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@b2b/contracts';
import {
  setupBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '../../../src/modules/sales_channels/entities/sales-channel.entity.js';

describe('admin CMS Templates contract (T077)', () => {
  let h: BackendServerHandle;
  let defaultChannelId: string;
  let plOnlyChannelId: string;
  const adminCookie = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
    const em = h.em();
    const channel = await em.findOneOrFail(SalesChannel, { systemDefault: true });
    defaultChannelId = channel.id;
    const plOnly = em.create(SalesChannel, {
      code: `cms-templates-pl-${Date.now()}`,
      name: { 'pl-PL': 'CMS templates PL' },
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
    await h.app.close();
    h.redis.disconnect();
    await h.orm.close(true);
  });

  async function createTemplate(
    code: string,
    salesChannelId = defaultChannelId,
    languages = ['en-US'],
  ) {
    return h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/cms/templates',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        name: `Template ${code}`,
        code,
        description: null,
        salesChannelIds: [salesChannelId],
        languages,
      }),
    });
  }

  it('creates, fetches, patches, saves content, and deletes a Template', async () => {
    const code = `template-crud-${Date.now()}`;

    const created = await createTemplate(code);
    expect(created.statusCode).toBe(201);
    const template = (created.json() as { data: { id: string; version: number } }).data;

    const get = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/cms/templates/${template.id}`,
      cookies: adminCookie,
    });
    expect(get.statusCode).toBe(200);
    expect(get.json()).toMatchObject({ data: { id: template.id, code } });

    const patched = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/cms/templates/${template.id}`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        name: `Renamed ${code}`,
        version: template.version,
      }),
    });
    expect(patched.statusCode).toBe(200);

    const updated = (patched.json() as { data: { version: number } }).data;
    const data = {
      root: { props: {} },
      content: [{ type: 'Heading', props: { level: 'h2', text: 'Reusable template' } }],
    };
    const put = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/cms/templates/${template.id}/content/en-US`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ data, version: updated.version }),
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({
      data: {
        content: {
          schema_version: 1,
          languages: { 'en-US': data },
        },
      },
    });

    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/cms/templates/${template.id}`,
      cookies: adminCookie,
    });
    expect(del.statusCode).toBe(204);
  });

  it('rejects duplicate code in the same sales channel with CMS_CODE_CONFLICT', async () => {
    const code = `template-dupe-${Date.now()}`;
    const first = await createTemplate(code);
    expect(first.statusCode).toBe(201);

    const second = await createTemplate(code);

    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ error: { code: ERROR_CODES.CMS_CODE_CONFLICT } });
  });

  it('allows the same code across two distinct sales channels', async () => {
    const code = `template-cross-${Date.now()}`;
    const first = await createTemplate(code, defaultChannelId, ['en-US']);
    const second = await createTemplate(code, plOnlyChannelId, ['pl-PL']);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
  });

  it('filters Template list by salesChannelId', async () => {
    const defaultCreated = await createTemplate(`template-list-default-${Date.now()}`);
    const plCreated = await createTemplate(
      `template-list-pl-${Date.now()}`,
      plOnlyChannelId,
      ['pl-PL'],
    );
    expect(defaultCreated.statusCode).toBe(201);
    expect(plCreated.statusCode).toBe(201);
    const defaultTemplate = (defaultCreated.json() as { data: { id: string } }).data;
    const plTemplate = (plCreated.json() as { data: { id: string } }).data;

    const list = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/cms/templates?salesChannelId=${encodeURIComponent(defaultChannelId)}`,
      cookies: adminCookie,
    });

    expect(list.statusCode).toBe(200);
    const ids = ((list.json() as { data: Array<{ id: string }> }).data).map((tpl) => tpl.id);
    expect(ids).toContain(defaultTemplate.id);
    expect(ids).not.toContain(plTemplate.id);
  });

  it('blocks deleting a Template referenced by a Page InsertTemplate node', async () => {
    const code = `referenced-template-${Date.now()}`;
    const created = await createTemplate(code);
    expect(created.statusCode).toBe(201);
    const template = (created.json() as { data: { id: string } }).data;
    const pageId = randomUUID();
    const now = new Date();
    const content = {
      schema_version: 1,
      languages: {
        'en-US': {
          root: { props: {} },
          content: [{ type: 'InsertTemplate', props: { code } }],
        },
      },
    };

    await h.em().getConnection().execute(
      `insert into cms_pages
        (id, path, status, title, body, published_at, archived_at, created_at, updated_at,
         name, slug, active, description, meta_title, meta_description, meta_keywords,
         content, languages, version)
       values (?, ?, 'published', ?::jsonb, ?::jsonb, ?, null, ?, ?,
         ?, ?, true, null, null, null, null, ?::jsonb, ?::jsonb, 1)`,
      [
        pageId,
        `${code}-${pageId.slice(0, 8)}`,
        JSON.stringify({ 'en-US': 'Page with template' }),
        JSON.stringify({ 'en-US': '' }),
        now,
        now,
        now,
        'Page with template',
        `page-${code}`,
        JSON.stringify(content),
        JSON.stringify(['en-US']),
      ],
    );
    await h.em().getConnection().execute(
      `insert into cms_page_sales_channels (page_id, sales_channel_id, slug)
       values (?, ?, ?)`,
      [pageId, defaultChannelId, `page-${code}`],
    );

    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/cms/templates/${template.id}`,
      cookies: adminCookie,
    });

    expect(del.statusCode).toBe(409);
    expect(del.json()).toMatchObject({ error: { code: ERROR_CODES.CMS_REFERENCED } });
  });

  it('blocks deleting a Template referenced by a Block InsertTemplate node', async () => {
    const code = `referenced-template-from-block-${Date.now()}`;
    const created = await createTemplate(code);
    expect(created.statusCode).toBe(201);
    const template = (created.json() as { data: { id: string } }).data;

    const blockCode = `host-block-${Date.now()}`;
    const blockCreated = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/cms/blocks',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        name: `Host block`,
        code: blockCode,
        active: true,
        description: null,
        salesChannelIds: [defaultChannelId],
        languages: ['en-US'],
      }),
    });
    expect(blockCreated.statusCode).toBe(201);
    const block = (blockCreated.json() as { data: { id: string; version: number } }).data;

    const data = {
      root: { props: {} },
      content: [{ type: 'InsertTemplate', props: { code } }],
    };
    const put = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/cms/blocks/${block.id}/content/en-US`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ data, version: block.version }),
    });
    expect(put.statusCode).toBe(200);

    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/cms/templates/${template.id}`,
      cookies: adminCookie,
    });

    expect(del.statusCode).toBe(409);
    expect(del.json()).toMatchObject({ error: { code: ERROR_CODES.CMS_REFERENCED } });
  });
});
