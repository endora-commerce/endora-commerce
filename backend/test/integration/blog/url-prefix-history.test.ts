import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';

/**
 * Feature 171 (FR-042, OR-8, T012, data-model §1.3) — the blog remembers every prefix
 * a channel has served, so a former address can redirect to the current one. The
 * built-in `blog` is never stored as former: it always redirects (research R1).
 */
describe('blog URL-prefix history (feature 171, T012)', () => {
  let h: BackendServerHandle;
  const adminCookie = { b2b_session: 'stub-admin-session' };
  const run = `bh171-${randomUUID().slice(0, 8)}`;
  let channel: { id: string; code: string };

  type PrefixRow = { id: string; languageCode: string | null; prefix: string; state: 'current' | 'former' };

  async function setPrefix(value: string): Promise<void> {
    const res = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/blog.url_prefix/value',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ scope: 'subset', salesChannelCodes: [channel.code], value }),
    });
    expect(res.statusCode, res.body).toBe(200);
  }

  async function prefixes(): Promise<PrefixRow[]> {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/blog/addresses?salesChannelId=${channel.id}`,
      cookies: adminCookie,
    });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: PrefixRow[] }).data;
  }

  const summary = (rows: PrefixRow[]) =>
    rows.map((r) => `${r.state}:${r.prefix}`).sort();

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
    const em = h.em();
    const created = em.create(SalesChannel, {
      code: `${run}-ch`,
      name: { 'pl-PL': 'Prefix history' },
      languages: ['pl-PL'],
      defaultLanguage: 'pl-PL',
      currencies: ['PLN'],
      defaultCurrency: 'PLN',
      active: true,
      systemDefault: false,
      status: 'active',
    });
    await em.persistAndFlush(created);
    channel = { id: created.id, code: created.code };
  });

  afterAll(async () => {
    await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/settings/blog.url_prefix/values?salesChannelCodes=${channel.code}`,
      cookies: adminCookie,
    });
    const connection = h.em().getConnection();
    await connection.execute('delete from blog_url_prefixes where sales_channel_id = ?', [channel.id]);
    await connection.execute('delete from sales_channels where id = ?', [channel.id]);
    await teardownBackendServer(h);
  });

  it('keeps the current prefix and every former one, never `blog`', async () => {
    await setPrefix('aktualnosci');
    expect(summary(await prefixes())).toEqual(['current:aktualnosci']);

    await setPrefix('wiadomosci');
    expect(summary(await prefixes())).toEqual(['current:wiadomosci', 'former:aktualnosci']);

    // Back to a former prefix: it is current again, not former as well.
    await setPrefix('aktualnosci');
    expect(summary(await prefixes())).toEqual(['current:aktualnosci', 'former:wiadomosci']);

    await setPrefix('blog');
    expect(summary(await prefixes())).toEqual(['current:blog', 'former:aktualnosci', 'former:wiadomosci']);
    expect((await prefixes()).every((r) => r.languageCode === null)).toBe(true);
  });

  it('forgets a former prefix as one audited Command, and refuses to forget the current one', async () => {
    const rows = await prefixes();
    const former = rows.find((r) => r.state === 'former' && r.prefix === 'wiadomosci')!;
    const current = rows.find((r) => r.state === 'current')!;

    const forget = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/blog/addresses/${former.id}`,
      cookies: adminCookie,
    });
    expect(forget.statusCode, forget.body).toBe(204);
    expect(summary(await prefixes())).toEqual(['current:blog', 'former:aktualnosci']);

    const audit = (await h
      .em()
      .getConnection()
      .execute(`select count(*)::int as n from "audit_log_entries" where "action" = 'blog.url_prefix.forget' and "object_id" = ?`, [
        former.id,
      ])) as Array<{ n: number }>;
    expect(audit[0]!.n).toBe(1);

    const refused = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/blog/addresses/${current.id}`,
      cookies: adminCookie,
    });
    expect(refused.statusCode, refused.body).toBe(404);
    expect((refused.json() as { error: { code: string } }).error.code).toBe('BLOG_URL_PREFIX_NOT_FOUND');
  });
});
