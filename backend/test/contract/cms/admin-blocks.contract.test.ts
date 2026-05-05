import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@b2b/contracts';
import {
  setupBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '../../../src/modules/sales_channels/entities/sales-channel.entity.js';

describe('admin CMS Blocks contract (T051)', () => {
  let h: BackendServerHandle;
  let defaultChannelId: string;
  const adminCookie = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
    const channel = await h.em().findOneOrFail(SalesChannel, { systemDefault: true });
    defaultChannelId = channel.id;
  });

  afterAll(async () => {
    await h.app.close();
    h.redis.disconnect();
    await h.orm.close(true);
  });

  async function createBlock(code: string, active = true) {
    return h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/cms/blocks',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        name: `Block ${code}`,
        code,
        active,
        description: null,
        salesChannelIds: [defaultChannelId],
        languages: ['en-US'],
      }),
    });
  }

  it('creates, fetches, patches, saves content, and deletes a Block', async () => {
    const code = `block-crud-${Date.now()}`;

    const created = await createBlock(code);
    expect(created.statusCode).toBe(201);
    const block = (created.json() as { data: { id: string; version: number } }).data;

    const get = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/cms/blocks/${block.id}`,
      cookies: adminCookie,
    });
    expect(get.statusCode).toBe(200);
    expect(get.json()).toMatchObject({ data: { id: block.id, code, active: true } });

    const patched = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/cms/blocks/${block.id}`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        name: `Renamed ${code}`,
        version: block.version,
      }),
    });
    expect(patched.statusCode).toBe(200);

    const updated = (patched.json() as { data: { version: number } }).data;
    const data = {
      root: { props: {} },
      content: [{ type: 'Heading', props: { level: 'h2', text: 'Reusable block' } }],
    };
    const put = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/cms/blocks/${block.id}/content/en-US`,
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
      url: `/api/v1/admin/cms/blocks/${block.id}`,
      cookies: adminCookie,
    });
    expect(del.statusCode).toBe(204);
  });

  it('rejects duplicate code in the same sales channel with CMS_CODE_CONFLICT', async () => {
    const code = `block-dupe-${Date.now()}`;
    const first = await createBlock(code);
    expect(first.statusCode).toBe(201);

    const second = await createBlock(code);

    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ error: { code: ERROR_CODES.CMS_CODE_CONFLICT } });
  });

  it('omits inactive Blocks from storefront resolution', async () => {
    const code = `inactive-block-${Date.now()}`;
    const created = await createBlock(code, false);
    expect(created.statusCode).toBe(201);

    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/cms/blocks/by-code?code=${encodeURIComponent(code)}&language=en-US`,
      headers: { 'x-sales-channel': 'default', 'accept-language': 'en-US' },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: ERROR_CODES.CMS_BLOCK_NOT_FOUND } });
  });

  it('blocks deleting a Block referenced by a Page InsertBlock node', async () => {
    const code = `referenced-block-${Date.now()}`;
    const created = await createBlock(code);
    expect(created.statusCode).toBe(201);
    const block = (created.json() as { data: { id: string } }).data;
    const pageId = randomUUID();
    const now = new Date();
    const content = {
      schema_version: 1,
      languages: {
        'en-US': {
          root: { props: {} },
          content: [{ type: 'InsertBlock', props: { code } }],
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
        JSON.stringify({ 'en-US': 'Page with block' }),
        JSON.stringify({ 'en-US': '' }),
        now,
        now,
        now,
        'Page with block',
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
      url: `/api/v1/admin/cms/blocks/${block.id}`,
      cookies: adminCookie,
    });

    expect(del.statusCode).toBe(409);
    expect(del.json()).toMatchObject({ error: { code: ERROR_CODES.CMS_REFERENCED } });
  });
});
