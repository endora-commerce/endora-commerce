import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CMS_SETTING_CODES } from '@endora-commerce/mod-cms';
import { AuditLogEntry, SalesChannel } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Issue #1495 (UX audit CONTENT-13, DEC-17) — Duplicate of a CMS page, block
 * and template against Postgres: what the copy holds and what it does not, the
 * `-copy`, `-copy-2`, … suffix across every slug of a page, the rollback of a
 * refusal (no row, no audit entry), two duplicates at once, and a draft copy
 * the storefront does not serve.
 */

const RUN = `dup1495i-${randomUUID().slice(0, 8)}`;
const ADMIN = { b2b_session: 'stub-admin-session' };

type Row = Record<string, unknown>;

describe('CMS duplicate (issue #1495)', () => {
  let h: BackendServerHandle;
  let first: SalesChannel;
  let second: SalesChannel;

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
    const em = h.em();
    const make = (suffix: string): SalesChannel =>
      em.create(SalesChannel, {
        code: `${RUN}-${suffix}`,
        name: { 'en-US': `Duplicate ${suffix}` },
        languages: ['en-US', 'pl-PL'],
        defaultLanguage: 'en-US',
        currencies: ['PLN'],
        defaultCurrency: 'PLN',
        active: true,
        systemDefault: false,
        status: 'active',
      });
    first = make('a');
    second = make('b');
    await em.persist([first, second]).flush();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function post(url: string, payload: unknown): Promise<Row> {
    const res = await h.app.inject({ method: 'POST', url, cookies: ADMIN, payload: payload as Record<string, unknown> });
    expect(res.statusCode, `${url}: ${res.body}`).toBeLessThan(300);
    return (res.json() as { data: Row }).data;
  }

  async function put(url: string, payload: unknown): Promise<Row> {
    const res = await h.app.inject({ method: 'PUT', url, cookies: ADMIN, payload: payload as Record<string, unknown> });
    expect(res.statusCode, `${url}: ${res.body}`).toBe(200);
    return (res.json() as { data: Row }).data;
  }

  const duplicate = (kind: string, id: string, payload: Record<string, unknown> = {}) =>
    h.app.inject({ method: 'POST', url: `/api/v1/admin/cms/${kind}/${id}/duplicate`, cookies: ADMIN, payload });

  async function row(table: string, id: string): Promise<Row> {
    const rows = (await h.em().execute(`select * from ${table} where id = ?`, [id])) as Row[];
    expect(rows, `${table} ${id}`).toHaveLength(1);
    return rows[0]!;
  }

  async function duplicateEntries(action: string, sourceKey: string, sourceId: string): Promise<AuditLogEntry[]> {
    const entries = await h.em().fork().find(AuditLogEntry, { action });
    return entries.filter((entry) => (entry.stateAfter as Row | null)?.[sourceKey] === sourceId);
  }

  const tree = (text: string) => ({
    root: { props: {} },
    content: [{ type: 'cms.Heading', props: { id: `h-${text}`, level: 'h2', text } }],
  });

  describe('a page', () => {
    let parent: Row;
    let source: Row;

    beforeAll(async () => {
      parent = await post('/api/v1/admin/cms/pages', {
        name: 'Parent',
        slug: `${RUN}-parent`,
        salesChannelIds: [first.id, second.id],
        languages: ['en-US', 'pl-PL'],
      });
      const created = await post('/api/v1/admin/cms/pages', {
        name: 'About us',
        slug: `${RUN}-about`,
        description: 'Who we are',
        salesChannelIds: [first.id, second.id],
        languages: ['en-US', 'pl-PL'],
        meta: { 'en-US': { title: 'About', description: 'About us' }, 'pl-PL': { title: 'O nas' } },
        parentPageId: parent['id'],
        breadcrumbsVisible: false,
        breadcrumbsScheme: 'dark',
        translations: { 'pl-PL': { name: 'O nas', slug: `${RUN}-o-nas` } },
      });
      const id = created['id'] as string;
      const en = await put(`/api/v1/admin/cms/pages/${id}/content/en-US`, { data: tree('en'), version: created['version'] });
      await put(`/api/v1/admin/cms/pages/${id}/content/pl-PL`, { data: tree('pl'), version: en['version'] });
      // Not a foreign key (migration `cms_page_tree_and_share`), and the visibility check is not under test here.
      await h.em().execute('update cms_pages set share_image_asset_id = ? where id = ?', [randomUUID(), id]);
      source = await post(`/api/v1/admin/cms/pages/${id}/publish`, {});
    });

    it('copies every copied field into a draft at version 1, and leaves the source alone', async () => {
      const before = await row('cms_pages', source['id'] as string);

      const res = await duplicate('pages', source['id'] as string, { name: 'About us (kopia)' });
      expect(res.statusCode, res.body).toBe(201);
      const copyId = (res.json() as { data: { id: string } }).data.id;
      const copy = await row('cms_pages', copyId);

      expect(copy).toMatchObject({
        name: 'About us (kopia)',
        slug: `${RUN}-about-copy`,
        status: 'draft',
        published_at: null,
        archived_at: null,
        version: 1,
        description: 'Who we are',
        active: true,
        languages: ['en-US', 'pl-PL'],
        content: before['content'],
        meta_title: before['meta_title'],
        meta_description: before['meta_description'],
        parent_page_id: parent['id'],
        breadcrumbs_visible: false,
        breadcrumbs_scheme: 'dark',
        share_image_asset_id: before['share_image_asset_id'],
        translations: { 'pl-PL': { name: 'O nas', slug: `${RUN}-o-nas-copy` } },
      });
      expect(copy['path']).not.toBe(before['path']);

      const channelRows = (await h.em().execute(
        'select sales_channel_id::text as id, slug from cms_page_sales_channels where page_id = ? order by sales_channel_id',
        [copyId],
      )) as Array<{ id: string; slug: string }>;
      expect(channelRows.map((r) => r.slug)).toEqual([`${RUN}-about-copy`, `${RUN}-about-copy`]);
      expect(channelRows.map((r) => r.id).sort()).toEqual([first.id, second.id].sort());

      expect(await row('cms_pages', source['id'] as string)).toEqual(before);

      const entries = await duplicateEntries('cms_page.duplicate', 'sourcePageId', source['id'] as string);
      expect(entries).toHaveLength(1);
      expect(entries[0]!.objectType).toBe('cms_page');
      expect(entries[0]!.objectId).toBe(copyId);
      expect(entries[0]!.stateBefore ?? null).toBeNull();
      expect(entries[0]!.stateAfter).not.toHaveProperty('content');
    });

    it('gives a second copy -copy-2 on every slug', async () => {
      const res = await duplicate('pages', source['id'] as string);
      expect(res.statusCode, res.body).toBe(201);
      const copy = (res.json() as { data: { slug: string; translations: Record<string, { slug?: string }> } }).data;
      expect(copy.slug).toBe(`${RUN}-about-copy-2`);
      expect(copy.translations['pl-PL']?.slug).toBe(`${RUN}-o-nas-copy-2`);
    });

    it('is not served by the storefront while it is a draft', async () => {
      const res = await duplicate('pages', parent['id'] as string);
      const slug = (res.json() as { data: { slug: string } }).data.slug;
      const served = await h.app.inject({
        method: 'GET',
        url: `/api/v1/cms/pages/by-slug?slug=${encodeURIComponent(slug)}&language=en-US`,
        headers: { 'x-sales-channel': first.code, 'accept-language': 'en-US' },
      });
      expect(served.statusCode).toBe(404);
    });
  });

  describe('a refused page copy leaves no row and no audit entry', () => {
    it('when its slug starts with a reserved segment', async () => {
      const source = await post('/api/v1/admin/cms/pages', {
        name: 'Reserved',
        slug: `${RUN}-reserved`,
        salesChannelIds: [first.id],
        languages: ['en-US'],
      });
      const setting = `/api/v1/admin/settings/${encodeURIComponent(CMS_SETTING_CODES.RESERVED_SLUG_SEGMENTS)}/value`;
      const reserve = (value: string[]) =>
        h.app.inject({ method: 'PUT', url: setting, cookies: ADMIN, payload: { scope: 'all', value } });
      expect((await reserve([`${RUN}-reserved-copy`])).statusCode).toBe(200);
      try {
        const res = await duplicate('pages', source['id'] as string);
        expect(res.statusCode, res.body).toBe(409);
        expect((res.json() as { error: { code: string } }).error.code).toBe('CMS_SLUG_RESERVED');
      } finally {
        await reserve([]);
      }
      const rows = (await h.em().execute('select id from cms_pages where slug = ?', [`${RUN}-reserved-copy`])) as Row[];
      expect(rows).toEqual([]);
      expect(await duplicateEntries('cms_page.duplicate', 'sourcePageId', source['id'] as string)).toEqual([]);
    });

    it('when its slug is another page\'s computed path', async () => {
      // `<RUN>-grp/item-copy` is the public path of a nested page whose own slug is
      // `item-copy`: the taken set cannot see it, the path check after the write can.
      const group = await post('/api/v1/admin/cms/pages', {
        name: 'Group',
        slug: `${RUN}-grp`,
        salesChannelIds: [first.id],
        languages: ['en-US'],
      });
      await post('/api/v1/admin/cms/pages', {
        name: 'Nested',
        slug: 'item-copy',
        salesChannelIds: [first.id],
        languages: ['en-US'],
        parentPageId: group['id'],
        parentPathInUrl: true,
      });
      const flat = await post('/api/v1/admin/cms/pages', {
        name: 'Flat',
        slug: `${RUN}-grp/item`,
        salesChannelIds: [first.id],
        languages: ['en-US'],
      });

      const res = await duplicate('pages', flat['id'] as string);
      expect(res.statusCode, res.body).toBe(409);
      expect((res.json() as { error: { code: string } }).error.code).toBe('CMS_SLUG_CONFLICT');

      const rows = (await h.em().execute('select id from cms_pages where slug = ?', [`${RUN}-grp/item-copy`])) as Row[];
      expect(rows).toEqual([]);
      expect(await duplicateEntries('cms_page.duplicate', 'sourcePageId', flat['id'] as string)).toEqual([]);
    });
  });

  it('serialises two duplicates of one page into -copy and -copy-2', async () => {
    const source = await post('/api/v1/admin/cms/pages', {
      name: 'Concurrent',
      slug: `${RUN}-concurrent`,
      salesChannelIds: [first.id],
      languages: ['en-US'],
    });
    const answers = await Promise.all([
      duplicate('pages', source['id'] as string),
      duplicate('pages', source['id'] as string),
    ]);
    expect(answers.map((res) => res.statusCode)).toEqual([201, 201]);
    const slugs = answers.map((res) => (res.json() as { data: { slug: string } }).data.slug).sort();
    expect(slugs).toEqual([`${RUN}-concurrent-copy`, `${RUN}-concurrent-copy-2`]);
  });

  it('copies a block without its hook attachments', async () => {
    const block = await post('/api/v1/admin/cms/blocks', {
      name: 'Promo',
      code: `${RUN}-promo`,
      active: false,
      description: 'A promo',
      salesChannelIds: [first.id, second.id],
      languages: ['en-US'],
    });
    const withContent = await put(`/api/v1/admin/cms/blocks/${block['id'] as string}/content/en-US`, {
      data: tree('promo'),
      version: block['version'],
    });
    const hook = await post('/api/v1/admin/cms/hooks', {
      name: 'Top',
      code: `${RUN}-top`,
      salesChannelIds: [first.id],
    });
    await post(`/api/v1/admin/cms/hooks/${hook['id'] as string}/attachments`, { blockId: block['id'], position: 0 });

    const res = await duplicate('blocks', block['id'] as string);
    expect(res.statusCode, res.body).toBe(201);
    const copyId = (res.json() as { data: { id: string } }).data.id;
    expect(await row('cms_blocks', copyId)).toMatchObject({
      name: 'Promo (copy)',
      code: `${RUN}-promo-copy`,
      active: false,
      description: 'A promo',
      version: 1,
      content: withContent['content'],
    });
    const codes = (await h.em().execute('select code from cms_block_sales_channels where block_id = ?', [copyId])) as Row[];
    expect(codes).toEqual([{ code: `${RUN}-promo-copy` }, { code: `${RUN}-promo-copy` }]);
    const attachments = (await h.em().execute('select * from cms_hook_block_attachments where block_id = ?', [
      copyId,
    ])) as Row[];
    expect(attachments).toEqual([]);
    expect(await duplicateEntries('cms_block.duplicate', 'sourceBlockId', block['id'] as string)).toHaveLength(1);
  });

  it('copies a template', async () => {
    const template = await post('/api/v1/admin/cms/templates', {
      name: 'Landing',
      code: `${RUN}-landing`,
      salesChannelIds: [first.id],
      languages: ['en-US'],
    });
    const withContent = await put(`/api/v1/admin/cms/templates/${template['id'] as string}/content/en-US`, {
      data: tree('landing'),
      version: template['version'],
    });

    const res = await duplicate('templates', template['id'] as string);
    expect(res.statusCode, res.body).toBe(201);
    const copyId = (res.json() as { data: { id: string } }).data.id;
    expect(await row('cms_templates', copyId)).toMatchObject({
      name: 'Landing (copy)',
      code: `${RUN}-landing-copy`,
      version: 1,
      content: withContent['content'],
    });
    expect(await duplicateEntries('cms_template.duplicate', 'sourceTemplateId', template['id'] as string)).toHaveLength(1);
  });
});
