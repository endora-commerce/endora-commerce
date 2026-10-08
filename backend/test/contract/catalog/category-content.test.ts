import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Asset, Category } from '../../helpers/package-entities.js';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Category page content — the Page Builder document an operator authors for a
 * category's storefront page.
 *
 * Pins both surfaces of it:
 *
 *   - the admin pair `GET` / `PUT /api/v1/admin/catalog/categories/:id/content`,
 *     which read and replace the whole per-language envelope, gated by
 *     `catalog:read` / `catalog:write` and written through the Command Bus;
 *   - the storefront read `GET /api/v1/catalog/categories/:id/content`, which
 *     answers one document resolved to a language and follows the visibility
 *     rule of the category tree — a category the tree does not list has no
 *     content either.
 *
 * The admin list stays free of the document on purpose: it is rendered as a
 * tree of every category, and a megabyte per row is not a list.
 */

const ADMIN = { b2b_session: 'stub-admin-session' };
// Feature 026 fixture — an admin holding only `orders:read`.
const RESTRICTED = { b2b_session: 'stub-restricted-admin-session' };

const tree = (html: string): Record<string, unknown> => ({
  root: { props: {} },
  content: [{ type: 'RichContent', props: { id: `rc-${html.length}`, html } }],
});
const EMPTY_TREE = { root: { props: {} }, content: [] };

interface AdminContent {
  categoryId: string;
  content: { languages: Record<string, unknown> } | null;
}
interface PageContent {
  categoryId: string;
  language: string | null;
  content: Record<string, unknown> | null;
}

describe('category page content — contract', () => {
  let h: BackendServerHandle;
  let serial = 0;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function createCategory(
    overrides: { parentCategoryId?: string; isActive?: boolean } = {},
  ): Promise<{ id: string; slug: string }> {
    serial += 1;
    const slug = `content-case-${serial}`;
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/categories',
      cookies: ADMIN,
      payload: { name: { 'en-US': `Content case ${serial}` }, slug, ...overrides },
    });
    expect(res.statusCode).toBe(201);
    return { id: (res.json() as { data: { id: string } }).data.id, slug };
  }

  function putContent(id: string, content: unknown, cookies = ADMIN) {
    return h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/catalog/categories/${id}/content`,
      cookies,
      payload: { content },
    });
  }

  function getPageContent(id: string, language?: string) {
    return h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/categories/${id}/content`,
      ...(language ? { headers: { 'accept-language': language } } : {}),
    });
  }

  describe('admin', () => {
    it('reads null for a category nobody authored content for', async () => {
      const { id } = await createCategory();
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/admin/catalog/categories/${id}/content`,
        cookies: ADMIN,
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { data: AdminContent }).data).toEqual({ categoryId: id, content: null });
    });

    it('stores the envelope per language and reads it back whole', async () => {
      const { id } = await createCategory();
      const envelope = { languages: { 'en-US': tree('<p>Hello</p>'), 'pl-PL': tree('<p>Cześć</p>') } };

      const put = await putContent(id, envelope);
      expect(put.statusCode).toBe(200);
      expect((put.json() as { data: AdminContent }).data).toEqual({ categoryId: id, content: envelope });

      const get = await h.app.inject({
        method: 'GET',
        url: `/api/v1/admin/catalog/categories/${id}/content`,
        cookies: ADMIN,
      });
      expect((get.json() as { data: AdminContent }).data.content).toEqual(envelope);
    });

    it('clears the content with null', async () => {
      const { id } = await createCategory();
      await putContent(id, { languages: { 'en-US': tree('<p>Soon gone</p>') } });

      const cleared = await putContent(id, null);
      expect(cleared.statusCode).toBe(200);
      expect((cleared.json() as { data: AdminContent }).data.content).toBeNull();
      expect((await getPageContent(id)).json()).toMatchObject({ data: { content: null } });
    });

    it('keeps the document out of the category list', async () => {
      const { id } = await createCategory();
      await putContent(id, { languages: { 'en-US': tree('<p>Not in the list</p>') } });

      const list = await h.app.inject({
        method: 'GET',
        url: '/api/v1/admin/catalog/categories',
        cookies: ADMIN,
      });
      const row = (list.json() as { data: Array<Record<string, unknown>> }).data.find(
        (c) => c['id'] === id,
      );
      expect(row).toBeDefined();
      expect(row).not.toHaveProperty('content');

      // And not merely left out of the serialiser: the column is lazy, so a
      // read of the entity that does not ask for the document does not select
      // it. The tree, the list and every port that walks the hierarchy read
      // the entity this way.
      const plain = await h.em().fork({ clear: true }).findOneOrFail(Category, { id });
      expect(plain.content).toBeUndefined();
      const populated = await h
        .em()
        .fork({ clear: true })
        .findOneOrFail(Category, { id }, { populate: ['content'] });
      expect(populated.content).toEqual({
        languages: { 'en-US': tree('<p>Not in the list</p>') },
      });
    });

    it('audits the write as one Command and records the languages, not the document', async () => {
      const { id } = await createCategory();
      await putContent(id, { languages: { 'pl-PL': tree('<p>Audyt</p>') } });

      const entries = await h
        .em()
        .find(AuditLogEntry, { action: 'category.content.update', objectId: id });
      expect(entries).toHaveLength(1);
      const serialised = JSON.stringify(entries[0]);
      expect(serialised).toContain('pl-PL');
      expect(serialised).not.toContain('Audyt');
    });

    it('refuses a document that is not an object, and stores nothing', async () => {
      const { id } = await createCategory();
      const res = await putContent(id, { languages: { 'en-US': '<p>raw html</p>' } });
      expect(res.statusCode).toBe(400);

      const get = await h.app.inject({
        method: 'GET',
        url: `/api/v1/admin/catalog/categories/${id}/content`,
        cookies: ADMIN,
      });
      expect((get.json() as { data: AdminContent }).data.content).toBeNull();
    });

    it('keeps a library asset the content embeds from being deleted', async () => {
      const em = h.em();
      const asset = em.create(Asset, {
        kind: 'image',
        filename: 'category-banner.png',
        mimeType: 'image/png',
        sizeBytes: '0',
        storageUrl: 'https://example.com/category-banner.png',
        storageLocator: 'https://example.com/category-banner.png',
        storageBackend: 'legacy',
        visibility: 'public',
      });
      await em.persistAndFlush(asset);

      const { id } = await createCategory();
      // Nested on purpose: a block keeps the id wherever its own props put it.
      await putContent(id, {
        languages: {
          'en-US': {
            root: { props: {} },
            content: [
              { type: 'cms.Hero', props: { id: 'hero-1', background: { image: { assetId: asset.id } } } },
            ],
          },
        },
      });

      const refused = await h.app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/assets/${asset.id}`,
        cookies: ADMIN,
      });
      expect(refused.statusCode).toBe(409);
      expect(refused.json()).toMatchObject({ error: { code: 'ASSET_REFERENCED' } });

      // Clearing the content releases the asset.
      await putContent(id, null);
      const released = await h.app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/assets/${asset.id}`,
        cookies: ADMIN,
      });
      expect(released.statusCode).toBeLessThan(300);
    });

    it('answers 404 for a category that does not exist', async () => {
      const missing = '00000000-0000-4000-8000-00000000dead';
      const put = await putContent(missing, null);
      expect(put.statusCode).toBe(404);
      const get = await h.app.inject({
        method: 'GET',
        url: `/api/v1/admin/catalog/categories/${missing}/content`,
        cookies: ADMIN,
      });
      expect(get.statusCode).toBe(404);
    });

    it('gates the read and the write on the catalog permissions', async () => {
      const { id } = await createCategory();
      const put = await putContent(id, null, RESTRICTED);
      expect(put.statusCode).toBe(403);
      const get = await h.app.inject({
        method: 'GET',
        url: `/api/v1/admin/catalog/categories/${id}/content`,
        cookies: RESTRICTED,
      });
      expect(get.statusCode).toBe(403);
      const anonymous = await h.app.inject({
        method: 'PUT',
        url: `/api/v1/admin/catalog/categories/${id}/content`,
        payload: { content: null },
      });
      expect(anonymous.statusCode).toBe(401);
    });
  });

  describe('storefront', () => {
    it('answers the document in the language the caller asked for', async () => {
      const { id } = await createCategory();
      await putContent(id, {
        languages: { 'en-US': tree('<p>Hello</p>'), 'pl-PL': tree('<p>Cześć</p>') },
      });

      const pl = (await getPageContent(id, 'pl-PL')).json() as { data: PageContent };
      expect(pl.data).toEqual({ categoryId: id, language: 'pl-PL', content: tree('<p>Cześć</p>') });

      const en = (await getPageContent(id, 'en-US')).json() as { data: PageContent };
      expect(en.data.language).toBe('en-US');
      expect(en.data.content).toEqual(tree('<p>Hello</p>'));
    });

    it('falls back to another language rather than rendering nothing', async () => {
      const { id } = await createCategory();
      await putContent(id, { languages: { 'en-US': tree('<p>Only English</p>') } });

      const res = (await getPageContent(id, 'de-DE')).json() as { data: PageContent };
      expect(res.data.language).toBe('en-US');
      expect(res.data.content).toEqual(tree('<p>Only English</p>'));
    });

    it('skips a language whose document holds no block', async () => {
      const { id } = await createCategory();
      await putContent(id, {
        languages: { 'pl-PL': EMPTY_TREE, 'en-US': tree('<p>The one with blocks</p>') },
      });

      const res = (await getPageContent(id, 'pl-PL')).json() as { data: PageContent };
      expect(res.data.language).toBe('en-US');
    });

    it('answers null content when nothing is authored or every document is empty', async () => {
      const untouched = await createCategory();
      const first = await getPageContent(untouched.id);
      expect(first.statusCode).toBe(200);
      expect((first.json() as { data: PageContent }).data).toEqual({
        categoryId: untouched.id,
        language: null,
        content: null,
      });

      const emptied = await createCategory();
      await putContent(emptied.id, { languages: { 'en-US': EMPTY_TREE } });
      const second = (await getPageContent(emptied.id)).json() as { data: PageContent };
      expect(second.data.content).toBeNull();
    });

    it('answers 404 for a category the storefront does not list', async () => {
      expect((await getPageContent('00000000-0000-4000-8000-00000000dead')).statusCode).toBe(404);
      // Not an id at all: a 404 like any other miss, never a database error.
      expect((await getPageContent('no-such-category')).statusCode).toBe(404);

      const inactive = await createCategory({ isActive: false });
      await putContent(inactive.id, { languages: { 'en-US': tree('<p>Hidden</p>') } });
      expect((await getPageContent(inactive.id)).statusCode).toBe(404);

      // Deactivating a category hides its whole branch, so a child's content
      // must not stay reachable by id.
      const child = await createCategory({ parentCategoryId: inactive.id });
      await putContent(child.id, { languages: { 'en-US': tree('<p>Hidden branch</p>') } });
      expect((await getPageContent(child.id)).statusCode).toBe(404);
    });
  });
});
