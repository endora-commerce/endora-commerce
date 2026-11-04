import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { ChannelUrlLanguage } from '@endora-commerce/contracts';
import type { RobotsPolicyRead } from '../../lib/seo/crawler-policy';
import type { ReachabilityVerdict } from '../../lib/api/backend-reachability';
import type { ChannelIdentity, ChannelIdentityRead } from '../../lib/channel/channel-identity';

/**
 * Feature 167 — the middleware's language handling, run through the exported
 * `middleware()` with its backend questions replaced
 * (`specs/167-storefront-locale-path/contracts/url-shape.md` §3–§6, FR-010…FR-019).
 * The decisions themselves are tabled in `locale-path.test.ts`; this holds what the
 * middleware does with them: status, `Location`, `Vary`, `Cache-Control`, the rewrite,
 * the forwarded headers, and the ordering with the outage gate and the closed store.
 */

const state: { reachability: ReachabilityVerdict; identity: ChannelIdentityRead } = {
  reachability: 'reachable',
  identity: { kind: 'unknown' },
};

vi.mock('../../lib/seo/crawler-policy', () => ({
  readRobotsPolicy: vi.fn(async (): Promise<RobotsPolicyRead> => ({ kind: 'none' })),
}));
vi.mock('../../lib/channel/channel-identity', () => ({
  readChannelIdentity: vi.fn(async () => state.identity),
}));
// Feature 171 — the middleware's blog routing read: no blog mapping here.
vi.mock('../../lib/blog/blog-routing', () => ({
  readBlogRouting: vi.fn(async () => null),
  blogRouteDecision: vi.fn(() => null),
}));
vi.mock('../../lib/api/backend-reachability', () => ({
  backendReachability: vi.fn(async () => state.reachability),
}));

const { middleware } = await import('../../middleware');

const plEn = (on: boolean): ChannelUrlLanguage[] => [
  { languageCode: 'pl-PL', prefix: 'pl', prefixed: on, isDefault: true },
  { languageCode: 'en-US', prefix: 'en', prefixed: true, isDefault: false },
];

function channel(on: boolean, extra: Partial<ChannelIdentity> = {}): ChannelIdentityRead {
  return {
    kind: 'value',
    value: {
      code: 'b2b',
      anonymousAccess: true,
      prefixDefaultLanguage: on,
      urlLanguages: plEn(on),
      urlLanguageAliases: [],
      ...extra,
    },
  };
}

function request(path: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://shop.test${path}`, { headers });
}

function forwarded(response: Response): Map<string, string> {
  const names = (response.headers.get('x-middleware-override-headers') ?? '')
    .split(',')
    .filter((name) => name !== '');
  return new Map(names.map((name) => [name, response.headers.get(`x-middleware-request-${name}`) ?? '']));
}

beforeEach(() => {
  state.reachability = 'reachable';
  state.identity = channel(true);
});

describe('setting on — an unprefixed document', () => {
  it('answers 307 to the negotiated language, varying on Accept-Language and Cookie, never shared-cached', async () => {
    const response = await middleware(request('/', { 'accept-language': 'en' }));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://shop.test/en');
    expect(response.headers.get('vary')).toBe('Accept-Language, Cookie');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('reads the lang cookie for the 307 (OR-11), keeps the query minus lang', async () => {
    const response = await middleware(
      request('/c/narzedzia?sort=price&lang=xx', { 'accept-language': 'pl', cookie: 'lang=en-US' }),
    );
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://shop.test/en/c/narzedzia?sort=price');
  });
});

describe('setting off', () => {
  beforeEach(() => {
    state.identity = channel(false);
  });

  it('answers the default prefix with 308 and a bounded cache', async () => {
    const response = await middleware(request('/pl/c/x?a=1'));
    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe('http://shop.test/c/x?a=1');
    expect(response.headers.get('cache-control')).toBe('public, max-age=3600');
  });

  it('renders the default language unprefixed, ignoring the cookie and Accept-Language', async () => {
    const response = await middleware(request('/c/x', { 'accept-language': 'en', cookie: 'lang=en-US' }));
    expect(response.headers.get('x-middleware-next')).toBe('1');
    const h = forwarded(response);
    expect(h.get('x-storefront-language')).toBe('pl-PL');
    expect(h.get('x-storefront-language-prefix')).toBe('');
    expect(h.get('x-pathname')).toBe('/c/x');
  });
});

describe('a prefixed document', () => {
  it('is rewritten to the logical path with the language forwarded (FR-010)', async () => {
    const response = await middleware(
      request('/en/p/drill?variant=A', { 'accept-language': 'pl', cookie: 'lang=pl-PL' }),
    );
    expect(response.headers.get('x-middleware-rewrite')).toBe('http://shop.test/p/drill?variant=A');
    const h = forwarded(response);
    expect(h.get('x-storefront-language')).toBe('en-US');
    expect(h.get('x-storefront-language-prefix')).toBe('en');
    expect(h.get('x-pathname')).toBe('/p/drill');
  });

  it('answers a mixed-case prefix with 308 to the lower-case one (FR-014)', async () => {
    const response = await middleware(request('/EN/c/x'));
    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe('http://shop.test/en/c/x');
  });

  it("treats another channel's prefix as an ordinary path (XII, OR-12)", async () => {
    const response = await middleware(request('/de/x'));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://shop.test/pl/de/x');
  });
});

describe('headers a client sent are never trusted (FR-018)', () => {
  const spoofed = { 'x-storefront-language': 'en-US', 'x-storefront-language-prefix': 'en' };

  it('deletes them on a language-neutral path', async () => {
    const response = await middleware(request('/api/revalidate', spoofed));
    expect(response.status).not.toBe(307);
    const h = forwarded(response);
    expect(h.has('x-storefront-language')).toBe(false);
    expect(h.has('x-storefront-language-prefix')).toBe(false);
  });

  it('deletes them when the channel identity is unknown', async () => {
    state.identity = { kind: 'unknown' };
    const response = await middleware(request('/c/x', spoofed));
    const h = forwarded(response);
    expect(h.has('x-storefront-language')).toBe(false);
  });

  it('overwrites them on a render', async () => {
    const response = await middleware(request('/pl/c/x', spoofed));
    expect(forwarded(response).get('x-storefront-language')).toBe('pl-PL');
  });
});

describe('language-neutral and non-document paths (FR-016)', () => {
  it.each(['/robots.txt', '/api/v1/x', '/offline', '/pwa/config', '/sitemap.xml'])('%s is not redirected', async (path) => {
    const response = await middleware(request(path, { 'accept-language': 'en' }));
    expect([307, 308]).not.toContain(response.status);
    expect(response.headers.get('x-middleware-rewrite')).toBeNull();
  });
});

describe('ordering with the outage gate and the closed store (FR-017)', () => {
  it('answers 503 at the requested URL with no language redirect first', async () => {
    state.reachability = 'unreachable';
    const response = await middleware(request('/', { 'accept-language': 'en' }));
    expect(response.status).toBe(503);
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('x-middleware-rewrite')).toBe('http://shop.test/service-unavailable');
  });

  it('gives the outage notice the path language when the prefix parses', async () => {
    state.reachability = 'unreachable';
    const response = await middleware(request('/en/p/drill', { 'accept-language': 'pl' }));
    expect(response.status).toBe(503);
    expect(forwarded(response).get('x-storefront-language')).toBe('en-US');
  });

  it('sends an anonymous visitor of a closed store to the prefixed sign-in in one hop', async () => {
    state.identity = channel(true, { anonymousAccess: false });
    const response = await middleware(request('/'));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://shop.test/pl/login?next=%2Fpl&reason=sign-in-required');
  });

  it('localizes the sign-in target of a prefixed request on a closed store', async () => {
    state.identity = channel(false, { anonymousAccess: false });
    const response = await middleware(request('/en/c/x'));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'http://shop.test/en/login?next=%2Fen%2Fc%2Fx&reason=sign-in-required',
    );
  });
});

describe('without a channel identity (FR-019)', () => {
  it('issues no language redirect', async () => {
    state.identity = { kind: 'unknown' };
    const response = await middleware(request('/', { 'accept-language': 'en' }));
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('issues none for an identity from a backend without URL languages', async () => {
    state.identity = channel(true, { urlLanguages: [] });
    const response = await middleware(request('/', { 'accept-language': 'en' }));
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });
});
