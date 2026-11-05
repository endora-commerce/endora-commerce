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

/** A synthetic subject — invented values, the White List's field names. */
const SUBJECT = {
  name: 'PRZYKŁADOWA SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ',
  nip: '5260250995',
  statusVat: 'Czynny',
  regon: '123456785',
  workingAddress: 'UL. TESTOWA 1/2, 00-001 WARSZAWA',
  residenceAddress: null,
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function clientAnswering(answer: () => Promise<Response>, timeoutMs = 5000): MinisterstwoFinansowClient {
  const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
    const signal = init?.signal;
    return await new Promise<Response>((resolve, reject) => {
      signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      answer().then(resolve, reject);
    });
  }) as typeof globalThis.fetch;
  return new MinisterstwoFinansowClient({ fetchImpl, minIntervalMs: 0, timeoutMs });
}

/**
 * Feature 173 (T005, FR-024) — characterisation of the admin "Validate now"
 * answer before `search()` is extracted from it, so the extraction is proven to
 * change nothing an administrator sees.
 */
describe('MinisterstwoFinansowClient.validate (characterisation)', () => {
  it('Czynny ⇒ validated with the name and the one-line address', async () => {
    const result = await clientAnswering(async () => json(200, { result: { subject: SUBJECT } })).validate({
      taxId: 'PL5260250995',
    });
    expect(result).toEqual({
      outcome: 'validated',
      legalName: SUBJECT.name,
      address: { line1: SUBJECT.workingAddress, countryCode: 'PL' },
      errorKind: null,
    });
  });

  it('Zwolniony ⇒ failed / not_active_vat_payer, residence address when no working one', async () => {
    const result = await clientAnswering(async () =>
      json(200, {
        result: {
          subject: { ...SUBJECT, statusVat: 'Zwolniony', workingAddress: null, residenceAddress: 'TESTOWO 5, 11-111 TESTOWO' },
        },
      }),
    ).validate({ taxId: '5260250995' });
    expect(result).toEqual({
      outcome: 'failed',
      legalName: SUBJECT.name,
      address: { line1: 'TESTOWO 5, 11-111 TESTOWO', countryCode: 'PL' },
      errorKind: 'not_active_vat_payer',
    });
  });

  it('a subject with no address ⇒ the country alone', async () => {
    const result = await clientAnswering(async () =>
      json(200, { result: { subject: { ...SUBJECT, workingAddress: null } } }),
    ).validate({ taxId: '5260250995' });
    expect(result.address).toEqual({ countryCode: 'PL' });
  });

  it('a malformed NIP ⇒ unverified / invalid_format, no call', async () => {
    let calls = 0;
    const result = await clientAnswering(async () => {
      calls += 1;
      return json(200, {});
    }).validate({ taxId: 'PL12345' });
    expect(result).toEqual({ outcome: 'unverified', legalName: null, address: null, errorKind: 'invalid_format' });
    expect(calls).toBe(0);
  });

  it.each([
    ['null subject', 'failed', 'not_found', async () => json(200, { result: { subject: null } })],
    ['404', 'failed', 'not_found', async () => json(404, {})],
    ['429', 'deferred', 'rate_limited', async () => json(429, {})],
    ['503', 'deferred', 'provider_503', async () => json(503, {})],
    ['400 WL-115 (bad checksum)', 'failed', 'http_400', async () => json(400, { code: 'WL-115', message: 'x' })],
    ['403', 'failed', 'http_403', async () => json(403, {})],
    ['a body that is not the schema', 'deferred', 'invalid_response_shape', async () => json(200, { result: 'nope' })],
    ['a network error', 'deferred', 'network_error', async () => Promise.reject(new TypeError('fetch failed'))],
  ] as const)('%s ⇒ %s / %s', async (_label, outcome, errorKind, answer) => {
    const result = await clientAnswering(answer).validate({ taxId: '5260250995' });
    expect(result).toEqual({ outcome, legalName: null, address: null, errorKind });
  });

  it('a timeout ⇒ deferred / network_timeout', async () => {
    const result = await clientAnswering(() => new Promise<Response>(() => {}), 10).validate({ taxId: '5260250995' });
    expect(result).toEqual({ outcome: 'deferred', legalName: null, address: null, errorKind: 'network_timeout' });
  });

  it('the daily limit (WL-1919) and maintenance (WL-1188) are deferred, not failed (research R-6)', async () => {
    expect(
      (await clientAnswering(async () => json(400, { code: 'WL-1919', message: 'limit' })).validate({ taxId: '5260250995' }))
        .errorKind,
    ).toBe('rate_limited');
    const maintenance = await clientAnswering(async () => json(400, { code: 'WL-1188' })).validate({
      taxId: '5260250995',
    });
    expect(maintenance).toEqual({ outcome: 'deferred', legalName: null, address: null, errorKind: 'provider_maintenance' });
  });
});

describe('MinisterstwoFinansowClient.search (feature 173)', () => {
  it('found ⇒ the parsed subject', async () => {
    const result = await clientAnswering(async () => json(200, { result: { subject: SUBJECT } })).search('5260250995');
    expect(result).toEqual({ status: 'found', subject: SUBJECT });
  });

  it('200 with subject null ⇒ not found (T001: the White List answers an unknown NIP so)', async () => {
    expect(await clientAnswering(async () => json(200, { result: { subject: null } })).search('5260250995')).toEqual({
      status: 'not_found',
    });
  });

  it('400 WL-115 ⇒ invalid', async () => {
    expect(await clientAnswering(async () => json(400, { code: 'WL-115', message: 'x' })).search('5260250995')).toEqual({
      status: 'invalid',
      errorKind: 'http_400',
    });
  });

  it.each([400, 200, 429])('a body code WL-1919 with status %s ⇒ unavailable / rate_limited', async (status) => {
    expect(await clientAnswering(async () => json(status, { code: 'WL-1919' })).search('5260250995')).toEqual({
      status: 'unavailable',
      errorKind: 'rate_limited',
    });
  });

  it('WL-1188 ⇒ unavailable / provider_maintenance', async () => {
    expect(await clientAnswering(async () => json(400, { code: 'WL-1188' })).search('5260250995')).toEqual({
      status: 'unavailable',
      errorKind: 'provider_maintenance',
    });
  });

  it('5xx, timeout and a network error ⇒ unavailable with their kind', async () => {
    expect(await clientAnswering(async () => json(502, {})).search('5260250995')).toEqual({
      status: 'unavailable',
      errorKind: 'provider_502',
    });
    expect(await clientAnswering(() => new Promise<Response>(() => {}), 10).search('5260250995')).toEqual({
      status: 'unavailable',
      errorKind: 'network_timeout',
    });
    expect(await clientAnswering(async () => Promise.reject(new Error('x'))).search('5260250995')).toEqual({
      status: 'unavailable',
      errorKind: 'network_error',
    });
  });
});
