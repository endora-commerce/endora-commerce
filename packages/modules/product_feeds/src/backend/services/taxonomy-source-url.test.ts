import { describe, expect, it, vi } from 'vitest';
import { TAXONOMY_FETCH_LIMITS } from '@endora-commerce/contracts';
import {
  classifyAddress,
  isForbiddenAddress,
  validateTaxonomySourceUrl,
} from './taxonomy-source-url.js';
import { TaxonomySourceFetcher } from './taxonomy-source-fetcher.js';

/**
 * Feature 067 Phase 11 / T120 — the egress guard (FR-091, research §R23).
 *
 * This module makes the only outbound request the Product Feed module can
 * make, to an **operator-configurable** URL. That is an SSRF-shaped surface, so
 * the guard is tested as a guard: every refusal below is a case someone would
 * otherwise reach the metadata endpoint or an internal service with.
 *
 * Nothing here touches the network. `fetchFn` and `lookupFn` are injected, and
 * a test that really called Google would be both a flake and a privacy leak.
 */

const OK_LOOKUP = async (): Promise<string[]> => ['93.184.216.34'];

function fetcher(overrides: {
  fetchFn: typeof fetch;
  lookupFn?: (host: string) => Promise<string[]>;
}): TaxonomySourceFetcher {
  return new TaxonomySourceFetcher({
    fetchFn: overrides.fetchFn,
    lookupFn: overrides.lookupFn ?? OK_LOOKUP,
  });
}

describe('validateTaxonomySourceUrl (shape)', () => {
  it('accepts an absolute https URL with no credentials and no fragment', () => {
    const result = validateTaxonomySourceUrl('https://example.test/taxonomy.txt');
    expect(result.ok).toBe(true);
  });

  it('refuses http — permitting it for "internal" hosts would make the guard argue with itself', () => {
    const result = validateTaxonomySourceUrl('http://example.test/taxonomy.txt');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('scheme');
  });

  it('refuses a userinfo URL', () => {
    const result = validateTaxonomySourceUrl('https://user:pass@example.test/taxonomy.txt');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('credentials');
  });

  it('refuses a fragment', () => {
    const result = validateTaxonomySourceUrl('https://example.test/taxonomy.txt#part');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('fragment');
  });

  it('refuses an unparseable value and a non-http scheme', () => {
    expect(validateTaxonomySourceUrl('not a url').ok).toBe(false);
    expect(validateTaxonomySourceUrl('file:///etc/passwd').ok).toBe(false);
  });
});

describe('classifyAddress', () => {
  const forbidden: ReadonlyArray<[string, string]> = [
    ['127.0.0.1', 'loopback'],
    ['::1', 'loopback'],
    ['169.254.169.254', 'link_local'],
    ['fe80::1', 'link_local'],
    ['10.0.0.1', 'private'],
    ['192.168.1.10', 'private'],
    ['172.20.0.5', 'private'],
    ['fc00::1', 'private'],
    ['100.64.0.1', 'cgnat'],
    ['0.0.0.0', 'unspecified'],
  ];

  it.each(forbidden)('classifies %s as %s and forbids it', (ip, expected) => {
    expect(classifyAddress(ip)).toBe(expected);
    expect(isForbiddenAddress(ip)).toBe(true);
  });

  it('leaves an ordinary public address alone', () => {
    expect(classifyAddress('93.184.216.34')).toBe('public');
    expect(isForbiddenAddress('93.184.216.34')).toBe(false);
    expect(isForbiddenAddress('2606:2800:220:1:248:1893:25c8:1946')).toBe(false);
    // 172.32/12 is NOT private — the boundary a hand-rolled check gets wrong.
    expect(isForbiddenAddress('172.32.0.1')).toBe(false);
  });
});

describe('TaxonomySourceFetcher egress guard', () => {
  it('refuses a host that resolves into a forbidden range, before any request', async () => {
    const fetchFn = vi.fn();
    const result = await fetcher({
      fetchFn: fetchFn as unknown as typeof fetch,
      lookupFn: async () => ['169.254.169.254'],
    }).fetchFile({ url: 'https://metadata.internal.test/taxonomy.txt' });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('transport');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('refuses when ANY resolved address is forbidden, not only the first', async () => {
    const fetchFn = vi.fn();
    const result = await fetcher({
      fetchFn: fetchFn as unknown as typeof fetch,
      lookupFn: async () => ['93.184.216.34', '10.0.0.1'],
    }).fetchFile({ url: 'https://split-horizon.test/taxonomy.txt' });

    expect(result.ok).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('follows up to 3 redirect hops and refuses the 4th', async () => {
    let hop = 0;
    const fetchFn = vi.fn(async () => {
      hop += 1;
      return new Response(null, {
        status: 302,
        headers: { location: `https://example.test/hop-${hop}` },
      });
    });

    const result = await fetcher({ fetchFn: fetchFn as unknown as typeof fetch }).fetchFile({
      url: 'https://example.test/taxonomy.txt',
    });

    expect(result.ok).toBe(false);
    // The original request plus MAX_REDIRECTS follows, and no more.
    expect(fetchFn).toHaveBeenCalledTimes(TAXONOMY_FETCH_LIMITS.MAX_REDIRECTS + 1);
  });

  it('re-validates every hop: a redirect from a public host into a private one is refused', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(null, {
          status: 301,
          headers: { location: 'https://internal.test/taxonomy.txt' },
        }),
    );

    const result = await fetcher({
      fetchFn: fetchFn as unknown as typeof fetch,
      lookupFn: async (host) => (host === 'internal.test' ? ['10.1.2.3'] : ['93.184.216.34']),
    }).fetchFile({ url: 'https://example.test/taxonomy.txt' });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('transport');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('refuses a redirect to a non-https target', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'http://example.test/taxonomy.txt' },
        }),
    );
    const result = await fetcher({ fetchFn: fetchFn as unknown as typeof fetch }).fetchFile({
      url: 'https://example.test/taxonomy.txt',
    });
    expect(result.ok).toBe(false);
  });

  it('trips the size cap WHILE READING a stream whose Content-Length lies', async () => {
    const chunk = new Uint8Array(64 * 1024).fill(0x41);
    let produced = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        produced += chunk.byteLength;
        // Far more than the cap; the guard must stop reading rather than
        // buffer whatever the server chooses to send.
        if (produced > TAXONOMY_FETCH_LIMITS.MAX_RESPONSE_BYTES * 4) {
          controller.close();
          return;
        }
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });

    const fetchFn = vi.fn(
      async () =>
        // A `Content-Length` that claims the body is tiny. It is attacker
        // controlled in the threat model this guards against, so it may never
        // be the thing the cap is enforced from.
        new Response(body, { status: 200, headers: { 'content-length': '12' } }),
    );

    const result = await fetcher({ fetchFn: fetchFn as unknown as typeof fetch }).fetchFile({
      url: 'https://example.test/taxonomy.txt',
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('too_large');
    expect(result.ok === false && result.bytesRead).toBeGreaterThan(
      TAXONOMY_FETCH_LIMITS.MAX_RESPONSE_BYTES,
    );
    expect(cancelled).toBe(true);
    expect(produced).toBeLessThan(TAXONOMY_FETCH_LIMITS.MAX_RESPONSE_BYTES * 4);
  });

  it('reports a body shorter than a truthful Content-Length as truncated', async () => {
    const fetchFn = vi.fn(
      async () => new Response('1 - Animals\n', { status: 200, headers: { 'content-length': '9999' } }),
    );
    const result = await fetcher({ fetchFn: fetchFn as unknown as typeof fetch }).fetchFile({
      url: 'https://example.test/taxonomy.txt',
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('truncated');
  });

  it('maps the enumerated response conditions onto their distinct reasons', async () => {
    const cases: ReadonlyArray<[() => Response, string]> = [
      [() => new Response('<html><body>Nope</body></html>', { status: 200 }), 'not_taxonomy'],
      [
        () => new Response('id,path', { status: 200, headers: { 'content-type': 'text/html' } }),
        'not_taxonomy',
      ],
      [() => new Response('', { status: 200 }), 'empty'],
      [() => new Response('nope', { status: 404 }), 'not_found'],
      [() => new Response('nope', { status: 410 }), 'not_found'],
      [() => new Response('nope', { status: 503 }), 'http_status'],
    ];
    for (const [make, reason] of cases) {
      const result = await fetcher({
        fetchFn: (async () => make()) as unknown as typeof fetch,
      }).fetchFile({ url: 'https://example.test/taxonomy.txt' });
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.reason, reason).toBe(reason);
    }
  });

  it('reports a transport error as `transport` rather than throwing', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('getaddrinfo ENOTFOUND example.test');
    });
    const result = await fetcher({ fetchFn: fetchFn as unknown as typeof fetch }).fetchFile({
      url: 'https://example.test/taxonomy.txt',
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('transport');
    expect(result.ok === false && result.detail).toContain('ENOTFOUND');
  });

  it('sends no credentials, replays a stored validator and returns the new one', async () => {
    let seen: Headers | undefined;
    const fetchFn = vi.fn(async (_url: unknown, init?: RequestInit) => {
      seen = new Headers(init?.headers);
      return new Response('1 - Animals & Pet Supplies\n', {
        status: 200,
        headers: { etag: 'W/"abc"', 'content-type': 'text/plain' },
      });
    });

    const result = await fetcher({ fetchFn: fetchFn as unknown as typeof fetch }).fetchFile({
      url: 'https://example.test/taxonomy.txt',
      etag: 'W/"old"',
    });

    expect(result.ok).toBe(true);
    expect(result.ok === true && result.etag).toBe('W/"abc"');
    expect(seen?.get('if-none-match')).toBe('W/"old"');
    expect(seen?.get('authorization')).toBeNull();
    expect(seen?.get('cookie')).toBeNull();
    expect(fetchFn.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual', credentials: 'omit' });
  });

  it('treats `304 Not Modified` as an unchanged file rather than an error', async () => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 304 }));
    const result = await fetcher({ fetchFn: fetchFn as unknown as typeof fetch }).fetchFile({
      url: 'https://example.test/taxonomy.txt',
      etag: 'W/"old"',
    });
    expect(result.ok).toBe(true);
    expect(result.ok === true && result.notModified).toBe(true);
  });
});
