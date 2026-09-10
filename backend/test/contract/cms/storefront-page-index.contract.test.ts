import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cmsPageIndexResponseSchema } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';

/**
 * `GET /api/v1/cms/pages/by-channel` — the listing a sitemap is built from
 * (`specs/105-cms-root-page-urls/` FR-021; `contracts/cms-page-url.md` §4.1).
 *
 * The invariant every case here defends is one sentence: **a page this endpoint
 * names is a page `by-slug` serves**. A sitemap is a promise to a crawler, and a
 * URL in it that answers 404 costs crawl budget and is a quality signal in its
 * own right — so the three conditions `by-slug` applies (the channel binding,
 * `published`, `active`) are asserted here one at a time rather than trusted to
 * have been copied correctly.
 */
type SeedPageOptions = {
  slug: string;
  channelId: string;
  status?: 'draft' | 'published' | 'archived';
  active?: boolean;
  /** The slug this *channel* serves the page under, when it differs from the row's. */
  channelSlug?: string;
};

describe('storefront CMS page index contract (feature 105, FR-021)', () => {
  let h: BackendServerHandle;
  let defaultChannel: SalesChannel;
  let otherChannel: SalesChannel;

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
    defaultChannel = await h.em().findOneOrFail(SalesChannel, { systemDefault: true });
    otherChannel = h.em().create(SalesChannel, {
      code: `cms-index-other-${Date.now()}`,
      name: { 'en-US': 'CMS index other' },
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
        JSON.stringify({ 'en-US': '' }),
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
        JSON.stringify({ languages: { 'en-US': { root: { props: {} }, content: [] } } }),
        JSON.stringify(['en-US']),
      ],
    );
    await h.em().getConnection().execute(
      `insert into cms_page_sales_channels (page_id, sales_channel_id, slug)
       values (?, ?, ?)`,
      [id, options.channelId, options.channelSlug ?? options.slug],
    );
    return id;
  }

  async function index(channelCode = defaultChannel.code) {
    return h.app.inject({
      method: 'GET',
      url: '/api/v1/cms/pages/by-channel',
      headers: { 'x-sales-channel': channelCode },
    });
  }

  async function slugsOn(channelCode: string): Promise<string[]> {
    const res = await index(channelCode);
    expect(res.statusCode).toBe(200);
    const parsed = cmsPageIndexResponseSchema.parse(res.json().data);
    return parsed.pages.map((page) => page.slug);
  }

  it('answers the declared shape, with an ISO timestamp per page', async () => {
    const slug = `index-shape-${Date.now()}`;
    await seedPage({ slug, channelId: defaultChannel.id });

    const res = await index();

    expect(res.statusCode).toBe(200);
    // Parsed rather than shape-matched: `updatedAt` is the field a sitemap's
    // `lastModified` is built from, and a `Date` that serialised to anything
    // else would be silently dropped by every consumer.
    const parsed = cmsPageIndexResponseSchema.parse(res.json().data);
    const entry = parsed.pages.find((page) => page.slug === slug);
    expect(entry).toBeDefined();
    expect(Number.isNaN(Date.parse(entry?.updatedAt ?? ''))).toBe(false);
  });

  it('names only pages of the requested channel', async () => {
    const mine = `index-mine-${Date.now()}`;
    const theirs = `index-theirs-${Date.now()}`;
    await seedPage({ slug: mine, channelId: defaultChannel.id });
    await seedPage({ slug: theirs, channelId: otherChannel.id });

    expect(await slugsOn(defaultChannel.code)).toContain(mine);
    expect(await slugsOn(defaultChannel.code)).not.toContain(theirs);
    expect(await slugsOn(otherChannel.code)).toContain(theirs);
  });

  it('names no draft and no archived page', async () => {
    const draft = `index-draft-${Date.now()}`;
    const archived = `index-archived-${Date.now()}`;
    await seedPage({ slug: draft, channelId: defaultChannel.id, status: 'draft' });
    await seedPage({ slug: archived, channelId: defaultChannel.id, status: 'archived' });

    const slugs = await slugsOn(defaultChannel.code);
    expect(slugs).not.toContain(draft);
    expect(slugs).not.toContain(archived);
  });

  it('names no inactive page', async () => {
    const inactive = `index-inactive-${Date.now()}`;
    await seedPage({ slug: inactive, channelId: defaultChannel.id, active: false });

    expect(await slugsOn(defaultChannel.code)).not.toContain(inactive);
  });

  it('names the slug this channel serves, not the page row\'s own', async () => {
    // The address is per channel (Constitution XII) and `cms_pages.slug` is one
    // value for every channel a page is published to. A listing built off the
    // page row would advertise a URL this channel answers 404 for.
    const rowSlug = `index-row-${Date.now()}`;
    const channelSlug = `index-channel-${Date.now()}`;
    await seedPage({ slug: rowSlug, channelId: defaultChannel.id, channelSlug });

    const slugs = await slugsOn(defaultChannel.code);
    expect(slugs).toContain(channelSlug);
    expect(slugs).not.toContain(rowSlug);
  });

  it('serves every slug it advertises', async () => {
    // The two endpoints as one claim, which is what the sitemap is promising.
    const slug = `index-served-${Date.now()}`;
    await seedPage({ slug, channelId: defaultChannel.id });

    for (const advertised of await slugsOn(defaultChannel.code)) {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/cms/pages/by-slug?slug=${encodeURIComponent(advertised)}&language=en-US`,
        headers: { 'x-sales-channel': defaultChannel.code, 'accept-language': 'en-US' },
      });
      expect([advertised, res.statusCode]).toEqual([advertised, 200]);
    }
  });
});
