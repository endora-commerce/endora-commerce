import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AuditLogEntry, SalesChannel } from '@endora-commerce/platform/kernel';

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
  /**
   * Constitution XIII — every admin write to a Page runs as a Command, so each
   * one leaves exactly one audit entry naming the acting admin, written in the
   * write's own transaction. The response shapes above are unchanged by it;
   * what these cases hold is the record of who changed what.
   */
  describe('audit trail (Constitution XIII)', () => {
    async function auditRows(action: string, pageId: string): Promise<AuditLogEntry[]> {
      return h.em().find(AuditLogEntry, { action, objectType: 'cms_page', objectId: pageId });
    }

    async function createdPage(prefix: string): Promise<{ id: string; version: number; slug: string }> {
      const slug = `${prefix}-${Date.now()}`;
      const created = await createPage(slug);
      expect(created.statusCode).toBe(201);
      const page = (created.json() as { data: { id: string; version: number } }).data;
      return { ...page, slug };
    }

    function post(pageId: string, verb: 'publish' | 'archive' | 'unarchive') {
      return h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/cms/pages/${pageId}/${verb}`,
        cookies: adminCookie,
      });
    }

    it('records one entry for a create, attributed to the acting admin', async () => {
      const page = await createdPage('audit-create');

      const rows = await auditRows('cms_page.create', page.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.actorAdminUserId).toEqual(expect.any(String));
      expect(rows[0]!.stateBefore ?? null).toBeNull();
      expect(rows[0]!.stateAfter).toMatchObject({
        slug: page.slug,
        status: 'draft',
        salesChannelIds: [defaultChannelId],
        languages: ['en-US'],
        version: 1,
      });
    });

    it('records one entry for a metadata update, with the state on both sides', async () => {
      const page = await createdPage('audit-update');

      const patch = await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/cms/pages/${page.id}`,
        headers: { 'content-type': 'application/json' },
        cookies: adminCookie,
        payload: JSON.stringify({ name: 'Renamed for the audit', version: page.version }),
      });
      expect(patch.statusCode).toBe(200);
      expect(patch.json()).toMatchObject({ data: { name: 'Renamed for the audit', version: 2 } });

      const rows = await auditRows('cms_page.update', page.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.stateBefore).toMatchObject({ name: `Contract ${page.slug}`, version: 1 });
      expect(rows[0]!.stateAfter).toMatchObject({ name: 'Renamed for the audit', version: 2 });
    });

    it('records one entry for a content save, naming the language', async () => {
      const page = await createdPage('audit-content');

      const put = await h.app.inject({
        method: 'PUT',
        url: `/api/v1/admin/cms/pages/${page.id}/content/en-US`,
        headers: { 'content-type': 'application/json' },
        cookies: adminCookie,
        payload: JSON.stringify({
          data: { root: { props: {} }, content: [] },
          version: page.version,
        }),
      });
      expect(put.statusCode).toBe(200);

      const rows = await auditRows('cms_page.set_content', page.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.stateBefore).toMatchObject({ version: 1 });
      expect(rows[0]!.stateAfter).toMatchObject({ language: 'en-US', version: 2 });
    });

    it('records one entry for each lifecycle transition', async () => {
      const page = await createdPage('audit-lifecycle');

      expect((await post(page.id, 'publish')).statusCode).toBe(200);
      expect((await post(page.id, 'archive')).statusCode).toBe(200);
      expect((await post(page.id, 'unarchive')).statusCode).toBe(200);

      const published = await auditRows('cms_page.publish', page.id);
      expect(published).toHaveLength(1);
      expect(published[0]!.stateBefore).toMatchObject({ status: 'draft' });
      expect(published[0]!.stateAfter).toMatchObject({ status: 'published' });

      const archived = await auditRows('cms_page.archive', page.id);
      expect(archived).toHaveLength(1);
      expect(archived[0]!.stateBefore).toMatchObject({ status: 'published' });
      expect(archived[0]!.stateAfter).toMatchObject({ status: 'archived' });

      const unarchived = await auditRows('cms_page.unarchive', page.id);
      expect(unarchived).toHaveLength(1);
      expect(unarchived[0]!.stateBefore).toMatchObject({ status: 'archived' });
      expect(unarchived[0]!.stateAfter).toMatchObject({ status: 'draft' });
    });

    it('records one entry for a delete, keeping what the page was', async () => {
      const page = await createdPage('audit-delete');

      const del = await h.app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/cms/pages/${page.id}`,
        cookies: adminCookie,
      });
      expect(del.statusCode).toBe(204);

      const rows = await auditRows('cms_page.delete', page.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.actorAdminUserId).toEqual(expect.any(String));
      expect(rows[0]!.stateBefore).toMatchObject({ slug: page.slug, status: 'draft' });
      expect(rows[0]!.stateAfter ?? null).toBeNull();

      const get = await h.app.inject({
        method: 'GET',
        url: `/api/v1/admin/cms/pages/${page.id}`,
        cookies: adminCookie,
      });
      expect(get.statusCode).toBe(404);
    });

    it('records nothing for a write that was refused', async () => {
      const page = await createdPage('audit-refused');

      const patch = await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/cms/pages/${page.id}`,
        headers: { 'content-type': 'application/json' },
        cookies: adminCookie,
        payload: JSON.stringify({ name: 'Stale write', version: page.version + 5 }),
      });
      expect(patch.statusCode).toBe(409);

      expect(await auditRows('cms_page.update', page.id)).toHaveLength(0);
    });

    it('records nothing for a delete that removed no row, and still answers 204', async () => {
      const missingId = '00000000-0000-4000-8000-00000000c0de';

      const del = await h.app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/cms/pages/${missingId}`,
        cookies: adminCookie,
      });
      expect(del.statusCode).toBe(204);

      expect(await auditRows('cms_page.delete', missingId)).toHaveLength(0);
    });
  });
});
