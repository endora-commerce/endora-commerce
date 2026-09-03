import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';

type SeedPageOptions = {
  slug: string;
  channelId: string;
  status?: 'draft' | 'published' | 'archived';
  active?: boolean;
  languages?: string[];
  contentLanguage?: string;
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
      isPublic: true,
      status: 'active',
    });
    await h.em().persistAndFlush(otherChannel);
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
         content, languages, version)
       values (?, ?, ?, ?::jsonb, ?::jsonb, ?, ?, ?, ?, ?, ?, ?, null,
         ?::jsonb, ?::jsonb, ?::jsonb, ?::jsonb, ?::jsonb, 1)`,
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
        JSON.stringify({ schema_version: 1, languages: { [contentLanguage]: data } }),
        JSON.stringify(languages),
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
});
