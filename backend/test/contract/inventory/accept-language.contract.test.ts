import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';

/**
 * Issue #1011 — the storefront stock read and the notify-when-available subscription read the
 * buyer's language from the whole `Accept-Language` header through `requestScopeLanguage`:
 * q-weighted, each tag matched against the channel's languages (exact, then base language), else
 * the channel's default. Before, both took the header's first tag alone, so
 * `en;q=0.2, pl-PL;q=0.9` asked about English and `de-DE, pl;q=0.5` about the default.
 *
 * The run's channel offers `en-US` (default) and `pl-PL`. The product tracks stock, has none,
 * and is switched off at (channel, `en-US`): it is available in Polish only, so the stock read
 * answers it there and 404s it elsewhere, and a subscription is accepted — stamped with the
 * language its availability was judged in (issue #696) — in Polish only.
 */
describe('Inventory language from Accept-Language (issue #1011)', () => {
  let h: BackendServerHandle;
  const run = randomUUID().slice(0, 8);
  const channelId = randomUUID();
  const channelCode = `inv1011-${run}`;
  const productId = randomUUID();

  async function sql<T = unknown>(query: string, params: unknown[] = []): Promise<T> {
    return (await h.em().getConnection().execute(query, params)) as T;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    await sql(
      `insert into sales_channels (id, code, name, default_language, languages, currencies, default_currency,
                                   active, created_at, updated_at)
       values (?, ?, ?::jsonb, 'en-US', '["en-US","pl-PL"]'::jsonb, '["PLN"]'::jsonb, 'PLN', true, now(), now())`,
      [channelId, channelCode, JSON.stringify({ 'en-US': `Inventory Accept-Language ${run}` })],
    );
    const sku = `INV1011-${run}`.toUpperCase();
    await sql(
      `insert into products (id, sku, slug, type, status, name, description, attribute_values, visibility,
                             allowed_organization_ids, manage_stock, created_at, updated_at)
       values (?, ?, ?, 'simple', 'active', ?, '', '{}'::jsonb, 'public', '[]'::jsonb, true, now(), now())`,
      [productId, sku, sku.toLowerCase(), `Inventory ${run}`],
    );
    await sql(`insert into sales_channel_products (sales_channel_id, product_id) values (?, ?)`, [channelId, productId]);
    await sql(
      `insert into product_channel_language_scopes (product_id, sales_channel_id, language_code, status, created_at, updated_at)
       values (?, ?, 'en-US', 'inactive', now(), now())`,
      [productId, channelId],
    );
  });

  afterAll(async () => {
    if (h) {
      await sql(`delete from availability_notifications where product_id = ?`, [productId]);
      await sql(`delete from product_channel_language_scopes where product_id = ?`, [productId]);
      await sql(`delete from sales_channel_products where product_id = ?`, [productId]);
      await sql(`delete from products where id = ?`, [productId]);
      await sql(`delete from sales_channels where id = ?`, [channelId]);
      await teardownBackendServer(h);
    }
  });

  function headers(acceptLanguage: string | undefined): Record<string, string> {
    return {
      'x-sales-channel': channelCode,
      ...(acceptLanguage === undefined ? {} : { 'accept-language': acceptLanguage }),
    };
  }

  async function stock(acceptLanguage?: string): Promise<number> {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/storefront/inventory/stock/${productId}`,
      headers: headers(acceptLanguage),
    });
    return res.statusCode;
  }

  /** Subscribes a fresh address; the status and the language the row was stamped with. */
  async function subscribe(acceptLanguage?: string): Promise<{ status: number; languageCode: string | null }> {
    const email = `inv1011-${run}-${randomUUID().slice(0, 6)}@example.test`;
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/storefront/inventory/notify-when-available',
      headers: { ...headers(acceptLanguage), 'content-type': 'application/json' },
      payload: { productId, email },
    });
    if (res.statusCode !== 202) return { status: res.statusCode, languageCode: null };
    const rows = await sql<Array<{ language_code: string | null }>>(
      `select language_code from availability_notifications where product_id = ? and email = ?`,
      [productId, email],
    );
    return { status: 202, languageCode: rows[0]?.language_code ?? null };
  }

  it('honours the q-weights: `en;q=0.2, pl-PL;q=0.9` is Polish', async () => {
    expect(await stock('en;q=0.2, pl-PL;q=0.9')).toBe(200);
    expect(await subscribe('en;q=0.2, pl-PL;q=0.9')).toEqual({ status: 202, languageCode: 'pl-PL' });
  });

  it('matches a language-only tag to the channel language: `pl` is `pl-PL`', async () => {
    expect(await stock('pl')).toBe(200);
    expect(await subscribe('pl')).toEqual({ status: 202, languageCode: 'pl-PL' });
  });

  it('skips an unoffered tag for the next offered one', async () => {
    expect(await stock('de-DE, pl;q=0.5')).toBe(200);
    expect(await subscribe('de-DE, pl;q=0.5')).toEqual({ status: 202, languageCode: 'pl-PL' });
  });

  it('answers a language the channel does not offer in the channel default', async () => {
    expect(await stock('de-DE')).toBe(404);
    expect((await subscribe('de-DE')).status).toBe(404);
  });

  it('without the header, asks in the channel default, as before', async () => {
    expect(await stock()).toBe(404);
    expect((await subscribe()).status).toBe(404);
  });
});
