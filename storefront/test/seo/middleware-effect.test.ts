import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { RobotsPolicyRead } from '../../lib/seo/crawler-policy';
import type { ReachabilityVerdict } from '../../lib/api/backend-reachability';
import type { ChannelIdentityRead } from '../../lib/channel/channel-identity';

/**
 * What the middleware *does* with its decisions
 * (`specs/144-seo-search-engine-robots/contracts/crawler-policy.md` §6).
 *
 * `middleware-robots.test.ts` holds the decisions as pure functions. This runs
 * the function itself, with its two questions for the backend replaced, and
 * reads the `NextResponse` it builds — because the two mistakes that matter
 * most here are not in any pure function: gating a file as if it were a page
 * (an image answered with the outage notice), and returning before the
 * directive is stamped.
 *
 * It reads Next's own response protocol, which is what a `NextResponse` is
 * until the server interprets it: `x-middleware-next` for "carry on",
 * `x-middleware-rewrite` for a rewrite, and `x-middleware-request-<name>` plus
 * `x-middleware-override-headers` for the request headers handed to the render.
 * The served effect is still measured on a built storefront
 * (`test/conformance/robots-directive.spec.ts`).
 */

const state: {
  policy: RobotsPolicyRead;
  reachability: ReachabilityVerdict;
  probes: number;
  identity: ChannelIdentityRead;
} = {
  policy: { kind: 'none' },
  reachability: 'reachable',
  probes: 0,
  identity: { kind: 'value', value: { code: 'retail', anonymousAccess: true, prefixDefaultLanguage: true, urlLanguages: [], urlLanguageAliases: [] } },
};

vi.mock('../../lib/seo/crawler-policy', () => ({
  readRobotsPolicy: vi.fn(async () => state.policy),
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
  backendReachability: vi.fn(async () => {
    state.probes += 1;
    return state.reachability;
  }),
}));

const { middleware } = await import('../../middleware');
const { readRobotsPolicy } = await import('../../lib/seo/crawler-policy');

const NOINDEX: RobotsPolicyRead = { kind: 'value', value: { index: false, follow: false } };

function request(path: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://shop.test${path}`, { headers });
}

/** The request headers the render will see, as the middleware overrode them. */
function forwarded(response: Response): Map<string, string> {
  const names = (response.headers.get('x-middleware-override-headers') ?? '')
    .split(',')
    .filter((name) => name !== '');
  return new Map(
    names.map((name) => [name, response.headers.get(`x-middleware-request-${name}`) ?? '']),
  );
}

beforeEach(() => {
  state.policy = { kind: 'none' };
  state.reachability = 'reachable';
  state.probes = 0;
  state.identity = { kind: 'value', value: { code: 'retail', anonymousAccess: true, prefixDefaultLanguage: true, urlLanguages: [], urlLanguageAliases: [] } };
  vi.mocked(readRobotsPolicy).mockClear();
});

describe('a document', () => {
  it('carries the directive as a header and hands it to the render', async () => {
    state.policy = NOINDEX;
    const response = await middleware(request('/p/pump'));
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    expect(forwarded(response).get('x-robots-default')).toBe('noindex, nofollow');
    expect(forwarded(response).get('x-pathname')).toBe('/p/pump');
  });

  it.each([
    ['there is no policy', { kind: 'none' }],
    ['the policy is unknown', { kind: 'unknown' }],
    ['the policy restricts nothing', { kind: 'value', value: { index: true, follow: true } }],
  ] as const)('carries no header and forwards no directive when %s', async (_label, policy) => {
    state.policy = policy;
    const response = await middleware(
      request('/cart', { 'x-robots-default': 'noindex, nofollow' }),
    );
    expect(response.headers.has('X-Robots-Tag')).toBe(false);
    // The client's own header is gone from what the render sees.
    expect(forwarded(response).has('x-robots-default')).toBe(false);
    expect(forwarded(response).get('x-pathname')).toBe('/cart');
  });

  it('is asked about for the channel the request names', async () => {
    await middleware(request('/', { 'x-sales-channel': 'pl_retail' }));
    await middleware(request('/'));
    expect(vi.mocked(readRobotsPolicy).mock.calls).toEqual([['pl_retail'], [undefined]]);
  });

  it('is still gated on reachability, and the outage notice carries the directive', async () => {
    state.policy = NOINDEX;
    state.reachability = 'unreachable';
    const response = await middleware(request('/p/pump'));
    expect(response.status).toBe(503);
    expect(response.headers.get('x-middleware-rewrite')).toContain('/service-unavailable');
    expect(response.headers.get('Retry-After')).toBe('60');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    expect(forwarded(response).get('x-robots-default')).toBe('noindex, nofollow');
    expect(forwarded(response).get('x-backend-unreachable')).toBe('1');
  });

  it('answers the outage notice without a directive when none was ever known', async () => {
    state.policy = { kind: 'unknown' };
    state.reachability = 'unreachable';
    const response = await middleware(request('/'));
    expect(response.status).toBe(503);
    expect(response.headers.has('X-Robots-Tag')).toBe(false);
    expect(forwarded(response).has('x-robots-default')).toBe(false);
  });
});

describe('a file, for the channel the request names', () => {
  it('is asked about for that channel, not for the system default', async () => {
    // Every file of every channel goes through this branch. Reading the policy
    // without the channel here would serve one channel's directive — or its
    // absence — on all the others' files.
    await middleware(request('/icons/icon-192.png', { 'x-sales-channel': 'pl_retail' }));
    await middleware(request('/sitemap.xml', { 'x-sales-channel': 'pl_b2b_vip' }));
    await middleware(request('/service-worker.js'));
    expect(vi.mocked(readRobotsPolicy).mock.calls).toEqual([
      ['pl_retail'],
      ['pl_b2b_vip'],
      [undefined],
    ]);
  });
});

describe.each([
  '/icons/icon-192.png',
  '/service-worker.js',
  '/sitemap.xml',
  '/robots.txt',
  '/llms.txt',
  '/manifest.webmanifest',
  '/_next/image',
])('the file %s', (path) => {
  it('carries the directive as a header', async () => {
    state.policy = NOINDEX;
    const response = await middleware(request(path));
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
  });

  it('is never gated: no probe, no rewrite, no 503 — even with the backend down', async () => {
    state.policy = NOINDEX;
    state.reachability = 'unreachable';
    const response = await middleware(request(path));
    expect(state.probes).toBe(0);
    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(response.headers.has('x-middleware-rewrite')).toBe(false);
  });

  it('is not labelled as a page', async () => {
    const response = await middleware(request(path));
    expect(forwarded(response).has('x-pathname')).toBe(false);
  });

  it('carries nothing at all when the policy restricts nothing', async () => {
    const response = await middleware(request(path, { 'x-robots-default': 'noindex' }));
    expect(response.headers.has('X-Robots-Tag')).toBe(false);
    // A missing file is answered by the not-found page, which the root layout
    // renders: the client's header must not reach it either.
    expect(forwarded(response).has('x-robots-default')).toBe(false);
  });
});

/**
 * A store closed to anonymous visitors
 * (`specs/154-sales-channel-access/contracts/storefront-ux.md` §2, FR-027).
 *
 * The backend refuses every catalogue and content read of such a store to a
 * caller without a session, so a page rendered anyway is an empty shop. The
 * middleware sends the visitor to the sign-in page instead, keeping the page
 * they asked for — and leaves alone everything a visitor needs to become a
 * signed-in customer, and everything that is not a page.
 */
describe('a store closed to anonymous visitors', () => {
  const CLOSED: ChannelIdentityRead = {
    kind: 'value',
    value: { code: 'trade', anonymousAccess: false, prefixDefaultLanguage: true, urlLanguages: [], urlLanguageAliases: [] },
  };

  it.each(['/', '/catalog', '/p/pump', '/c/valves', '/cart', '/checkout', '/register-customer', '/compare'])(
    'redirects %s to the sign-in page, keeping the page asked for',
    async (path) => {
      state.identity = CLOSED;
      const response = await middleware(request(`${path}?view=list`));
      expect(response.status).toBe(307);
      const target = new URL(response.headers.get('location')!);
      expect(target.pathname).toBe('/login');
      expect(target.searchParams.get('next')).toBe(`${path}?view=list`);
      expect(target.searchParams.get('reason')).toBe('sign-in-required');
    },
  );

  it.each([
    '/login',
    '/login/mfa',
    '/login/setup',
    '/register',
    '/password-reset/request',
    '/password-reset/confirm',
    '/verify',
    '/invitations/abc/accept',
    '/auth/email-verification',
    '/session-expired',
    '/service-unavailable',
    '/offline',
    '/pwa/config',
    '/api/revalidate',
    '/newsletter/confirm',
    '/newsletter/unsubscribe',
  ])('lets %s through', async (path) => {
    state.identity = CLOSED;
    const response = await middleware(request(path));
    // `/service-unavailable` answers its own 503 by design; what matters here is
    // that nothing sends the visitor to the sign-in page.
    expect(response.headers.has('location')).toBe(false);
    expect(response.status).not.toBe(307);
  });

  it.each(['/robots.txt', '/llms.txt', '/sitemap.xml', '/manifest.webmanifest', '/icons/icon-192.png'])(
    'never redirects the file %s',
    async (path) => {
      state.identity = CLOSED;
      const response = await middleware(request(path));
      expect(response.headers.has('location')).toBe(false);
      expect(response.headers.get('x-middleware-next')).toBe('1');
    },
  );

  it('lets a visitor with a session through — the backend decides whether their account may shop here', async () => {
    state.identity = CLOSED;
    const response = await middleware(request('/catalog', { cookie: 'b2b_session=abc' }));
    expect(response.headers.has('location')).toBe(false);
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('does not redirect on an open store', async () => {
    const response = await middleware(request('/catalog'));
    expect(response.headers.has('location')).toBe(false);
  });

  it('does not redirect when the channel cannot be read — an open store must not be locked', async () => {
    state.identity = { kind: 'unknown' };
    const response = await middleware(request('/catalog'));
    expect(response.headers.has('location')).toBe(false);
  });

  it('answers the outage first: an unreachable backend is a 503, not a sign-in page', async () => {
    state.identity = CLOSED;
    state.reachability = 'unreachable';
    const response = await middleware(request('/catalog'));
    expect(response.status).toBe(503);
  });

  it('carries the channel directive on the redirect', async () => {
    state.identity = CLOSED;
    state.policy = NOINDEX;
    const response = await middleware(request('/catalog'));
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
  });
});
