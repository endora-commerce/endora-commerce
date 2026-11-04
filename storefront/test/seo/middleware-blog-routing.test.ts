import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { BlogRouting, ChannelUrlLanguage } from '@endora-commerce/contracts';
import type { RobotsPolicyRead } from '../../lib/seo/crawler-policy';
import type { ChannelIdentityRead } from '../../lib/channel/channel-identity';

/**
 * Feature 171 (`specs/171-blog-i18n-authors/contracts/routing-and-settings.md` §2,
 * FR-001/FR-003, T015) — the middleware maps the operator's blog prefix onto the fixed
 * `app/blog` route, after feature 167's language parse: the current prefix is rewritten,
 * `/blog` and a former prefix answer 301 to the current one, and with no routing known
 * every path is left as it was.
 */

const state: { identity: ChannelIdentityRead; routing: BlogRouting | null } = {
  identity: { kind: 'unknown' },
  routing: null,
};

vi.mock('../../lib/seo/crawler-policy', async (importActual) => ({
  ...(await importActual<typeof import('../../lib/seo/crawler-policy')>()),
  readRobotsPolicy: vi.fn(async (): Promise<RobotsPolicyRead> => ({ kind: 'none' })),
}));
vi.mock('../../lib/channel/channel-identity', () => ({
  readChannelIdentity: vi.fn(async () => state.identity),
}));
vi.mock('../../lib/api/backend-reachability', () => ({
  backendReachability: vi.fn(async () => 'reachable'),
}));
vi.mock('../../lib/blog/blog-routing', async (importActual) => ({
  ...(await importActual<typeof import('../../lib/blog/blog-routing')>()),
  readBlogRouting: vi.fn(async () => state.routing),
}));

const { middleware } = await import('../../middleware');

const plEn = (on: boolean): ChannelUrlLanguage[] => [
  { languageCode: 'pl-PL', prefix: 'pl', prefixed: on, isDefault: true },
  { languageCode: 'en-US', prefix: 'en', prefixed: true, isDefault: false },
];

function channel(on: boolean): ChannelIdentityRead {
  return {
    kind: 'value',
    value: {
      code: 'b2b',
      anonymousAccess: true,
      prefixDefaultLanguage: on,
      urlLanguages: plEn(on),
      urlLanguageAliases: [],
    },
  };
}

function routing(prefix: string, extra: Partial<BlogRouting> = {}): BlogRouting {
  return { defaultPrefix: prefix, prefixes: { 'pl-PL': prefix, 'en-US': prefix }, formerPrefixes: [], ...extra };
}

function request(path: string): NextRequest {
  return new NextRequest(`http://shop.test${path}`);
}

function forwarded(response: Response): Map<string, string> {
  const names = (response.headers.get('x-middleware-override-headers') ?? '')
    .split(',')
    .filter((name) => name !== '');
  return new Map(names.map((name) => [name, response.headers.get(`x-middleware-request-${name}`) ?? '']));
}

beforeEach(() => {
  state.identity = channel(true);
  state.routing = routing('aktualnosci');
});

describe('a custom prefix', () => {
  it('rewrites the prefix to the blog route, keeping the query and the language', async () => {
    const response = await middleware(request('/pl/aktualnosci/porady?page=2'));
    expect(response.headers.get('x-middleware-rewrite')).toBe('http://shop.test/blog/porady?page=2');
    const h = forwarded(response);
    expect(h.get('x-storefront-language')).toBe('pl-PL');
    // The public path, for everything that reads where the visitor is.
    expect(h.get('x-pathname')).toBe('/aktualnosci/porady');
  });

  it('rewrites the index', async () => {
    const response = await middleware(request('/en/aktualnosci'));
    expect(response.headers.get('x-middleware-rewrite')).toBe('http://shop.test/blog');
  });

  it('answers /blog with 301 to the same view under the prefix, in the same language', async () => {
    const response = await middleware(request('/pl/blog/porady?page=2'));
    expect(response.status).toBe(301);
    expect(response.headers.get('location')).toBe('http://shop.test/pl/aktualnosci/porady?page=2');
  });

  it('answers a former prefix with 301 to the current one', async () => {
    state.routing = routing('aktualnosci', { formerPrefixes: [{ languageCode: null, prefix: 'wiadomosci' }] });
    const response = await middleware(request('/en/wiadomosci/news-1'));
    expect(response.status).toBe(301);
    expect(response.headers.get('location')).toBe('http://shop.test/en/aktualnosci/news-1');
  });

  it('leaves a path that only starts with the prefix’s letters alone', async () => {
    const response = await middleware(request('/pl/aktualnosci-archiwum'));
    expect(response.headers.get('x-middleware-rewrite')).toBe('http://shop.test/aktualnosci-archiwum');
  });

  it('rewrites an unprefixed default-language path when the channel does not prefix it', async () => {
    state.identity = channel(false);
    const response = await middleware(request('/aktualnosci/porady'));
    expect(response.headers.get('x-middleware-rewrite')).toBe('http://shop.test/blog/porady');
    expect(forwarded(response).get('x-storefront-language')).toBe('pl-PL');
  });

  it('uses the prefix of the request language', async () => {
    state.routing = { defaultPrefix: 'aktualnosci', prefixes: { 'pl-PL': 'aktualnosci', 'en-US': 'news' }, formerPrefixes: [] };
    expect((await middleware(request('/en/news/x'))).headers.get('x-middleware-rewrite')).toBe('http://shop.test/blog/x');
    const moved = await middleware(request('/en/aktualnosci/x'));
    expect(moved.status).toBe(301);
    expect(moved.headers.get('location')).toBe('http://shop.test/en/news/x');
  });
});

describe('no mapping', () => {
  it('leaves every path alone when there is no blog routing', async () => {
    state.routing = null;
    expect((await middleware(request('/pl/aktualnosci/x'))).headers.get('x-middleware-rewrite')).toBe(
      'http://shop.test/aktualnosci/x',
    );
    expect((await middleware(request('/pl/blog/x'))).headers.get('x-middleware-rewrite')).toBe('http://shop.test/blog/x');
  });

  it('serves /blog as before when the prefix is blog', async () => {
    state.routing = routing('blog');
    const response = await middleware(request('/pl/blog/x'));
    expect(response.status).not.toBe(301);
    expect(response.headers.get('x-middleware-rewrite')).toBe('http://shop.test/blog/x');
  });
});
