import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';

describe('admin CMS Pages contract (T036)', () => {
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
      code: `cms-pages-pl-${Date.now()}`,
      name: { 'pl-PL': 'CMS pages PL' },
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

  async function createPage(slug: string) {
    return createPageInChannel(slug, defaultChannelId, ['en-US']);
  }

  async function createPageInChannel(slug: string, salesChannelId: string, languages: string[]) {
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
        salesChannelIds: [salesChannelId],
        languages,
        meta: {
          [languages[0] ?? 'en-US']: {
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

  it('filters Page list by salesChannelId', async () => {
    const defaultSlug = `contract-list-default-${Date.now()}`;
    const plSlug = `contract-list-pl-${Date.now()}`;
    const defaultCreated = await createPage(defaultSlug);
    const plCreated = await createPageInChannel(plSlug, plOnlyChannelId, ['pl-PL']);
    expect(defaultCreated.statusCode).toBe(201);
    expect(plCreated.statusCode).toBe(201);
    const defaultPage = (defaultCreated.json() as { data: { id: string } }).data;
    const plPage = (plCreated.json() as { data: { id: string } }).data;

    const list = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/cms/pages?salesChannelId=${encodeURIComponent(defaultChannelId)}`,
      cookies: adminCookie,
    });

    expect(list.statusCode).toBe(200);
    const ids = ((list.json() as { data: Array<{ id: string }> }).data).map((page) => page.id);
    expect(ids).toContain(defaultPage.id);
    expect(ids).not.toContain(plPage.id);
  });

  it('rejects Page languages outside the assigned channel language set', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/cms/pages',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        name: 'Invalid language page',
        slug: `invalid-language-${Date.now()}`,
        active: true,
        salesChannelIds: [plOnlyChannelId],
        languages: ['en-US'],
      }),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: { code: ERROR_CODES.CMS_LANGUAGE_NOT_IN_CHANNEL_SCOPE },
    });
  });

  it('accepts defaultLanguage when channel languages jsonb is empty (legacy rows)', async () => {
    const em = h.em();
    const code = `lg${String(Date.now()).slice(-8)}`;
    const rows = (await em.getConnection().execute(
      `insert into sales_channels
         (id, code, name, languages, default_language, currencies, default_currency, active, system_default, version, is_public, status, created_at, updated_at)
       values (gen_random_uuid(), ?, ?::jsonb, '[]'::jsonb, 'pl-PL', '["PLN"]'::jsonb, 'PLN', true, false, 1, true, 'active', now(), now())
       returning id::text as id`,
      [code, JSON.stringify({ 'en-US': 'Legacy language channel' })],
    )) as Array<{ id: string }>;
    const legacyChannelId = rows[0]!.id;

    const slug = `legacy-lang-page-${Date.now()}`;
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/cms/pages',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        name: 'Legacy language page',
        slug,
        active: true,
        salesChannelIds: [legacyChannelId],
        languages: ['pl-PL'],
      }),
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      data: { slug, languages: ['pl-PL'], salesChannelIds: [legacyChannelId] },
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
      content: [{ type: 'cms.Heading', props: { level: 'h1', text: 'Saved content' } }],
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
