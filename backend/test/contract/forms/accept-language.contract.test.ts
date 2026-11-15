import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { deleteForms, publishEntriesForm } from '../../helpers/seed-forms.js';

/**
 * Issue #1011 — the language a public form is read and submitted in (`specs/170-forms-module/`
 * research R-12 step 2, FR-035): `?language=` when the channel offers it, else the channel
 * language the whole `Accept-Language` header asks for, through `requestScopeLanguage` —
 * q-weighted, each tag matched against the channel's languages (exact, then base language), else
 * the channel's default. Before, the header's tags were tried in the order written, whatever their
 * weights, and only by exact match, so `en;q=0.2, pl-PL;q=0.9` was English and `pl` the default.
 *
 * The run's channel offers `en-US` (default) and `pl-PL`; the public read answers the language it
 * resolved.
 */
describe('Public form language from Accept-Language (issue #1011)', () => {
  let h: BackendServerHandle;
  const run = randomUUID().slice(0, 8);
  const channelId = randomUUID();
  const channelCode = `fm1011-${run}`;
  let formId = '';

  async function sql<T = unknown>(query: string, params: unknown[] = []): Promise<T> {
    return (await h.em().getConnection().execute(query, params)) as T;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    await sql(
      `insert into sales_channels (id, code, name, default_language, languages, currencies, default_currency,
                                   active, created_at, updated_at)
       values (?, ?, ?::jsonb, 'en-US', '["en-US","pl-PL"]'::jsonb, '["PLN"]'::jsonb, 'PLN', true, now(), now())`,
      [channelId, channelCode, JSON.stringify({ 'en-US': `Forms Accept-Language ${run}` })],
    );
    formId = (await publishEntriesForm(h, `Forms Accept-Language ${run}`)).detail.id;
  });

  afterAll(async () => {
    if (h) {
      if (formId) await deleteForms(h, [formId]);
      await sql(`delete from sales_channels where id = ?`, [channelId]);
      await teardownBackendServer(h);
    }
  });

  /** The language the public read of the form resolved. */
  async function language(acceptLanguage?: string, query = ''): Promise<string> {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/storefront/forms/${formId}${query}`,
      headers: {
        'x-sales-channel': channelCode,
        ...(acceptLanguage === undefined ? {} : { 'accept-language': acceptLanguage }),
      },
    });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: { language: string } }).data.language;
  }

  it('honours the q-weights: `en;q=0.2, pl-PL;q=0.9` is Polish', async () => {
    expect(await language('en;q=0.2, pl-PL;q=0.9')).toBe('pl-PL');
    // Both tags offered exactly: only the weights tell them apart.
    expect(await language('en-US;q=0.2, pl-PL;q=0.9')).toBe('pl-PL');
  });

  it('matches a language-only tag to the channel language: `pl` is `pl-PL`', async () => {
    expect(await language('pl')).toBe('pl-PL');
  });

  it('skips an unoffered tag for the next offered one', async () => {
    expect(await language('de-DE, pl;q=0.5')).toBe('pl-PL');
  });

  it('answers a language the channel does not offer in the channel default', async () => {
    expect(await language('de-DE')).toBe('en-US');
  });

  it('without the header, reads in the channel default, as before', async () => {
    expect(await language()).toBe('en-US');
  });

  it('lets an offered `?language=` win over the header', async () => {
    expect(await language('en-US', '?language=pl-PL')).toBe('pl-PL');
  });

  it('passes an unoffered `?language=` over for the header, as before', async () => {
    expect(await language('en;q=0.2, pl-PL;q=0.9', '?language=de-DE')).toBe('pl-PL');
  });
});
