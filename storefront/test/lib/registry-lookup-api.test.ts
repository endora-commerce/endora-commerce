import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  REGISTRATION_OPTIONS_TAG,
  getRegistrationOptions,
  lookupCompany,
} from '../../lib/api/registry-lookup';

/**
 * Feature 173 (T032; FR-008, FR-018) — the storefront's two calls to the
 * registration lookup (`specs/173-registration-registry-lookup/contracts/storefront-ux.md`):
 * the options read is cached and fails closed; the lookup forwards the buyer's
 * address so the backend's per-client limit counts the buyer, not the storefront.
 */
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
}));

interface RecordedCall {
  url: string;
  init: RequestInit & { next?: { revalidate?: number | false; tags?: string[] } };
}

const originalFetch = globalThis.fetch;
let calls: RecordedCall[] = [];

function stubFetch(status: number, body: unknown): void {
  calls = [];
  globalThis.fetch = vi.fn(async (url: unknown, init: unknown) => {
    calls.push({ url: String(url), init: (init ?? {}) as RecordedCall['init'] });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const FOUND = {
  data: {
    status: 'found',
    lookupId: 'A'.repeat(43),
    normalizedTaxId: '5260250995',
    country: 'PL',
    source: 'gus',
    company: {
      legalName: 'PRZYKŁADOWA SPÓŁKA',
      registeredAddress: { street: 'ul. Testowa 1', postalCode: '00-001', city: 'Warszawa', country: 'PL' },
      regon: '123456785',
      vatStatus: 'active',
      activityStatus: 'active',
    },
    fetchedAt: '2026-11-05T10:00:00.000Z',
  },
};

describe('getRegistrationOptions', () => {
  it('reads the options cached for 300 s under their tag', async () => {
    stubFetch(200, { data: { registryLookup: { enabled: true, countries: ['PL', 'DE'] } } });
    expect(await getRegistrationOptions()).toEqual({ enabled: true, countries: ['PL', 'DE'] });
    expect(calls[0]!.url).toBe('http://api.test/api/v1/organizations/registration-options');
    expect(calls[0]!.init.next).toEqual({ revalidate: 300, tags: [REGISTRATION_OPTIONS_TAG] });
    expect(REGISTRATION_OPTIONS_TAG).toBe('organizations:registration-options');
  });

  it.each([
    ['a 503', () => stubFetch(503, { error: { code: 'MODULE_DISABLED', message: 'x' } })],
    ['a malformed answer', () => stubFetch(200, { data: { registryLookup: { enabled: 'yes' } } })],
    [
      'a network failure',
      () => {
        globalThis.fetch = vi.fn(async () => {
          throw new TypeError('fetch failed');
        }) as unknown as typeof fetch;
      },
    ],
  ])('fails closed on %s', async (_label, stub) => {
    stub();
    expect(await getRegistrationOptions()).toEqual({ enabled: false, countries: [] });
  });
});

describe('lookupCompany', () => {
  it('posts the request body and forwards the buyer address', async () => {
    stubFetch(200, FOUND);
    const outcome = await lookupCompany({ taxId: 'PL 526-025-09-95', country: 'PL', forwardedFor: '203.0.113.7' });
    expect(outcome).toEqual({ kind: 'answer', data: FOUND.data });
    const call = calls[0]!;
    expect(call.url).toBe('http://api.test/api/v1/organizations/registry-lookup');
    expect(call.init.method).toBe('POST');
    expect(JSON.parse(String(call.init.body))).toEqual({ taxId: 'PL 526-025-09-95', country: 'PL' });
    expect(new Headers(call.init.headers).get('x-forwarded-for')).toBe('203.0.113.7');
  });

  it('a 429 is rate_limited', async () => {
    stubFetch(429, { error: { code: 'RATE_LIMITED', message: 'slow down' } });
    expect(await lookupCompany({ taxId: '5260250995', country: 'PL' })).toEqual({ kind: 'rate_limited' });
  });

  it.each([
    ['the switch off (404)', 404],
    ['a 500', 500],
  ])('%s is unavailable', async (_label, status) => {
    stubFetch(status, { error: { code: 'NOT_FOUND', message: 'x' } });
    expect(await lookupCompany({ taxId: '5260250995', country: 'PL' })).toEqual({ kind: 'unavailable' });
  });

  it('an answer that is not the contract is unavailable', async () => {
    stubFetch(200, { data: { status: 'registered' } });
    expect(await lookupCompany({ taxId: '5260250995', country: 'PL' })).toEqual({ kind: 'unavailable' });
  });
});
