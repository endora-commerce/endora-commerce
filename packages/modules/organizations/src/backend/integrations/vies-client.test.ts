import { describe, expect, it } from 'vitest';
import { ViesClient } from './vies-client.js';

/**
 * Feature 173 (T006, FR-024) — characterisation of today's `validate()` (the
 * admin "Validate now" and `customers`' `vatValidatorPort`), then the
 * extracted `check(country, number)` the registration lookup's adapter shares.
 * Synthetic data only.
 */

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

interface Recorded {
  url: string;
  body: unknown;
}

function clientAnswering(
  answer: () => Promise<Response>,
  timeoutMs = 5000,
): { client: ViesClient; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null });
    const signal = init?.signal;
    return await new Promise<Response>((resolve, reject) => {
      signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      answer().then(resolve, reject);
    });
  }) as typeof globalThis.fetch;
  return { client: new ViesClient({ fetchImpl, timeoutMs }), calls };
}

const VALID_DE = { valid: true, countryCode: 'DE', vatNumber: '123456789', name: '---', address: '---' };
const VALID_PL = {
  valid: true,
  countryCode: 'PL',
  vatNumber: '5260250995',
  name: 'PRZYKŁADOWA SPÓŁKA AKCYJNA',
  address: 'UL. TESTOWA 1\n00-001 WARSZAWA',
};

describe('ViesClient.validate (characterisation)', () => {
  it('valid ⇒ validated with name and the address as one line', async () => {
    const { client, calls } = clientAnswering(async () => json(200, VALID_PL));
    expect(await client.validate({ taxId: 'PL5260250995' })).toEqual({
      outcome: 'validated',
      legalName: VALID_PL.name,
      address: { line1: VALID_PL.address, countryCode: 'PL' },
      errorKind: null,
    });
    expect(calls[0]?.body).toEqual({ countryCode: 'PL', vatNumber: '5260250995' });
    expect(calls[0]?.url).toBe('https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number');
  });

  it('takes the country from the hint when the number has no prefix', async () => {
    const { client, calls } = clientAnswering(async () => json(200, VALID_DE));
    await client.validate({ taxId: '123 456-789', countryCode: 'DE' });
    expect(calls[0]?.body).toEqual({ countryCode: 'DE', vatNumber: '123456789' });
  });

  it('isValid is read when valid is absent; no address ⇒ the country alone', async () => {
    const { client } = clientAnswering(async () => json(200, { isValid: true, name: null, address: null }));
    expect(await client.validate({ taxId: 'DE123456789' })).toEqual({
      outcome: 'validated',
      legalName: null,
      address: { countryCode: 'DE' },
      errorKind: null,
    });
  });

  it('no prefix and no hint ⇒ unverified / invalid_format, no call', async () => {
    const { client, calls } = clientAnswering(async () => json(200, VALID_DE));
    expect(await client.validate({ taxId: '123456789' })).toEqual({
      outcome: 'unverified',
      legalName: null,
      address: null,
      errorKind: 'invalid_format',
    });
    expect(calls).toHaveLength(0);
  });

  it.each([
    ['valid: false', 'failed', 'not_found', async () => json(200, { valid: false })],
    ['503', 'deferred', 'provider_503', async () => json(503, {})],
    ['400', 'failed', 'http_400', async () => json(400, {})],
    ['a body that is not the schema', 'deferred', 'invalid_response_shape', async () => json(200, { valid: 'yes' })],
    ['a network error', 'deferred', 'network_error', async () => Promise.reject(new TypeError('fetch failed'))],
  ] as const)('%s ⇒ %s / %s', async (_label, outcome, errorKind, answer) => {
    const { client } = clientAnswering(answer);
    expect(await client.validate({ taxId: 'DE123456789' })).toEqual({ outcome, legalName: null, address: null, errorKind });
  });

  it('a timeout ⇒ deferred / network_timeout', async () => {
    const { client } = clientAnswering(() => new Promise<Response>(() => {}), 10);
    expect(await client.validate({ taxId: 'DE123456789' })).toEqual({
      outcome: 'deferred',
      legalName: null,
      address: null,
      errorKind: 'network_timeout',
    });
  });
});

describe('ViesClient.check (feature 173)', () => {
  it('valid ⇒ the name and address as VIES wrote them', async () => {
    const { client } = clientAnswering(async () => json(200, VALID_PL));
    expect(await client.check('PL', '5260250995')).toEqual({
      status: 'valid',
      name: VALID_PL.name,
      address: VALID_PL.address,
    });
  });

  it('valid with "---" (Germany does not disclose) ⇒ valid with the raw values', async () => {
    const { client } = clientAnswering(async () => json(200, VALID_DE));
    expect(await client.check('DE', '123456789')).toEqual({ status: 'valid', name: '---', address: '---' });
  });

  it('valid: false ⇒ invalid', async () => {
    const { client } = clientAnswering(async () => json(200, { valid: false }));
    expect(await client.check('DE', '123456789')).toEqual({ status: 'invalid' });
  });

  it('a member state that is down (userError MS_UNAVAILABLE) ⇒ unavailable, not invalid', async () => {
    const { client } = clientAnswering(async () => json(200, { valid: false, userError: 'MS_UNAVAILABLE' }));
    expect(await client.check('DE', '123456789')).toEqual({ status: 'unavailable', errorKind: 'vies_ms_unavailable' });
  });

  it('a 4xx ⇒ refused; 5xx, timeout, network ⇒ unavailable', async () => {
    expect(await clientAnswering(async () => json(400, {})).client.check('DE', '1')).toEqual({
      status: 'refused',
      errorKind: 'http_400',
    });
    expect(await clientAnswering(async () => json(500, {})).client.check('DE', '1')).toEqual({
      status: 'unavailable',
      errorKind: 'provider_500',
    });
    expect(await clientAnswering(() => new Promise<Response>(() => {}), 10).client.check('DE', '1')).toEqual({
      status: 'unavailable',
      errorKind: 'network_timeout',
    });
    expect(await clientAnswering(async () => Promise.reject(new Error('x'))).client.check('DE', '1')).toEqual({
      status: 'unavailable',
      errorKind: 'network_error',
    });
  });
});
