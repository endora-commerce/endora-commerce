import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';

/**
 * The blog URL prefix's write rule, driven through the Settings API the operator
 * uses (feature 171, FR-041, T011). Until feature 171 the rule was a static method
 * nothing called (research F1), so any string was accepted.
 *
 * A prefix is refused when it is malformed, a reserved storefront segment (the
 * blog's own list ∪ the deployment's `cms.reserved_slug_segments`), a language
 * prefix of any channel, or the first slug segment of a CMS page in the channel.
 */
describe('blog URL-prefix validation through the Settings API (feature 171, T011)', () => {
  let h: BackendServerHandle;
  const adminCookie = { b2b_session: 'stub-admin-session' };
  const run = `bp171-${randomUUID().slice(0, 8)}`;
  let channel: { id: string; code: string };
  let cmsPageId: string | null = null;

  async function settingsWrite(method: 'PUT' | 'DELETE', url: string, body?: unknown) {
    return h.app.inject({
      method,
      url,
      cookies: adminCookie,
      ...(body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, payload: JSON.stringify(body) }),
    });
  }

  const setPrefix = (value: unknown) =>
    settingsWrite('PUT', '/api/v1/admin/settings/blog.url_prefix/value', {
      scope: 'subset',
      salesChannelCodes: [channel.code],
      value,
    });

  async function setGlobal(code: string, value: unknown) {
    const res = await settingsWrite('PUT', `/api/v1/admin/settings/${code}/value`, { scope: 'all', value });
    expect(res.statusCode, res.body).toBe(200);
  }

  function codeOf(res: { json: () => unknown }): string | undefined {
    return (res.json() as { error?: { code?: string } }).error?.code;
  }

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
    const em = h.em();
    const created = em.create(SalesChannel, {
      code: `${run}-ch`,
      name: { 'pl-PL': 'Prefix validation' },
      languages: ['pl-PL', 'en-US'],
      defaultLanguage: 'pl-PL',
      currencies: ['PLN'],
      defaultCurrency: 'PLN',
      active: true,
      systemDefault: false,
      status: 'active',
      prefixDefaultLanguage: true,
    });
    await em.persistAndFlush(created);
    channel = { id: created.id, code: created.code };

    const page = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/cms/pages',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        name: 'O nas',
        slug: `${run}-o-nas`,
        active: true,
        description: null,
        salesChannelIds: [channel.id],
        languages: ['pl-PL'],
      }),
    });
    expect(page.statusCode, page.body).toBe(201);
    cmsPageId = (page.json() as { data: { id: string } }).data.id;
  });

  afterAll(async () => {
    await settingsWrite('DELETE', `/api/v1/admin/settings/blog.url_prefix/values?salesChannelCodes=${channel.code}`);
    const connection = h.em().getConnection();
    if (cmsPageId) {
      await connection.execute('delete from cms_page_sales_channels where page_id = ?', [cmsPageId]);
      await connection.execute('delete from cms_pages where id = ?', [cmsPageId]);
    }
    await connection.execute('delete from blog_url_prefixes where sales_channel_id = ?', [channel.id]);
    await connection.execute('delete from sales_channels where id = ?', [channel.id]);
    await teardownBackendServer(h);
  });

  it('accepts a well-formed free prefix, and `blog` itself', async () => {
    for (const value of ['aktualnosci', 'news-2026', 'blog']) {
      const res = await setPrefix(value);
      expect(res.statusCode, `${value}: ${res.body}`).toBe(200);
    }
  });

  it('refuses a malformed prefix with 400 BLOG_URL_PREFIX_INVALID', async () => {
    for (const value of ['Blog', 'news/posts', 'has space', '-leading', 'trailing-', '']) {
      const res = await setPrefix(value);
      expect(res.statusCode, `${JSON.stringify(value)}: ${res.body}`).toBe(400);
      expect(codeOf(res)).toBe('BLOG_URL_PREFIX_INVALID');
    }
  });

  it('refuses a reserved segment with 409 BLOG_URL_PREFIX_RESERVED — the blog’s own and the deployment’s', async () => {
    await setGlobal('cms.reserved_slug_segments', ['cart', 'p']);
    try {
      for (const value of ['api', 'tag', 'author', 'cart', 'p']) {
        const res = await setPrefix(value);
        expect(res.statusCode, `${value}: ${res.body}`).toBe(409);
        expect(codeOf(res)).toBe('BLOG_URL_PREFIX_RESERVED');
      }
    } finally {
      await setGlobal('cms.reserved_slug_segments', []);
    }
  });

  it('refuses a language prefix of any channel with 409 BLOG_URL_PREFIX_CONFLICT', async () => {
    for (const value of ['pl', 'en']) {
      const res = await setPrefix(value);
      expect(res.statusCode, `${value}: ${res.body}`).toBe(409);
      expect(codeOf(res)).toBe('BLOG_URL_PREFIX_CONFLICT');
    }
  });

  it('refuses the first slug segment of a CMS page in the channel with 409 BLOG_URL_PREFIX_CONFLICT', async () => {
    const res = await setPrefix(`${run}-o-nas`);
    expect(res.statusCode, res.body).toBe(409);
    expect(codeOf(res)).toBe('BLOG_URL_PREFIX_CONFLICT');
  });

  // ── Feature 171 (US5) — a prefix per language ─────────────────────

  const setByLanguage = (value: unknown) =>
    settingsWrite('PUT', '/api/v1/admin/settings/blog.url_prefix_by_language/value', {
      scope: 'subset',
      salesChannelCodes: [channel.code],
      value,
    });

  it('accepts a prefix per language of the channel', async () => {
    const res = await setByLanguage({ 'pl-PL': 'aktualnosci', 'en-US': 'news' });
    expect(res.statusCode, res.body).toBe(200);
    await settingsWrite('DELETE', `/api/v1/admin/settings/blog.url_prefix_by_language/values?salesChannelCodes=${channel.code}`);
  });

  it('refuses a map that is not one, a language the channel lacks, and a refused prefix', async () => {
    for (const [value, status, code] of [
      [['news'], 400, 'BLOG_URL_PREFIX_INVALID'],
      [{ 'de-DE': 'nachrichten' }, 400, 'BLOG_URL_PREFIX_INVALID'],
      [{ 'en-US': 'News' }, 400, 'BLOG_URL_PREFIX_INVALID'],
      [{ 'en-US': 'tag' }, 409, 'BLOG_URL_PREFIX_RESERVED'],
      [{ 'en-US': 'pl' }, 409, 'BLOG_URL_PREFIX_CONFLICT'],
      [{ 'en-US': `${run}-o-nas` }, 409, 'BLOG_URL_PREFIX_CONFLICT'],
    ] as const) {
      const res = await setByLanguage(value);
      expect(res.statusCode, `${JSON.stringify(value)}: ${res.body}`).toBe(status);
      expect(codeOf(res)).toBe(code);
    }
  });
});
