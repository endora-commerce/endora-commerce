import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { withModuleOff } from '../../helpers/off-state.js';

/**
 * Feature 171 (FR-041, T014, research R5) — a CMS page cannot sit under a blog prefix:
 * `/<prefix>/…` is the blog's, so the page would save and never be served. The blog
 * contributes its current and former prefixes per channel to CMS's reserved-segment
 * registry; CMS never names the blog. With the blog off it contributes nothing.
 */
describe('CMS refuses a page under a blog prefix (feature 171, T014)', () => {
  let h: BackendServerHandle;
  const adminCookie = { b2b_session: 'stub-admin-session' };
  const run = `bc171-${randomUUID().slice(0, 8)}`;
  const current = `${run}-news`;
  const former = `${run}-old`;
  let channel: { id: string; code: string };
  let other: { id: string; code: string };
  const pageIds: string[] = [];

  async function createChannel(suffix: string) {
    const em = h.em();
    const created = em.create(SalesChannel, {
      code: `${run}-${suffix}`,
      name: { 'en-US': `Contributors ${suffix}` },
      languages: ['en-US'],
      defaultLanguage: 'en-US',
      currencies: ['USD'],
      defaultCurrency: 'USD',
      active: true,
      systemDefault: false,
      status: 'active',
    });
    await em.persistAndFlush(created);
    return { id: created.id, code: created.code };
  }

  async function setPrefix(value: string) {
    const res = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/blog.url_prefix/value',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ scope: 'subset', salesChannelCodes: [channel.code], value }),
    });
    expect(res.statusCode, res.body).toBe(200);
  }

  async function createPage(slug: string, channelId: string) {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/cms/pages',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        name: `Page ${slug}`,
        slug,
        active: true,
        description: null,
        salesChannelIds: [channelId],
        languages: ['en-US'],
      }),
    });
    if (res.statusCode === 201) pageIds.push((res.json() as { data: { id: string } }).data.id);
    return res;
  }

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
    channel = await createChannel('a');
    other = await createChannel('b');
    await setPrefix(former);
    await setPrefix(current);
  });

  afterAll(async () => {
    await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/settings/blog.url_prefix/values?salesChannelCodes=${channel.code}`,
      cookies: adminCookie,
    });
    const connection = h.em().getConnection();
    for (const id of pageIds) {
      await connection.execute('delete from cms_page_sales_channels where page_id = ?', [id]);
      await connection.execute('delete from cms_pages where id = ?', [id]);
    }
    for (const c of [channel, other]) {
      await connection.execute('delete from blog_url_prefixes where sales_channel_id = ?', [c.id]);
      await connection.execute('delete from sales_channels where id = ?', [c.id]);
    }
    await teardownBackendServer(h);
  });

  it('refuses a page whose first segment is the channel’s current or former blog prefix', async () => {
    for (const segment of [current, former]) {
      const res = await createPage(segment, channel.id);
      expect(res.statusCode, res.body).toBe(409);
      expect(res.json()).toMatchObject({
        error: { code: ERROR_CODES.CMS_SLUG_RESERVED, details: { segment, claimedBy: 'blog' } },
      });
    }
  });

  it('accepts the same slug in a channel whose blog does not use it', async () => {
    const res = await createPage(current, other.id);
    expect(res.statusCode, res.body).toBe(201);
  });

  it('claims nothing while the blog is off', async () => {
    await withModuleOff('blog', 'deactivated', async () => {
      const res = await createPage(former, channel.id);
      expect(res.statusCode, res.body).toBe(201);
    });
  });
});
