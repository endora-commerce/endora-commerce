import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { blogRoutingResponseSchema } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { withModuleOff } from '../../helpers/off-state.js';

/**
 * `GET /api/v1/blog/routing` (feature 171, FR-001/FR-003, T013) — what the storefront
 * middleware maps the public blog prefix with: the channel's default prefix, the
 * effective prefix per channel language, and the former prefixes that redirect (only
 * while `seo` is present, research R7). It answers one channel — the resolved one
 * (Constitution XII).
 */
describe('storefront blog routing contract (feature 171, T013)', () => {
  let h: BackendServerHandle;
  const adminCookie = { b2b_session: 'stub-admin-session' };
  const run = `br171-${randomUUID().slice(0, 8)}`;
  let channel: { id: string; code: string };
  let other: { id: string; code: string };

  async function createChannel(suffix: string) {
    const em = h.em();
    const created = em.create(SalesChannel, {
      code: `${run}-${suffix}`,
      name: { 'pl-PL': `Routing ${suffix}` },
      languages: ['pl-PL', 'en-US'],
      defaultLanguage: 'pl-PL',
      currencies: ['PLN'],
      defaultCurrency: 'PLN',
      active: true,
      systemDefault: false,
      status: 'active',
    });
    await em.persistAndFlush(created);
    return { id: created.id, code: created.code };
  }

  async function setPrefix(channelCode: string, value: string) {
    const res = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/blog.url_prefix/value',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ scope: 'subset', salesChannelCodes: [channelCode], value }),
    });
    expect(res.statusCode, res.body).toBe(200);
  }

  async function routing(channelCode: string) {
    return h.app.inject({ method: 'GET', url: '/api/v1/blog/routing', headers: { 'x-sales-channel': channelCode } });
  }

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
    channel = await createChannel('a');
    other = await createChannel('b');
  });

  afterAll(async () => {
    for (const c of [channel, other]) {
      for (const code of ['blog.url_prefix', 'blog.enabled']) {
        await h.app.inject({
          method: 'DELETE',
          url: `/api/v1/admin/settings/${code}/values?salesChannelCodes=${c.code}`,
          cookies: adminCookie,
        });
      }
      await h.em().getConnection().execute('delete from blog_url_prefixes where sales_channel_id = ?', [c.id]);
      await h.em().getConnection().execute('delete from sales_channels where id = ?', [c.id]);
    }
    await teardownBackendServer(h);
  });

  it('answers the default prefix for every language of a channel never configured', async () => {
    const res = await routing(other.code);
    expect(res.statusCode, res.body).toBe(200);
    expect(blogRoutingResponseSchema.parse(res.json()).data).toEqual({
      defaultPrefix: 'blog',
      prefixes: { 'pl-PL': 'blog', 'en-US': 'blog' },
      formerPrefixes: [],
    });
  });

  it('answers the channel’s prefix and its former prefixes, and only that channel’s', async () => {
    await setPrefix(channel.code, 'aktualnosci');
    await setPrefix(channel.code, 'wiadomosci');
    const res = await routing(channel.code);
    expect(res.statusCode, res.body).toBe(200);
    expect(blogRoutingResponseSchema.parse(res.json()).data).toEqual({
      defaultPrefix: 'wiadomosci',
      prefixes: { 'pl-PL': 'wiadomosci', 'en-US': 'wiadomosci' },
      formerPrefixes: [{ languageCode: null, prefix: 'aktualnosci' }],
    });
    // The other channel is untouched.
    expect(blogRoutingResponseSchema.parse((await routing(other.code)).json()).data.defaultPrefix).toBe('blog');
  });

  it('lists no former prefix while seo is off: a former address then answers as an unknown one', async () => {
    await withModuleOff('seo', 'deactivated', async () => {
      const res = await routing(channel.code);
      expect(res.statusCode, res.body).toBe(200);
      expect(blogRoutingResponseSchema.parse(res.json()).data.formerPrefixes).toEqual([]);
    });
  });

  it('answers 404 BLOG_DISABLED when the blog is disabled in the channel', async () => {
    const res = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/blog.enabled/value',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ scope: 'subset', salesChannelCodes: [other.code], value: false }),
    });
    expect(res.statusCode, res.body).toBe(200);
    const answer = await routing(other.code);
    expect(answer.statusCode, answer.body).toBe(404);
    expect((answer.json() as { error: { code: string } }).error.code).toBe('BLOG_DISABLED');
  });

  it('answers a prefix per language, and the language’s former own prefix', async () => {
    const write = (value: unknown) =>
      h.app.inject({
        method: 'PUT',
        url: '/api/v1/admin/settings/blog.url_prefix_by_language/value',
        headers: { 'content-type': 'application/json' },
        cookies: adminCookie,
        payload: JSON.stringify({ scope: 'subset', salesChannelCodes: [channel.code], value }),
      });
    expect((await write({ 'en-US': 'news' })).statusCode).toBe(200);
    expect((await write({ 'en-US': 'stories' })).statusCode).toBe(200);
    try {
      const res = await routing(channel.code);
      const data = blogRoutingResponseSchema.parse(res.json()).data;
      expect(data.prefixes).toEqual({ 'pl-PL': data.defaultPrefix, 'en-US': 'stories' });
      expect(data.formerPrefixes).toContainEqual({ languageCode: 'en-US', prefix: 'news' });
    } finally {
      await h.app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/settings/blog.url_prefix_by_language/values?salesChannelCodes=${channel.code}`,
        cookies: adminCookie,
      });
    }
  });
});
