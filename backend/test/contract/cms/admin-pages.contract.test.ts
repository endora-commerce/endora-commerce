import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@b2b/contracts';
import {
  setupBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '../../../src/modules/sales_channels/entities/sales-channel.entity.js';

describe('admin CMS Pages contract (T036)', () => {
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

  async function createPage(slug: string) {
    return h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/cms/pages',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        name: `Contract ${slug}`,
        slug,
        active: true,
        description: null,
        salesChannelIds: [defaultChannelId],
        languages: ['en-US'],
        meta: {
          'en-US': {
            title: `Meta ${slug}`,
            description: `Description ${slug}`,
            keywords: 'cms,contract',
          },
        },
      }),
    });
  }

  it('creates a draft Page with channel and language scope', async () => {
    const slug = `contract-page-${Date.now()}`;

    const res = await createPage(slug);

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      data: {
        name: `Contract ${slug}`,
        slug,
        status: 'draft',
        active: true,
        salesChannelIds: [defaultChannelId],
        languages: ['en-US'],
        version: 1,
      },
    });
  });

  it('rejects a duplicate slug in the same sales channel with CMS_SLUG_CONFLICT', async () => {
    const slug = `contract-dupe-${Date.now()}`;
    const first = await createPage(slug);
    expect(first.statusCode).toBe(201);

    const second = await createPage(slug);

    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ error: { code: ERROR_CODES.CMS_SLUG_CONFLICT } });
  });

  it('rejects PATCH with a stale version using VERSION_CONFLICT', async () => {
    const slug = `contract-version-${Date.now()}`;
    const created = await createPage(slug);
    expect(created.statusCode).toBe(201);
    const page = (created.json() as { data: { id: string; version: number } }).data;

    const patch = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/cms/pages/${page.id}`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        name: 'Stale write',
        version: page.version - 1,
      }),
    });

    expect(patch.statusCode).toBe(409);
    expect(patch.json()).toMatchObject({ error: { code: ERROR_CODES.VERSION_CONFLICT } });
  });

  it('saves language content and returns it on the next GET', async () => {
    const slug = `contract-content-${Date.now()}`;
    const created = await createPage(slug);
    expect(created.statusCode).toBe(201);
    const page = (created.json() as { data: { id: string; version: number } }).data;
    const data = {
      root: { props: {} },
      content: [{ type: 'Heading', props: { level: 'h1', text: 'Saved content' } }],
    };

    const put = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/cms/pages/${page.id}/content/en-US`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ data, version: page.version }),
    });
    expect(put.statusCode).toBe(200);

    const get = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/cms/pages/${page.id}`,
      cookies: adminCookie,
    });
    expect(get.statusCode).toBe(200);
    expect(get.json()).toMatchObject({
      data: {
        id: page.id,
        content: {
          schema_version: 1,
          languages: {
            'en-US': data,
          },
        },
      },
    });
  });

  it('moves through publish, archive, and unarchive lifecycle endpoints', async () => {
    const slug = `contract-lifecycle-${Date.now()}`;
    const created = await createPage(slug);
    expect(created.statusCode).toBe(201);
    const page = (created.json() as { data: { id: string } }).data;

    const publish = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/cms/pages/${page.id}/publish`,
      cookies: adminCookie,
    });
    expect(publish.statusCode).toBe(200);
    expect(publish.json()).toMatchObject({ data: { status: 'published' } });

    const archive = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/cms/pages/${page.id}/archive`,
      cookies: adminCookie,
    });
    expect(archive.statusCode).toBe(200);
    expect(archive.json()).toMatchObject({ data: { status: 'archived' } });

    const unarchive = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/cms/pages/${page.id}/unarchive`,
      cookies: adminCookie,
    });
    expect(unarchive.statusCode).toBe(200);
    expect(unarchive.json()).toMatchObject({ data: { status: 'draft' } });
  });
});
