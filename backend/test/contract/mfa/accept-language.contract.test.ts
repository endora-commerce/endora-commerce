import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { customerOAuthStartUrl, oauthBinding, storefrontBinding } from '../../helpers/oauth-binding.js';

/**
 * Issue #1011 — the federated customer sign-in records the language of the starting
 * page (feature 167): the language prefix of the `next` the storefront sent, else the
 * channel language the whole `Accept-Language` asks for through `requestScopeLanguage`
 * — q-weighted, each tag matched against the channel's languages (exact, then base
 * language), else the channel's default. Before, it was the header's first tag alone,
 * so `en;q=0.2, pl-PL;q=0.9` returned the browser to the English pages and
 * `de-DE, pl;q=0.5` to the default language's.
 *
 * The run's channel offers `en-US` (default) and `pl-PL`, both prefixed. The sign-in is
 * refused (the fake provider reports `unverified@example.com` as an unverified address,
 * which creates nothing), so the callback sends the browser back to the sign-in page in
 * the recorded language. Writes are this file's own: the channel row, and the provider
 * switched on for that channel only.
 */
describe('mfa federated sign-in language from Accept-Language (issue #1011)', () => {
  let h: BackendServerHandle;
  const run = randomUUID().slice(0, 8);
  const channelId = randomUUID();
  const channelCode = `mfa1011-${run}`;

  async function sql<T = unknown>(query: string, params: unknown[] = []): Promise<T> {
    return (await h.em().getConnection().execute(query, params)) as T;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    await sql(
      `insert into sales_channels (id, code, name, default_language, languages, currencies, default_currency,
                                   active, prefix_default_language, created_at, updated_at)
       values (?, ?, ?::jsonb, 'en-US', '["en-US","pl-PL"]'::jsonb, '["PLN"]'::jsonb, 'PLN', true, true, now(), now())`,
      [channelId, channelCode, JSON.stringify({ 'en-US': `Mfa Accept-Language ${run}` })],
    );
    await h.salesChannels.cache.invalidateAll();
    await h.settings.adminService.setValueForSubset('mfa.storefront.google_enabled', [channelCode], true, null, {
      actorAdminUserId: null,
    });
  }, 60_000);

  afterAll(async () => {
    if (h) {
      await h.settings.adminService.resetValues('mfa.storefront.google_enabled', [channelCode], {
        actorAdminUserId: null,
      });
      await sql(`delete from sales_channels where id = ?`, [channelId]);
      await h.salesChannels.cache.invalidateAll();
      await teardownBackendServer(h);
    }
  });

  /** The path of the sign-in page a refused federated sign-in sent the browser back to. */
  async function refusedTo(acceptLanguage: string | undefined, next = '/account/orders'): Promise<string> {
    const binding = storefrontBinding();
    const start = await h.app.inject({
      method: 'GET',
      url: customerOAuthStartUrl(binding, { next }),
      headers: {
        'x-sales-channel': channelCode,
        ...(acceptLanguage === undefined ? {} : { 'accept-language': acceptLanguage }),
      },
    });
    expect(start.statusCode, start.body).toBe(302);
    const state = new URL(start.headers['location'] as string).searchParams.get('state');
    expect(state, String(start.headers['location'])).toBeTruthy();
    const callback = await h.app.inject({
      method: 'GET',
      url: `/api/v1/auth/customer/oauth/google/callback?code=${encodeURIComponent('unverified@example.com')}&state=${encodeURIComponent(state!)}`,
      cookies: oauthBinding(start),
    });
    expect(callback.statusCode).toBe(302);
    const location = new URL(callback.headers['location'] as string);
    expect(location.searchParams.get('error')).toBe('email_unverified');
    return location.pathname;
  }

  it('honours the q-weights: `en;q=0.2, pl-PL;q=0.9` is Polish', async () => {
    expect(await refusedTo('en;q=0.2, pl-PL;q=0.9')).toBe('/pl/login');
  });

  it('skips a tag the channel does not serve: `de-DE, pl;q=0.5` is Polish', async () => {
    expect(await refusedTo('de-DE, pl;q=0.5')).toBe('/pl/login');
  });

  it('matches a language-only tag to the channel language: `pl` is `pl-PL`', async () => {
    expect(await refusedTo('pl')).toBe('/pl/login');
  });

  it('falls back to the channel default without a served tag or without the header', async () => {
    expect(await refusedTo('de-DE')).toBe('/en/login');
    expect(await refusedTo(undefined)).toBe('/en/login');
  });

  it('a language-prefixed `next` still wins over the header', async () => {
    expect(await refusedTo('pl-PL', '/en/cart')).toBe('/en/login');
  });
});
