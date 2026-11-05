import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { seedProductScopesAdmins } from '../../helpers/product-scopes-admins.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 172 (`specs/172-product-content-attributes/`, contracts/admin-api.md
 * §4–§5, research R-8, R-9) — a product's Page Builder content attributes.
 *
 * The admin trio `GET …/products/:id/content`, `GET` / `PUT
 * …/products/:id/content/:attributeKey`: the card list reads summaries only,
 * the single read answers one envelope, and the replace runs as the audited
 * Command `product.content.update`, which records the languages and never the
 * documents, and emits `product.content.updated.v1` — not
 * `product.updated.v1`, so nothing re-indexes (FR-035).
 */

const ADMIN = { b2b_session: 'stub-admin-session' };
// Feature 026 fixture — an admin holding only `orders:read`.
const RESTRICTED = { b2b_session: 'stub-restricted-admin-session' };
// Feature 163 fixture — an admin holding only `catalog:read`.
const READER = { b2b_session: 'stub-product-scopes-reader-session' };

const tree = (text: string): Record<string, unknown> => ({
  root: { props: {} },
  content: [{ type: 'RichContent', props: { id: `rc-${text.length}`, html: `<p>${text}</p>` } }],
});
const EMPTY_TREE = { root: { props: {} }, content: [] };

interface ContentList {
  productId: string;
  attributeSetId: string | null;
  attributes: Array<{
    attributeId: string;
    key: string;
    label: Record<string, string>;
    labelDefault: string;
    position: number;
    languages: Array<{ language: string; filled: boolean; blocks: number; excerpt: string | null }>;
  }>;
}
interface ContentOne {
  productId: string;
  attributeKey: string;
  content: { languages: Record<string, unknown> } | null;
}

describe('Product content — admin routes (feature 172)', () => {
  let h: BackendServerHandle;
  let setId: string;
  let serial = 0;

  async function createAttribute(key: string, type: string): Promise<string> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/attributes',
      cookies: ADMIN,
      payload: {
        key,
        label: { 'en-US': `EN ${key}`, 'pl-PL': `PL ${key}` },
        labelDefault: `EN ${key}`,
        type,
        isSearchable: false,
        isFilterable: false,
        isVariantAxis: false,
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { data: { id: string } }).data.id;
  }

  async function createProduct(attributeValues: Record<string, unknown> = {}): Promise<string> {
    serial += 1;
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      cookies: ADMIN,
      payload: {
        sku: `PC-172-${serial}`,
        type: 'simple',
        name: `Content drill ${serial}`,
        description: 'Plain description',
        categoryIds: [],
        attributeSetId: setId,
        attributeValues,
        visibility: 'public',
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { data: { id: string } }).data.id;
  }

  const list = (productId: string, cookies = ADMIN) =>
    h.app.inject({ method: 'GET', url: `/api/v1/admin/catalog/products/${productId}/content`, cookies });
  const getOne = (productId: string, key: string, cookies = ADMIN) =>
    h.app.inject({ method: 'GET', url: `/api/v1/admin/catalog/products/${productId}/content/${key}`, cookies });
  const put = (productId: string, key: string, content: unknown, cookies = ADMIN) =>
    h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/catalog/products/${productId}/content/${key}`,
      cookies,
      payload: { content },
    });

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedProductScopesAdmins(h);

    const guide = await createAttribute('pc_guide', 'page_builder');
    const banner = await createAttribute('pc_banner', 'page_builder');
    const tieB = await createAttribute('pc_tie_b', 'page_builder');
    const tieA = await createAttribute('pc_tie_a', 'page_builder');
    const plain = await createAttribute('pc_plain', 'input');
    // A content attribute outside the set: kept out of every read and write.
    await createAttribute('pc_outside', 'page_builder');

    const set = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/attribute-sets',
      cookies: ADMIN,
      payload: { code: 'pc_set_172', name: { 'en-US': 'Content set' } },
    });
    expect(set.statusCode, set.body).toBe(201);
    setId = (set.json() as { data: { id: string } }).data.id;
    const assign = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/attribute-sets/${setId}/attributes`,
      cookies: ADMIN,
      payload: {
        assignments: [
          { attributeId: plain, position: 0 },
          { attributeId: guide, position: 3 },
          { attributeId: banner, position: 1 },
          { attributeId: tieB, position: 2 },
          { attributeId: tieA, position: 2 },
        ],
      },
    });
    expect(assign.statusCode, assign.body).toBe(200);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  describe('admin content routes', () => {
    it('lists the set’s content attributes by position then key, summaries only (FR-020)', async () => {
      const productId = await createProduct();
      expect((await put(productId, 'pc_guide', { languages: { 'en-US': tree('Choosing the right drill') } })).statusCode).toBe(200);

      const res = await list(productId);
      expect(res.statusCode, res.body).toBe(200);
      const data = (res.json() as { data: ContentList }).data;
      expect(data).toMatchObject({ productId, attributeSetId: setId });
      expect(data.attributes.map((a) => a.key)).toEqual(['pc_banner', 'pc_tie_a', 'pc_tie_b', 'pc_guide']);
      const guide = data.attributes.find((a) => a.key === 'pc_guide')!;
      expect(guide).toMatchObject({
        label: { 'en-US': 'EN pc_guide', 'pl-PL': 'PL pc_guide' },
        labelDefault: 'EN pc_guide',
        position: 3,
        languages: [{ language: 'en-US', filled: true, blocks: 1, excerpt: 'Choosing the right drill' }],
      });
      expect(data.attributes.find((a) => a.key === 'pc_banner')!.languages).toEqual([]);
      expect(res.body).not.toContain('"content"');
      expect(res.body).not.toContain('RichContent');
    });

    it('answers 404 PRODUCT_NOT_FOUND for an unknown or soft-deleted product', async () => {
      const unknown = await list('00000000-0000-4000-8000-00000000f172');
      expect(unknown.statusCode).toBe(404);
      expect((unknown.json() as { error: { code: string } }).error.code).toBe('PRODUCT_NOT_FOUND');

      const productId = await createProduct();
      const deleted = await h.app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/catalog/products/${productId}`,
        cookies: ADMIN,
      });
      expect(deleted.statusCode, deleted.body).toBeLessThan(300);
      for (const res of [await list(productId), await getOne(productId, 'pc_guide'), await put(productId, 'pc_guide', null)]) {
        expect(res.statusCode).toBe(404);
        expect((res.json() as { error: { code: string } }).error.code).toBe('PRODUCT_NOT_FOUND');
      }
    });

    it('reads one envelope, null before anything is stored', async () => {
      const productId = await createProduct();
      const before = await getOne(productId, 'pc_guide');
      expect(before.statusCode, before.body).toBe(200);
      expect((before.json() as { data: ContentOne }).data).toEqual({
        productId,
        attributeKey: 'pc_guide',
        content: null,
      });

      const envelope = { languages: { 'en-US': tree('Guide'), 'pl-PL': tree('Poradnik') } };
      expect((await put(productId, 'pc_guide', envelope)).statusCode).toBe(200);
      expect(((await getOne(productId, 'pc_guide')).json() as { data: ContentOne }).data.content).toEqual(envelope);
    });

    it('answers 404 NOT_FOUND for a key that is not a content attribute of the set', async () => {
      const productId = await createProduct();
      for (const key of ['pc_plain', 'pc_outside', 'pc_nope']) {
        const res = await getOne(productId, key);
        expect(res.statusCode, key).toBe(404);
        expect((res.json() as { error: { code: string } }).error.code).toBe('NOT_FOUND');
      }
    });

    it('stores the normalised envelope: a language with no block is dropped (FR-013)', async () => {
      const productId = await createProduct();
      const res = await put(productId, 'pc_guide', { languages: { 'en-US': tree('Kept'), 'pl-PL': EMPTY_TREE } });
      expect(res.statusCode, res.body).toBe(200);
      expect((res.json() as { data: ContentOne }).data.content).toEqual({ languages: { 'en-US': tree('Kept') } });
      const summary = (await list(productId)).json() as { data: ContentList };
      expect(summary.data.attributes.find((a) => a.key === 'pc_guide')!.languages.map((l) => l.language)).toEqual([
        'en-US',
      ]);
    });

    it('deletes the value when every language is empty, or the content is null (FR-013)', async () => {
      const productId = await createProduct();
      await put(productId, 'pc_guide', { languages: { 'en-US': tree('Soon gone') } });
      const emptied = await put(productId, 'pc_guide', { languages: { 'en-US': EMPTY_TREE } });
      expect(emptied.statusCode).toBe(200);
      expect((emptied.json() as { data: ContentOne }).data.content).toBeNull();
      expect(await rowCount(productId)).toBe(0);

      await put(productId, 'pc_guide', { languages: { 'en-US': tree('Back') } });
      expect(await rowCount(productId)).toBe(1);
      const cleared = await put(productId, 'pc_guide', null);
      expect(cleared.statusCode).toBe(200);
      expect((cleared.json() as { data: ContentOne }).data.content).toBeNull();
      expect(await rowCount(productId)).toBe(0);
    });

    it('refuses content over 1 MiB naming the limit, and stores nothing (FR-012)', async () => {
      const productId = await createProduct();
      const big = { languages: { 'en-US': tree('x'.repeat(1_048_576)) } };
      const res = await put(productId, 'pc_guide', big);
      expect(res.statusCode, res.body.slice(0, 300)).toBe(400);
      expect((res.json() as { error: { message: string } }).error.message).toContain('1048576');
      expect(await rowCount(productId)).toBe(0);
    });

    it('refuses a key that is not a content attribute of the product’s set with ATTRIBUTE_VALUE_REJECTED (FR-012)', async () => {
      const productId = await createProduct();
      for (const key of ['pc_plain', 'pc_outside', 'pc_nope']) {
        const res = await put(productId, key, { languages: { 'en-US': tree('Nope') } });
        expect(res.statusCode, key).toBe(400);
        const body = res.json() as { error: { code: string; details?: Array<{ path: string }> } };
        expect(body.error.code).toBe('ATTRIBUTE_VALUE_REJECTED');
        expect(body.error.details?.[0]?.path).toBe('attributeKey');
      }
      expect(await rowCount(productId)).toBe(0);
    });

    it('needs catalog:read to read and catalog:write to save (FR-023)', async () => {
      const productId = await createProduct();
      expect((await list(productId, RESTRICTED)).statusCode).toBe(403);
      expect((await getOne(productId, 'pc_guide', RESTRICTED)).statusCode).toBe(403);
      expect((await list(productId, READER)).statusCode).toBe(200);
      expect((await getOne(productId, 'pc_guide', READER)).statusCode).toBe(200);
      const refused = await put(productId, 'pc_guide', { languages: { 'en-US': tree('No') } }, READER);
      expect(refused.statusCode).toBe(403);
      expect(await rowCount(productId)).toBe(0);
    });

    it('audits one product.content.update row with the languages and no document (FR-024)', async () => {
      const productId = await createProduct();
      await put(productId, 'pc_guide', { languages: { 'pl-PL': tree('Audytowany poradnik'), 'en-US': tree('Audited') } });
      const entries = await h
        .em()
        .fork()
        .find(AuditLogEntry, { action: 'product.content.update', objectId: productId });
      expect(entries).toHaveLength(1);
      const entry = entries[0]!;
      expect(entry.objectType).toBe('product');
      expect(entry.stateBefore).toEqual({ attributeKey: 'pc_guide', languages: [] });
      expect(entry.stateAfter).toEqual({ attributeKey: 'pc_guide', languages: ['en-US', 'pl-PL'] });
      const serialised = JSON.stringify(entry);
      expect(serialised).not.toContain('Audytowany');
      expect(serialised).not.toContain('RichContent');
    });

    it('leaves the product, its attribute values and other attributes’ content alone; last save wins (FR-010)', async () => {
      const productId = await createProduct({ pc_plain: 'kept value' });
      await put(productId, 'pc_banner', { languages: { 'en-US': tree('Banner') } });
      const before = await h.app.inject({ method: 'GET', url: `/api/v1/admin/catalog/products/${productId}`, cookies: ADMIN });

      await put(productId, 'pc_guide', { languages: { 'en-US': tree('First') } });
      await put(productId, 'pc_guide', { languages: { 'en-US': tree('Second') } });

      const after = await h.app.inject({ method: 'GET', url: `/api/v1/admin/catalog/products/${productId}`, cookies: ADMIN });
      const pick = (res: typeof before) => {
        const data = (res.json() as { data: Record<string, unknown> }).data;
        return { name: data['name'], description: data['description'], attributeValues: data['attributeValues'], sku: data['sku'] };
      };
      expect(pick(after)).toEqual(pick(before));
      expect(pick(after).attributeValues).toEqual({ pc_plain: 'kept value' });
      expect(((await getOne(productId, 'pc_banner')).json() as { data: ContentOne }).data.content).toEqual({
        languages: { 'en-US': tree('Banner') },
      });
      expect(((await getOne(productId, 'pc_guide')).json() as { data: ContentOne }).data.content).toEqual({
        languages: { 'en-US': tree('Second') },
      });
    });

    it('emits product.content.updated.v1 and not product.updated.v1 (FR-035)', async () => {
      const productId = await createProduct();
      const contentEvents: unknown[] = [];
      const productEvents: unknown[] = [];
      const offContent = h.eventBus.on('product.content.updated.v1' as never, (payload: unknown) => {
        contentEvents.push(payload);
      });
      const offProduct = h.eventBus.on('product.updated.v1', (payload: unknown) => {
        if ((payload as { productId?: string }).productId === productId) productEvents.push(payload);
      });
      try {
        const res = await put(productId, 'pc_guide', { languages: { 'en-US': tree('Evented') } });
        expect(res.statusCode).toBe(200);
        await new Promise((resolve) => setTimeout(resolve, 50));
      } finally {
        offContent();
        offProduct();
      }
      expect(contentEvents).toEqual([expect.objectContaining({ productId, attributeKey: 'pc_guide' })]);
      expect(productEvents).toEqual([]);
    });
  });

  describe('PDP include=content', () => {
    interface Detail {
      id: string;
      slug: string;
      contentAttributes?: Array<{ key: string; language: string; content: Record<string, unknown> }>;
    }
    let retailChannelId: string;
    let retailDefaultLanguage: string;

    async function createVisibleProduct(): Promise<{ id: string; slug: string }> {
      serial += 1;
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/catalog/products',
        cookies: ADMIN,
        payload: {
          sku: `PC-PDP-172-${serial}`,
          type: 'simple',
          status: 'active',
          name: `Visible drill ${serial}`,
          description: 'Plain description',
          categoryIds: [],
          attributeSetId: setId,
          attributeValues: {},
          visibility: 'public',
        },
      });
      expect(res.statusCode, res.body).toBe(201);
      const data = (res.json() as { data: { id: string; slug: string } }).data;
      await h
        .em()
        .getConnection()
        .execute(
          `insert into sales_channel_products (sales_channel_id, product_id) values (?, ?) on conflict do nothing`,
          [retailChannelId, data.id],
        );
      return data;
    }

    const pdp = (idOrSlug: string, query = '', language?: string) =>
      h.app.inject({
        method: 'GET',
        url: `/api/v1/catalog/products/${idOrSlug}${query}`,
        headers: { 'x-sales-channel': 'pl_retail', ...(language ? { 'accept-language': language } : {}) },
      });

    beforeAll(async () => {
      const rows = await h
        .em()
        .getConnection()
        .execute<Array<{ id: string; default_language: string }>>(
          `select id, default_language from sales_channels where code = 'pl_retail'`,
          [],
          'all',
        );
      retailChannelId = rows[0]!.id;
      retailDefaultLanguage = rows[0]!.default_language;
    });

    it('leaves the response without include byte-identical, with no contentAttributes key (FR-036)', async () => {
      const product = await createVisibleProduct();
      const before = await pdp(product.slug);
      expect(before.statusCode, before.body).toBe(200);
      expect(before.body).not.toContain('contentAttributes');

      await put(product.id, 'pc_guide', { languages: { 'en-US': tree('Authored') } });
      const after = await pdp(product.slug);
      expect(after.body).toBe(before.body);
    });

    it('carries the content attributes in set order, then by key, with no label (FR-030, FR-037)', async () => {
      const product = await createVisibleProduct();
      await put(product.id, 'pc_guide', { languages: { 'en-US': tree('Guide') } });
      await put(product.id, 'pc_tie_b', { languages: { 'en-US': tree('Tie B') } });
      await put(product.id, 'pc_tie_a', { languages: { 'en-US': tree('Tie A') } });
      await put(product.id, 'pc_banner', { languages: { 'en-US': tree('Banner') } });

      const res = await pdp(product.slug, '?include=content', 'en-US');
      expect(res.statusCode, res.body).toBe(200);
      const content = (res.json() as { data: Detail }).data.contentAttributes!;
      expect(content.map((entry) => entry.key)).toEqual(['pc_banner', 'pc_tie_a', 'pc_tie_b', 'pc_guide']);
      expect(content[0]).toEqual({ key: 'pc_banner', language: 'en-US', content: tree('Banner') });
      for (const entry of content) expect(Object.keys(entry).sort()).toEqual(['content', 'key', 'language']);
      expect(res.body).not.toContain('EN pc_guide');
    });

    it('resolves each document: visitor, channel default, en-US, then any stored; an empty language is skipped (FR-033)', async () => {
      const product = await createVisibleProduct();
      await put(product.id, 'pc_guide', { languages: { 'en-US': tree('English'), 'de-DE': tree('Deutsch') } });
      await put(product.id, 'pc_banner', { languages: { 'de-DE': tree('Nur Deutsch') } });
      await put(product.id, 'pc_tie_a', {
        languages: { 'pl-PL': tree('Polski'), [retailDefaultLanguage]: tree('Kanał') },
      });

      const read = async (language?: string) =>
        Object.fromEntries(
          ((await pdp(product.slug, '?include=content', language)).json() as { data: Detail }).data.contentAttributes!.map(
            (entry) => [entry.key, entry.language],
          ),
        );

      expect(await read('de-DE')).toMatchObject({ pc_guide: 'de-DE', pc_banner: 'de-DE' });
      const fallback = await read('fr-FR');
      expect(fallback['pc_guide']).toBe('en-US');
      expect(fallback['pc_banner']).toBe('de-DE');
      expect(fallback['pc_tie_a']).toBe(retailDefaultLanguage);

      // A stored language whose document has no block is skipped.
      await h
        .em()
        .getConnection()
        .execute(
          `update product_content_values
              set content = jsonb_set(content, '{languages,fr-FR}', ?::jsonb)
            where product_id = ?`,
          [JSON.stringify(EMPTY_TREE), product.id],
        );
      const skipped = await read('fr-FR');
      expect(skipped['pc_guide']).toBe('en-US');
    });

    it('refuses include=other with 400', async () => {
      const product = await createVisibleProduct();
      const res = await pdp(product.slug, '?include=other');
      expect(res.statusCode).toBe(400);
    });

    it('answers an invisible product as today, whatever include asks for', async () => {
      const product = await createVisibleProduct();
      await put(product.id, 'pc_guide', { languages: { 'en-US': tree('Hidden') } });
      await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/catalog/products/${product.id}`,
        cookies: ADMIN,
        payload: { status: 'inactive' },
      });
      const plain = await pdp(product.slug);
      const withContent = await pdp(product.slug, '?include=content');
      expect(plain.statusCode).toBeGreaterThanOrEqual(404);
      expect(withContent.statusCode).toBe(plain.statusCode);
      expect(withContent.body).not.toContain('Hidden');
    });

    it('answers [] for a product whose set holds no content attribute', async () => {
      serial += 1;
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/catalog/products',
        cookies: ADMIN,
        payload: {
          sku: `PC-PDP-NOSET-${serial}`,
          type: 'simple',
          status: 'active',
          name: 'No content drill',
          description: 'Plain',
          categoryIds: [],
          attributeValues: {},
          visibility: 'public',
        },
      });
      const data = (res.json() as { data: { id: string; slug: string } }).data;
      await h
        .em()
        .getConnection()
        .execute(`insert into sales_channel_products (sales_channel_id, product_id) values (?, ?) on conflict do nothing`, [
          retailChannelId,
          data.id,
        ]);
      const detail = await pdp(data.slug, '?include=content');
      expect(detail.statusCode, detail.body).toBe(200);
      expect((detail.json() as { data: Detail }).data.contentAttributes).toEqual([]);
    });
  });

  // Feature 172, US6 (FR-060 – FR-062, owner ruling OR-6, research R-16) — content
  // follows the product: a duplicate carries it, set membership hides and reveals
  // it without writing, and a soft delete makes it unreachable without removing it.
  describe('lifecycle', () => {
    let lifecycleSetId: string;
    let lifecycleAttributeId: string;
    let retailChannelId: string;

    beforeAll(async () => {
      lifecycleAttributeId = await createAttribute('pc_life', 'page_builder');
      const set = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/catalog/attribute-sets',
        cookies: ADMIN,
        payload: { code: 'pc_life_set_172', name: { 'en-US': 'Lifecycle set' } },
      });
      expect(set.statusCode, set.body).toBe(201);
      lifecycleSetId = (set.json() as { data: { id: string } }).data.id;
      await assign();
      const rows = await h
        .em()
        .getConnection()
        .execute<Array<{ id: string }>>(`select id from sales_channels where code = 'pl_retail'`, [], 'all');
      retailChannelId = rows[0]!.id;
    });

    async function assign(): Promise<void> {
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/catalog/attribute-sets/${lifecycleSetId}/attributes`,
        cookies: ADMIN,
        payload: { assignments: [{ attributeId: lifecycleAttributeId, position: 0 }] },
      });
      expect(res.statusCode, res.body).toBe(200);
    }

    async function unassign(): Promise<void> {
      const res = await h.app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/catalog/attribute-sets/${lifecycleSetId}/attributes/${lifecycleAttributeId}`,
        cookies: ADMIN,
      });
      expect(res.statusCode, res.body).toBe(204);
    }

    async function createLifecycleProduct(): Promise<{ id: string; slug: string }> {
      serial += 1;
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/catalog/products',
        cookies: ADMIN,
        payload: {
          sku: `PC-LIFE-172-${serial}`,
          type: 'simple',
          status: 'active',
          name: `Lifecycle drill ${serial}`,
          description: 'Plain description',
          categoryIds: [],
          attributeSetId: lifecycleSetId,
          attributeValues: {},
          visibility: 'public',
        },
      });
      expect(res.statusCode, res.body).toBe(201);
      const data = (res.json() as { data: { id: string; slug: string } }).data;
      await h
        .em()
        .getConnection()
        .execute(`insert into sales_channel_products (sales_channel_id, product_id) values (?, ?) on conflict do nothing`, [
          retailChannelId,
          data.id,
        ]);
      return data;
    }

    const pdpContent = async (slug: string): Promise<{ status: number; keys: string[] | undefined }> => {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/catalog/products/${slug}?include=content`,
        headers: { 'x-sales-channel': 'pl_retail', 'accept-language': 'en-US' },
      });
      const body = res.statusCode === 200 ? (res.json() as { data: { contentAttributes?: Array<{ key: string }> } }) : null;
      return { status: res.statusCode, keys: body?.data.contentAttributes?.map((entry) => entry.key) };
    };

    async function storedRows(productId: string): Promise<Array<{ product_attribute_id: string; content: unknown; summary: unknown }>> {
      return h
        .em()
        .getConnection()
        .execute(
          `select product_attribute_id, content, summary from product_content_values where product_id = ? order by product_attribute_id`,
          [productId],
          'all',
        );
    }

    it('a duplicate carries identical content rows, and its audit row counts them (FR-060)', async () => {
      const source = await createLifecycleProduct();
      await put(source.id, 'pc_life', { languages: { 'en-US': tree('Copied'), 'pl-PL': tree('Skopiowane') } });

      const res = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/catalog/products/${source.id}/duplicate`,
        cookies: ADMIN,
      });
      expect(res.statusCode, res.body).toBeLessThan(300);
      const copyId = (res.json() as { data: { id: string } }).data.id;

      const original = await storedRows(source.id);
      expect(original).toHaveLength(1);
      expect(await storedRows(copyId)).toEqual(original);
      expect(((await getOne(copyId, 'pc_life')).json() as { data: ContentOne }).data.content).toEqual({
        languages: { 'en-US': tree('Copied'), 'pl-PL': tree('Skopiowane') },
      });

      // The Command's row. (The duplicate route also writes a second
      // `product.duplicate` row of its own, which predates this feature.)
      const audit = await h.em().fork().find(AuditLogEntry, { action: 'product.duplicate', objectId: copyId });
      const commandRow = audit.find((entry) => entry.stateAfter && 'slug' in entry.stateAfter);
      expect(commandRow?.stateAfter).toMatchObject({ sourceProductId: source.id, contentAttributeCount: 1 });
    });

    it('a non-member is kept but not offered, and comes back with its membership (FR-061)', async () => {
      const product = await createLifecycleProduct();
      await put(product.id, 'pc_life', { languages: { 'en-US': tree('Kept aside') } });
      expect((await pdpContent(product.slug)).keys).toEqual(['pc_life']);

      await unassign();
      try {
        const one = await getOne(product.id, 'pc_life');
        expect(one.statusCode).toBe(404);
        expect(((await list(product.id)).json() as { data: ContentList }).data.attributes).toEqual([]);
        expect((await pdpContent(product.slug)).keys).toEqual([]);
        expect(await storedRows(product.id)).toHaveLength(1);
      } finally {
        await assign();
      }

      expect(((await getOne(product.id, 'pc_life')).json() as { data: ContentOne }).data.content).toEqual({
        languages: { 'en-US': tree('Kept aside') },
      });
      expect(((await list(product.id)).json() as { data: ContentList }).data.attributes.map((a) => a.key)).toEqual([
        'pc_life',
      ]);
      expect((await pdpContent(product.slug)).keys).toEqual(['pc_life']);
    });

    it('a soft-deleted product’s content is unreachable, and its rows remain (FR-062, OR-6)', async () => {
      const product = await createLifecycleProduct();
      await put(product.id, 'pc_life', { languages: { 'en-US': tree('Still stored') } });
      const deleted = await h.app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/catalog/products/${product.id}`,
        cookies: ADMIN,
      });
      expect(deleted.statusCode, deleted.body).toBeLessThan(300);

      for (const res of [await list(product.id), await getOne(product.id, 'pc_life'), await put(product.id, 'pc_life', null)]) {
        expect(res.statusCode).toBe(404);
        expect((res.json() as { error: { code: string } }).error.code).toBe('PRODUCT_NOT_FOUND');
      }
      expect((await pdpContent(product.slug)).status).toBe(404);
      expect(await storedRows(product.id)).toHaveLength(1);
    });
  });

  async function rowCount(productId: string): Promise<number> {
    const rows = await h
      .em()
      .getConnection()
      .execute<Array<{ n: number }>>(
        `select count(*)::int as n from product_content_values where product_id = ?`,
        [productId],
        'all',
      );
    return rows[0]!.n;
  }
});
