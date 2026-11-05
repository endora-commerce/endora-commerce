import { describe, expect, it } from 'vitest';
import { MinisterstwoFinansowClient } from './ministerstwo-finansow-client.js';

/**
 * Feature 173 (T001a) — the White List moved to `wykazpodatnikowvat.mf.gov.pl`;
 * the old `wl-api.mf.gov.pl` host stops answering on 2026-12-01
 * (`specs/173-registration-registry-lookup/research.md`, R-6). Without a
 * `baseUrl` override the client must call the new host.
 */
describe('MinisterstwoFinansowClient', () => {
  it('calls the wykazpodatnikowvat.mf.gov.pl host by default', async () => {
    const urls: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
      urls.push(String(input));
      return new Response(JSON.stringify({ result: { subject: null } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof globalThis.fetch;

    const client = new MinisterstwoFinansowClient({ fetchImpl, minIntervalMs: 0 });
    await client.validate({ taxId: '5261040828' });

    expect(urls).toHaveLength(1);
    expect(urls[0]).toMatch(
      /^https:\/\/wykazpodatnikowvat\.mf\.gov\.pl\/api\/search\/nip\/5261040828\?date=\d{4}-\d{2}-\d{2}$/,
    );
  });
});
