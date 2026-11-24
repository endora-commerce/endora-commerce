import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel, resolvePublicApiBaseUrl } from '@endora-commerce/platform/kernel';

type SeedPageOptions = {
  slug: string;
  channelId: string;
  status?: 'draft' | 'published' | 'archived';
  active?: boolean;
  languages?: string[];
  contentLanguage?: string;
  /** Every language the content carries a tree for; defaults to `[contentLanguage]`. */
  contentLanguages?: string[];
  shareImageAssetId?: string | null;
};

describe('storefront CMS page-by-slug contract (T037)', () => {
  let h: BackendServerHandle;
  let defaultChannel: SalesChannel;
  let otherChannel: SalesChannel;

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
    defaultChannel = await h.em().findOneOrFail(SalesChannel, { systemDefault: true });
    otherChannel = h.em().create(SalesChannel, {
      code: `cms-other-${Date.now()}`,
      name: { 'en-US': 'CMS other' },
      languages: ['en-US'],
      defaultLanguage: 'en-US',
      currencies: ['PLN'],
      defaultCurrency: 'PLN',
      active: true,
      systemDefault: false,
      status: 'active',
    });
    await h.em().persist(otherChannel).flush();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function seedPage(options: SeedPageOptions): Promise<string> {
    const id = randomUUID();
    const now = new Date();
    const status = options.status ?? 'published';
    const active = options.active ?? true;
    const languages = options.languages ?? ['en-US'];
    const contentLanguage = options.contentLanguage ?? languages[0] ?? 'en-US';
    const contentLanguages = options.contentLanguages ?? [contentLanguage];
    const data = {
      root: { props: {} },
      content: [
        {
          type: 'cms.Heading',
          props: { level: 'h1', text: `Heading ${options.slug}` },
        },
      ],
    };

    await h.em().getConnection().execute(
      `insert into cms_pages
        (id, path, status, title, body, published_at, archived_at, created_at, updated_at,
         name, slug, active, description, meta_title, meta_description, meta_keywords,
         content, languages, version, share_image_asset_id)
       values (?, ?, ?, ?::jsonb, ?::jsonb, ?, ?, ?, ?, ?, ?, ?, null,
         ?::jsonb, ?::jsonb, ?::jsonb, ?::jsonb, ?::jsonb, 1, ?)`,
      [
        id,
        `${options.slug}-${id.slice(0, 8)}`,
        status,
        JSON.stringify({ 'en-US': `Title ${options.slug}` }),
        JSON.stringify({ 'en-US': '<p>Legacy body</p>' }),
        status === 'published' ? now : null,
        status === 'archived' ? now : null,
        now,
        now,
        `Page ${options.slug}`,
        options.slug,
        active,
        JSON.stringify({ 'en-US': `Meta ${options.slug}` }),
        JSON.stringify({ 'en-US': `Description ${options.slug}` }),
        JSON.stringify({ 'en-US': 'cms,storefront' }),
        JSON.stringify({
          schema_version: 1,
          languages: Object.fromEntries(contentLanguages.map((language) => [language, data])),
        }),
        JSON.stringify(languages),
        options.shareImageAssetId ?? null,
      ],
    );
    await h.em().getConnection().execute(
      `insert into cms_page_sales_channels (page_id, sales_channel_id, slug)
       values (?, ?, ?)`,
      [id, options.channelId, options.slug],
    );

    return id;
  }

  async function getBySlug(slug: string, channelCode = defaultChannel.code, language = 'en-US') {
    return h.app.inject({
      method: 'GET',
      url: `/api/v1/cms/pages/by-slug?slug=${encodeURIComponent(slug)}&language=${encodeURIComponent(language)}`,
      headers: {
        'x-sales-channel': channelCode,
        'accept-language': language,
      },
    });
  }

  it('returns a published active page matched by sales channel and slug', async () => {
    const slug = `published-${Date.now()}`;
    const id = await seedPage({ slug, channelId: defaultChannel.id });

    const res = await getBySlug(slug);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      data: {
        id,
        slug,
        name: `Page ${slug}`,
        language: 'en-US',
        meta: {
          title: `Meta ${slug}`,
          description: `Description ${slug}`,
          keywords: 'cms,storefront',
        },
        content: {
          data: expect.anything(),
        },
        embeds: { blocks: {}, templates: {} },
        assets: {},
        // Feature 163 (T080): a page with no parent and untouched settings
        // answers today's look — shown, light, an empty trail.
        breadcrumbs: { visible: true, scheme: 'light', trail: [] },
      },
    });
  });

  it('returns CMS_PAGE_NOT_FOUND for archived pages', async () => {
    const slug = `archived-${Date.now()}`;
    await seedPage({ slug, channelId: defaultChannel.id, status: 'archived' });

    const res = await getBySlug(slug);

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: ERROR_CODES.CMS_PAGE_NOT_FOUND } });
  });

  it('returns CMS_PAGE_NOT_FOUND for inactive pages', async () => {
    const slug = `inactive-${Date.now()}`;
    await seedPage({ slug, channelId: defaultChannel.id, active: false });

    const res = await getBySlug(slug);

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: ERROR_CODES.CMS_PAGE_NOT_FOUND } });
  });

  it('returns CMS_PAGE_NOT_FOUND when the slug belongs to a different sales channel', async () => {
    const slug = `other-channel-${Date.now()}`;
    await seedPage({ slug, channelId: otherChannel.id });

    const res = await getBySlug(slug, defaultChannel.code);

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: ERROR_CODES.CMS_PAGE_NOT_FOUND } });
  });

  it('falls back to the channel default language when the requested language is unavailable', async () => {
    const slug = `fallback-${Date.now()}`;
    await seedPage({
      slug,
      channelId: defaultChannel.id,
      languages: ['en-US'],
      contentLanguage: 'en-US',
    });

    const res = await getBySlug(slug, defaultChannel.code, 'pl-PL');

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      data: {
        slug,
        language: defaultChannel.defaultLanguage,
      },
    });
  });

  /**
   * Feature 163 (T083; spec US9, FR-033–FR-034; data-model §5): the sharing
   * image is the page's own, else `cms.default_share_image_asset_id` read for
   * the request's channel (Principle XII), else `null`; `languages` lists the
   * languages the page can be served in, for `og:locale:alternate`.
   */
  describe('sharing metadata (feature 163)', () => {
    const SETTING = 'cms.default_share_image_asset_id';
    const adminCookie = { b2b_session: 'stub-admin-session' };
    let storedBefore: { globalValue: unknown; values: unknown[] } | null = null;
    const createdPageIds: string[] = [];
    const createdAssetIds: string[] = [];

    beforeAll(async () => {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/admin/settings/${SETTING}`,
        cookies: adminCookie,
      });
      // Read first, write back in `afterAll` (standing rule 5). A 404 here is
      // the RED state: the setting is not declared yet.
      if (res.statusCode === 200) {
        const dto = res.json() as { globalValue: unknown; values?: unknown[] };
        storedBefore = { globalValue: dto.globalValue ?? null, values: dto.values ?? [] };
      }
    });

    afterAll(async () => {
      const connection = h.em().getConnection();
      for (const id of createdPageIds) {
        await connection.execute('delete from cms_page_sales_channels where page_id = ?', [id]);
        await connection.execute('delete from cms_pages where id = ?', [id]);
      }
      for (const id of createdAssetIds) await connection.execute('delete from assets where id = ?', [id]);
      if (!storedBefore) return;
      if (storedBefore.globalValue === null && storedBefore.values.length === 0) {
        await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/settings/${SETTING}/values`, cookies: adminCookie });
      } else {
        await h.app.inject({
          method: 'PUT',
          url: `/api/v1/admin/settings/${SETTING}/value`,
          cookies: adminCookie,
          payload: { scope: 'all', value: storedBefore.globalValue ?? '' },
        });
      }
    });

    async function seedAsset(): Promise<{ id: string; url: string }> {
      const id = randomUUID();
      await h.em().getConnection().execute(
        `insert into assets (id, kind, filename, mime_type, size_bytes, storage_url,
           label, visibility, created_at, updated_at)
         values (?, 'image', 'share.png', 'image/png', 2048, ?, 'Share image', 'public', now(), now())`,
        [id, `https://example.test/${id}.png`],
      );
      createdAssetIds.push(id);
      const [row] = await h
        .em()
        .getConnection()
        .execute<Array<{ content_version: string }>>('select content_version from assets where id = ?', [id]);
      return { id, url: `${resolvePublicApiBaseUrl()}/assets/file/${id}?v=${row!.content_version}` };
    }

    async function seedTracked(options: SeedPageOptions): Promise<string> {
      const id = await seedPage(options);
      createdPageIds.push(id);
      return id;
    }

    async function setDefault(payload: Record<string, unknown>): Promise<void> {
      const res = await h.app.inject({
        method: 'PUT',
        url: `/api/v1/admin/settings/${SETTING}/value`,
        cookies: adminCookie,
        payload,
      });
      expect(res.statusCode, res.body).toBe(200);
    }

    const tag = (): string => `pb163_${randomUUID().slice(0, 8)}`;

    it('uses the page image when the page has one', async () => {
      const own = await seedAsset();
      const fallback = await seedAsset();
      await setDefault({ scope: 'all', value: fallback.id });
      const slug = tag();
      await seedTracked({ slug, channelId: defaultChannel.id, shareImageAssetId: own.id });

      const res = await getBySlug(slug);

      expect(res.statusCode).toBe(200);
      expect(res.json().data.share).toEqual({ imageUrl: own.url });
    });

    it("falls back to the default sharing image of the request's channel", async () => {
      const globalDefault = await seedAsset();
      const otherDefault = await seedAsset();
      await setDefault({ scope: 'all', value: globalDefault.id });
      const slug = tag();
      await seedTracked({ slug, channelId: defaultChannel.id });

      const res = await getBySlug(slug);
      expect(res.statusCode).toBe(200);
      expect(res.json().data.share).toEqual({ imageUrl: globalDefault.url });

      // Principle XII: the other channel's own value answers for that channel only.
      await setDefault({ scope: 'subset', salesChannelCodes: [otherChannel.code], value: otherDefault.id });
      const otherSlug = tag();
      await seedTracked({ slug: otherSlug, channelId: otherChannel.id });
      const other = await getBySlug(otherSlug, otherChannel.code);
      expect(other.statusCode).toBe(200);
      expect(other.json().data.share).toEqual({ imageUrl: otherDefault.url });
      const again = await getBySlug(slug);
      expect(again.json().data.share).toEqual({ imageUrl: globalDefault.url });
      await h.app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/settings/${SETTING}/values?salesChannelCodes=${otherChannel.code}`,
        cookies: adminCookie,
      });
    });

    it('is null without a page image and without a default', async () => {
      await setDefault({ scope: 'all', value: '' });
      const slug = tag();
      await seedTracked({ slug, channelId: defaultChannel.id });

      const res = await getBySlug(slug);

      expect(res.statusCode).toBe(200);
      expect(res.json().data.share).toEqual({ imageUrl: null });
    });

    it("refuses to delete an asset a page uses as its sharing image (the cms asset-reference scan)", async () => {
      const own = await seedAsset();
      await seedTracked({ slug: tag(), channelId: defaultChannel.id, shareImageAssetId: own.id });

      const del = await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/assets/${own.id}`, cookies: adminCookie });

      expect(del.statusCode).toBe(409);
      expect(del.json()).toMatchObject({ error: { code: 'ASSET_REFERENCED' } });
    });

    it("lists the page's languages", async () => {
      const slug = tag();
      await seedTracked({
        slug,
        channelId: defaultChannel.id,
        languages: ['en-US', 'pl-PL'],
        contentLanguages: ['en-US', 'pl-PL'],
      });

      const res = await getBySlug(slug);

      expect(res.statusCode).toBe(200);
      expect(res.json().data.language).toBe('en-US');
      expect([...(res.json().data.languages as string[])].sort()).toEqual(['en-US', 'pl-PL']);
    });
  });
});
