import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AuditLogEntry, SalesChannel } from '@endora-commerce/platform/kernel';

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
    await teardownBackendServer(h);
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
      content: [{ type: 'cms.Heading', props: { level: 'h2', text: 'Reusable template' } }],
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
      languages: {
        'en-US': {
          root: { props: {} },
          content: [{ type: 'cms.InsertTemplate', props: { code } }],
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
      content: [{ type: 'cms.InsertTemplate', props: { code } }],
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

  /**
   * Constitution XIII — every admin write to a Template runs as a Command, so each
   * one leaves exactly one audit entry naming the acting admin, written in the
   * write's own transaction. The response shapes above are unchanged by it;
   * what these cases hold is the record of who changed what.
   */
  describe('audit trail (Constitution XIII)', () => {
    async function auditRows(action: string, templateId: string): Promise<AuditLogEntry[]> {
      return h.em().find(AuditLogEntry, { action, objectType: 'cms_template', objectId: templateId });
    }

    async function createdTemplate(prefix: string): Promise<{ id: string; version: number; code: string }> {
      const code = `${prefix}-${Date.now()}`;
      const created = await createTemplate(code);
      expect(created.statusCode).toBe(201);
      const template = (created.json() as { data: { id: string; version: number } }).data;
      return { ...template, code };
    }

    it('records one entry for a create, attributed to the acting admin', async () => {
      const template = await createdTemplate('audit-create');

      const rows = await auditRows('cms_template.create', template.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.actorAdminUserId).toEqual(expect.any(String));
      expect(rows[0]!.stateBefore ?? null).toBeNull();
      expect(rows[0]!.stateAfter).toMatchObject({
        name: `Template ${template.code}`,
        code: template.code,
        salesChannelIds: [defaultChannelId],
        languages: ['en-US'],
        version: 1,
      });
    });

    it('records one entry for a metadata update, with the state on both sides', async () => {
      const template = await createdTemplate('audit-update');

      const patch = await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/cms/templates/${template.id}`,
        headers: { 'content-type': 'application/json' },
        cookies: adminCookie,
        payload: JSON.stringify({ name: 'Renamed for the audit', version: template.version }),
      });
      expect(patch.statusCode).toBe(200);
      expect(patch.json()).toMatchObject({ data: { name: 'Renamed for the audit', version: 2 } });

      const rows = await auditRows('cms_template.update', template.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.actorAdminUserId).toEqual(expect.any(String));
      expect(rows[0]!.stateBefore).toMatchObject({ name: `Template ${template.code}`, version: 1 });
      expect(rows[0]!.stateAfter).toMatchObject({ name: 'Renamed for the audit', version: 2 });
    });

    it('records one entry for a content save, naming the language', async () => {
      const template = await createdTemplate('audit-content');

      const put = await h.app.inject({
        method: 'PUT',
        url: `/api/v1/admin/cms/templates/${template.id}/content/en-US`,
        headers: { 'content-type': 'application/json' },
        cookies: adminCookie,
        payload: JSON.stringify({
          data: { root: { props: {} }, content: [] },
          version: template.version,
        }),
      });
      expect(put.statusCode).toBe(200);

      const rows = await auditRows('cms_template.set_content', template.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.stateBefore).toMatchObject({ version: 1 });
      expect(rows[0]!.stateAfter).toMatchObject({ language: 'en-US', version: 2 });
    });

    it('records one entry for a delete, keeping what the template was', async () => {
      const template = await createdTemplate('audit-delete');

      const del = await h.app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/cms/templates/${template.id}`,
        cookies: adminCookie,
      });
      expect(del.statusCode).toBe(204);

      const rows = await auditRows('cms_template.delete', template.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.actorAdminUserId).toEqual(expect.any(String));
      expect(rows[0]!.stateBefore).toMatchObject({ code: template.code, version: 1 });
      expect(rows[0]!.stateAfter ?? null).toBeNull();

      const get = await h.app.inject({
        method: 'GET',
        url: `/api/v1/admin/cms/templates/${template.id}`,
        cookies: adminCookie,
      });
      expect(get.statusCode).toBe(404);
    });

    it('records nothing for a write that was refused', async () => {
      const template = await createdTemplate('audit-refused');

      const patch = await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/cms/templates/${template.id}`,
        headers: { 'content-type': 'application/json' },
        cookies: adminCookie,
        payload: JSON.stringify({ name: 'Stale write', version: template.version + 5 }),
      });
      expect(patch.statusCode).toBe(409);

      expect(await auditRows('cms_template.update', template.id)).toHaveLength(0);
    });

    it('records nothing for a delete of a template that is not there, and still answers 404', async () => {
      const missingId = '00000000-0000-4000-8000-0000000073e0';

      const del = await h.app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/cms/templates/${missingId}`,
        cookies: adminCookie,
      });
      expect(del.statusCode).toBe(404);
      expect(del.json()).toMatchObject({ error: { code: ERROR_CODES.CMS_TEMPLATE_NOT_FOUND } });

      expect(await auditRows('cms_template.delete', missingId)).toHaveLength(0);
    });
  });
});
