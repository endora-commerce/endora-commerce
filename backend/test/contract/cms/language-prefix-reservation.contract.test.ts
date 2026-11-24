import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';

/**
 * Feature 167 (US7, FR-040, OR-5, OR-12) — a CMS page slug whose first segment is a
 * language prefix (or split alias) of **any** sales channel is refused with the
 * existing `409 CMS_SLUG_RESERVED`, naming the segment; a prefix of a language no
 * channel serves is an ordinary segment and saves.
 */
describe('CMS slugs never collide with a language prefix', () => {
  let h: BackendServerHandle;
  let channelId: string;
  const adminCookie = { b2b_session: 'stub-admin-session' };
  const code = `lp167-${Date.now()}`;

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
    const em = h.em();
    const channel = em.create(SalesChannel, {
      code,
      name: { 'pl-PL': 'Prefix reservation' },
      languages: ['pl-PL', 'en-US', 'en-GB'],
      defaultLanguage: 'pl-PL',
      currencies: ['PLN'],
      defaultCurrency: 'PLN',
    });
    await em.persist(channel).flush();
    channelId = channel.id;
    await h.salesChannels.cache.invalidateAll();
  });

  afterAll(async () => {
    await h.em().getConnection().execute(`delete from cms_page_sales_channels where sales_channel_id = ?`, [channelId]);
    await h.em().getConnection().execute(`delete from sales_channels where id = ?`, [channelId]);
    await teardownBackendServer(h);
  });

  function createPage(slug: string) {
    return h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/cms/pages',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        name: `Prefix ${slug}`,
        slug,
        active: true,
        description: null,
        salesChannelIds: [channelId],
        languages: ['pl-PL'],
      }),
    });
  }

  it.each([
    ['pl', 'pl'],
    ['pl/o-nas', 'pl'],
    ['en-gb/x', 'en-gb'],
    ['en-us', 'en-us'],
    // `en` is the split alias of en-US and en-GB: it answers a redirect, so it is reserved too.
    ['en/o-nas', 'en'],
  ])('refuses %s, naming %s', async (slug, segment) => {
    const res = await createPage(slug);
    expect(res.statusCode).toBe(409);
    const body = res.json() as { error: { code: string; details?: { segment?: string } } };
    expect(body.error.code).toBe(ERROR_CODES.CMS_SLUG_RESERVED);
    expect(JSON.stringify(body.error)).toContain(segment);
  });

  // 163 R24 — a page's per-language slugs are addresses too: each is reserved alike.
  it('refuses a per-language slug that starts with a channel prefix (R24)', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/cms/pages',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        name: 'Prefix translation',
        slug: `ok-${Date.now()}`,
        active: true,
        description: null,
        salesChannelIds: [channelId],
        languages: ['pl-PL', 'en-US'],
        translations: { 'en-US': { slug: 'en-gb/about' } },
      }),
    });
    expect(res.statusCode).toBe(409);
    expect(JSON.stringify(res.json())).toContain('en-gb');
  });

  it('accepts a prefix of a language no channel serves (OR-12)', async () => {
    const res = await createPage(`xq/o-nas-${Date.now()}`);
    expect(res.statusCode).toBe(201);
  });

  // FR-041 — a page that predates the language (slug `de` before German joined a
  // channel) is not refused retroactively; the admin list marks it as shadowed.
  it('marks a page whose first segment became a channel prefix, and only that page', async () => {
    const shadowed = await createPage('de');
    expect(shadowed.statusCode).toBe(201);
    const plain = await createPage(`plain-${Date.now()}`);
    expect(plain.statusCode).toBe(201);
    // R24: a per-language slug can be the one the prefix hides.
    const translated = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/cms/pages',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        name: 'Translated',
        slug: `translated-${Date.now()}`,
        active: true,
        description: null,
        salesChannelIds: [channelId],
        languages: ['pl-PL', 'en-US'],
        translations: { 'en-US': { slug: 'de/translated' } },
      }),
    });
    expect(translated.statusCode, translated.body).toBe(201);
    // German joins the channel after the page was saved.
    await h.em().getConnection().execute(
      `update sales_channels set languages = '["pl-PL","en-US","en-GB","de-DE"]'::jsonb where id = ?`,
      [channelId],
    );
    await h.salesChannels.cache.invalidateAll();

    const list = await h.app.inject({ method: 'GET', url: '/api/v1/admin/cms/pages', cookies: adminCookie });
    expect(list.statusCode).toBe(200);
    const pages = (list.json() as { data: Array<{ slug: string; shadowedByLanguagePrefix?: { prefix: string; channelCodes: string[] } }> }).data;
    expect(pages.find((p) => p.slug === 'de')?.shadowedByLanguagePrefix).toEqual({ prefix: 'de', channelCodes: [code] });
    expect(pages.find((p) => p.slug.startsWith('plain-'))?.shadowedByLanguagePrefix).toBeUndefined();
    expect(pages.find((p) => p.slug.startsWith('translated-'))?.shadowedByLanguagePrefix?.prefix).toBe('de');
  });
});
