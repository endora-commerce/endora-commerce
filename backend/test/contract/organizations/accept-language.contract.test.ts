import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { InMemoryMailer } from '../../../../packages/modules/email/src/backend/services/mailer.js';

/**
 * Issue #1011 — the verification link a business registration e-mails is put under the language
 * prefix of the channel language the whole `Accept-Language` header asks for, through
 * `requestScopeLanguage`: q-weighted, each tag matched against the channel's languages (exact,
 * then base language), else the channel's default. Before, the route passed the header's first
 * tag alone, so `en;q=0.2, pl-PL;q=0.9` linked to the English page and `de-DE, pl;q=0.5` to the
 * default.
 *
 * The run's channel offers `en-US` (default, unprefixed) and `pl-PL` (under `/pl`).
 */
describe('Registration e-mail language from Accept-Language (issue #1011)', () => {
  let h: BackendServerHandle;
  let mailer: InMemoryMailer;
  const run = randomUUID().slice(0, 8);
  const channelId = randomUUID();
  const channelCode = `og1011-${run}`;
  let seq = 0;

  async function sql<T = unknown>(query: string, params: unknown[] = []): Promise<T> {
    return (await h.em().getConnection().execute(query, params)) as T;
  }

  beforeAll(async () => {
    mailer = new InMemoryMailer();
    h = await setupBackendServer({ organizationsMailer: mailer });
    await sql(
      `insert into sales_channels (id, code, name, default_language, languages, currencies, default_currency,
                                   prefix_default_language, active, created_at, updated_at)
       values (?, ?, ?::jsonb, 'en-US', '["en-US","pl-PL"]'::jsonb, '["PLN"]'::jsonb, 'PLN', false, true, now(), now())`,
      [channelId, channelCode, JSON.stringify({ 'en-US': `Registration Accept-Language ${run}` })],
    );
  });

  afterAll(async () => {
    if (h) {
      // The registered Organizations stay, as every registration test's do; their link to the
      // run's channel goes with the channel.
      await sql(`delete from sales_channel_organizations where sales_channel_id = ?`, [channelId]);
      await sql(`delete from sales_channels where id = ?`, [channelId]);
      await teardownBackendServer(h);
    }
  });

  /** Registers a fresh business on the run's channel; the path of the e-mailed verification link. */
  async function verifyPath(acceptLanguage?: string): Promise<string> {
    seq += 1;
    const stamp = `${Date.now()}${seq}`.slice(-10);
    const email = `og1011-${run}-${seq}@example.test`;
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/organizations/register',
      headers: {
        'x-sales-channel': channelCode,
        ...(acceptLanguage === undefined ? {} : { 'accept-language': acceptLanguage }),
      },
      payload: {
        organization: {
          name: `Registration Accept-Language ${run} ${seq}`,
          taxId: `PL${stamp}`,
          registeredAddress: { street: 'ul. Testowa 1', city: 'Warszawa', postalCode: '00-001', country: 'PL' },
        },
        firstUser: { email, password: 'a-very-strong-password-123!', firstName: 'Anna', lastName: 'Nowak' },
        acceptedTermsVersion: '1.0.0',
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    const message = mailer.sent.find((m) => m.to === email);
    const verifyUrl = (message?.meta as { verifyUrl?: string } | undefined)?.verifyUrl;
    expect(verifyUrl, 'the verification e-mail carries its link').toEqual(expect.any(String));
    return new URL(verifyUrl!).pathname;
  }

  it('honours the q-weights: `en;q=0.2, pl-PL;q=0.9` is Polish', async () => {
    expect(await verifyPath('en;q=0.2, pl-PL;q=0.9')).toBe('/pl/verify');
  });

  it('matches a language-only tag to the channel language: `pl` is `pl-PL`', async () => {
    expect(await verifyPath('pl')).toBe('/pl/verify');
  });

  it('skips an unoffered tag for the next offered one', async () => {
    expect(await verifyPath('de-DE, pl;q=0.5')).toBe('/pl/verify');
  });

  it('answers a language the channel does not offer in the channel default', async () => {
    expect(await verifyPath('de-DE')).toBe('/verify');
  });

  it('without the header, links in the channel default, as before', async () => {
    expect(await verifyPath()).toBe('/verify');
  });
});
