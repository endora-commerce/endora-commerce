import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';

/**
 * Issue #1011 — the three CMS storefront lookups (page by slug, block by code, hook by code)
 * read their language from the whole `Accept-Language` header through `requestScopeLanguage`:
 * q-weighted, each tag matched against the channel's languages (exact, then base language),
 * else the channel's default. Before, they took the header's first entry with its `;q=`
 * parameter, so `en;q=0.2, pl-PL;q=0.9` was answered in English and `pl` matched nothing.
 *
 * The run's own channel offers `en-US` (default) and `pl-PL`; its page, block and hook carry
 * content in both. An explicit `?language=` still wins over the header.
 */
describe('CMS storefront language from Accept-Language (issue #1011)', () => {
  let h: BackendServerHandle;
  const run = randomUUID().slice(0, 8);
  const adminCookie = { b2b_session: 'stub-admin-session' };
  const slug = `al1011-${run}`;
  const blockCode = `al1011-block-${run}`;
  const hookCode = `storefront.al1011.${run}`;
  let channel: SalesChannel;
  let pageId: string;
  let blockId: string;
  let hookId: string;

  const tree = (text: string) => ({
    root: { props: {} },
    content: [{ type: 'cms.Heading', props: { level: 'h2', text } }],
  });

  async function admin(method: 'POST' | 'PUT', url: string, payload: unknown): Promise<{ id: string; version: number }> {
    const res = await h.app.inject({
      method,
      url,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify(payload),
    });
    expect(res.statusCode, res.body).toBeLessThan(300);
    return (res.json() as { data: { id: string; version: number } }).data;
  }

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
    const em = h.em();
    channel = em.create(SalesChannel, {
      code: `al1011-${run}`,
      name: { 'en-US': `CMS Accept-Language ${run}` },
      languages: ['en-US', 'pl-PL'],
      defaultLanguage: 'en-US',
      currencies: ['PLN'],
      defaultCurrency: 'PLN',
      active: true,
      systemDefault: false,
      status: 'active',
    });
    await em.persistAndFlush(channel);

    const page = await admin('POST', '/api/v1/admin/cms/pages', {
      name: `Accept-Language page ${run}`,
      slug,
      active: true,
      salesChannelIds: [channel.id],
      languages: ['en-US', 'pl-PL'],
    });
    pageId = page.id;
    let version = page.version;
    for (const [language, text] of [['en-US', 'English page'], ['pl-PL', 'Polska strona']] as const) {
      version = (await admin('PUT', `/api/v1/admin/cms/pages/${pageId}/content/${language}`, { data: tree(text), version }))
        .version;
    }
    await admin('POST', `/api/v1/admin/cms/pages/${pageId}/publish`, {});

    const block = await admin('POST', '/api/v1/admin/cms/blocks', {
      name: `Accept-Language block ${run}`,
      code: blockCode,
      active: true,
      salesChannelIds: [channel.id],
      languages: ['en-US', 'pl-PL'],
    });
    blockId = block.id;
    version = block.version;
    for (const [language, text] of [['en-US', 'English block'], ['pl-PL', 'Polski blok']] as const) {
      version = (await admin('PUT', `/api/v1/admin/cms/blocks/${blockId}/content/${language}`, { data: tree(text), version }))
        .version;
    }

    hookId = (
      await admin('POST', '/api/v1/admin/cms/hooks', {
        name: `Accept-Language hook ${run}`,
        code: hookCode,
        active: true,
        salesChannelIds: [channel.id],
      })
    ).id;
    await admin('POST', `/api/v1/admin/cms/hooks/${hookId}/attachments`, { blockId, position: 0 });
  });

  afterAll(async () => {
    if (h) {
      const connection = h.em().getConnection();
      if (hookId) await connection.execute(`delete from cms_hooks where id = ?`, [hookId]);
      if (blockId) await connection.execute(`delete from cms_blocks where id = ?`, [blockId]);
      if (pageId) await connection.execute(`delete from cms_pages where id = ?`, [pageId]);
      if (channel) await connection.execute(`delete from sales_channels where id = ?`, [channel.id]);
      await teardownBackendServer(h);
    }
  });

  const lookups = {
    page: { url: () => `/api/v1/cms/pages/by-slug?slug=${encodeURIComponent(slug)}`, language: (d: Data) => d.language },
    block: { url: () => `/api/v1/cms/blocks/by-code?code=${encodeURIComponent(blockCode)}`, language: (d: Data) => d.language },
    hook: {
      url: () => `/api/v1/cms/hooks/by-code?code=${encodeURIComponent(hookCode)}`,
      language: (d: Data) => d.blocks?.find((b) => b.id === blockId)?.language,
    },
  } as const;
  type Data = { language?: string; blocks?: Array<{ id: string; language: string }> };

  async function languageOf(lookup: keyof typeof lookups, acceptLanguage: string, query = ''): Promise<string | undefined> {
    const res = await h.app.inject({
      method: 'GET',
      url: `${lookups[lookup].url()}${query}`,
      headers: { 'x-sales-channel': channel.code, 'accept-language': acceptLanguage },
    });
    expect(res.statusCode, res.body).toBe(200);
    return lookups[lookup].language((res.json() as { data: Data }).data);
  }

  describe.each(['page', 'block', 'hook'] as const)('the %s lookup', (lookup) => {
    it('honours the q-weights: `en;q=0.2, pl-PL;q=0.9` is Polish', async () => {
      expect(await languageOf(lookup, 'en;q=0.2, pl-PL;q=0.9')).toBe('pl-PL');
    });

    it('matches a language-only tag to the channel language: `pl` is `pl-PL`', async () => {
      expect(await languageOf(lookup, 'pl')).toBe('pl-PL');
    });

    it('skips an unoffered tag for the next offered one', async () => {
      expect(await languageOf(lookup, 'de-DE, pl;q=0.5')).toBe('pl-PL');
    });

    it('answers a language the channel does not offer in the channel default', async () => {
      expect(await languageOf(lookup, 'de-DE')).toBe('en-US');
    });

    it('keeps an explicit `?language=` ahead of the header', async () => {
      expect(await languageOf(lookup, 'pl-PL', '&language=en-US')).toBe('en-US');
    });
  });
});
