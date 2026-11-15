import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { createMinimumProduct, minimumFixtureRun } from '../../helpers/order-minimum-fixture.js';
import { removeBasePriceSql } from '../../helpers/price-book-sql.js';

/**
 * Issue #1011 — the basket's scope language is the channel language the whole `Accept-Language`
 * header asks for, through `requestScopeLanguage`: q-weighted, each tag matched against the
 * channel's languages (exact, then base language), else the channel's default. Before, every
 * storefront cart route took the header's first tag alone, so `en;q=0.2, pl-PL;q=0.9` asked
 * about English and `de-DE, pl;q=0.5` about the default.
 *
 * And an anonymous visitor's first add — the one that mints the basket's token — is judged in
 * that language too. It used to drop the request's language with the actor it rebuilt, so the
 * first add was always asked about the channel's default language, whatever the header said.
 *
 * The run's channel offers `en-US` (default) and `pl-PL`. The product is switched off at
 * (channel, `en-US`): available in Polish only, so an add-to-basket is accepted there and
 * refused with the absent product's 404 elsewhere (feature 163, row 13).
 */
describe('Basket language from Accept-Language (issue #1011)', () => {
  let h: BackendServerHandle;
  const run = minimumFixtureRun();
  const channelId = randomUUID();
  const channelCode = `ca1011-${run}`.toLowerCase();
  const CUSTOMER = { b2b_session: 'stub-customer-session' };
  let productId = '';

  async function sql<T = unknown>(query: string, params: unknown[] = []): Promise<T> {
    return (await h.em().getConnection().execute(query, params)) as T;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    await sql(
      `insert into sales_channels (id, code, name, default_language, languages, currencies, default_currency,
                                   active, created_at, updated_at)
       values (?, ?, ?::jsonb, 'en-US', '["en-US","pl-PL"]'::jsonb, '["PLN"]'::jsonb, 'PLN', true, now(), now())`,
      [channelId, channelCode, JSON.stringify({ 'en-US': `Basket Accept-Language ${run}` })],
    );
    // Feature 154 — the signed-in buyer shops here only if its Organization is assigned.
    await sql(`insert into sales_channel_organizations (sales_channel_id, organization_id) values (?, ?)`, [
      channelId,
      TEST_ORGANIZATION_ID,
    ]);
    const product = await createMinimumProduct(h.em(), {
      sku: `CA1011-${run}`,
      nameEn: `Basket ${run}`,
      namePl: `Koszyk ${run}`,
      channelIds: [channelId],
    });
    productId = product.id;
    await sql(
      `insert into product_channel_language_scopes (product_id, sales_channel_id, language_code, status, created_at, updated_at)
       values (?, ?, 'en-US', 'inactive', now(), now())`,
      [productId, channelId],
    );
  });

  afterAll(async () => {
    if (h) {
      await sql(`delete from carts where sales_channel_id = ?`, [channelId]);
      if (productId) {
        await sql(`delete from product_channel_language_scopes where product_id = ?`, [productId]);
        await sql(`delete from sales_channel_products where product_id = ?`, [productId]);
        await removeBasePriceSql(h.em(), productId);
        await sql(`delete from products where id = ?`, [productId]);
      }
      await sql(`delete from sales_channel_organizations where sales_channel_id = ?`, [channelId]);
      await sql(`delete from sales_channels where id = ?`, [channelId]);
      await teardownBackendServer(h);
    }
  });

  /**
   * An add-to-basket of the product: the signed-in buyer's, into their basket on the run's
   * channel (removed first, so every add starts from no basket), or an anonymous visitor's
   * first one, which mints the basket's token.
   */
  async function add(
    who: 'customer' | 'anonymous',
    acceptLanguage?: string,
  ): Promise<{ status: number; body: string }> {
    if (who === 'customer') {
      await sql(`delete from carts where sales_channel_id = ? and customer_account_id = ?`, [channelId, TEST_CUSTOMER_ID]);
    }
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      headers: {
        'x-sales-channel': channelCode,
        ...(acceptLanguage === undefined ? {} : { 'accept-language': acceptLanguage }),
      },
      ...(who === 'customer' ? { cookies: CUSTOMER } : {}),
      payload: { productId, quantity: 1 },
    });
    return { status: res.statusCode, body: res.body };
  }

  async function expectAdded(who: 'customer' | 'anonymous', acceptLanguage: string): Promise<void> {
    const res = await add(who, acceptLanguage);
    expect(res.status, res.body).toBeLessThan(300);
  }

  async function expectRefused(who: 'customer' | 'anonymous', acceptLanguage?: string): Promise<void> {
    const res = await add(who, acceptLanguage);
    expect(res.status, res.body).toBe(404);
  }

  it('honours the q-weights: `en;q=0.2, pl-PL;q=0.9` is Polish', async () => {
    await expectAdded('customer', 'en;q=0.2, pl-PL;q=0.9');
  });

  it('matches a language-only tag to the channel language: `pl` is `pl-PL`', async () => {
    await expectAdded('customer', 'pl');
  });

  it('skips an unoffered tag for the next offered one', async () => {
    await expectAdded('customer', 'de-DE, pl;q=0.5');
  });

  it('answers a language the channel does not offer in the channel default', async () => {
    await expectRefused('customer', 'de-DE');
  });

  it('without the header, asks in the channel default, as before', async () => {
    await expectRefused('customer');
  });

  it('judges an anonymous visitor’s first add in the same language', async () => {
    await expectAdded('anonymous', 'pl-PL');
    await expectAdded('anonymous', 'en;q=0.2, pl-PL;q=0.9');
    await expectRefused('anonymous', 'de-DE');
    await expectRefused('anonymous');
  });
});
