import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { ChannelIdentityRead } from '../../lib/channel/channel-identity';

/**
 * The storefront always tells the backend which sales channel it is on
 * (`specs/154-sales-channel-access/contracts/storefront-ux.md` §1.1–1.3, owner
 * decision D1).
 *
 * Three links in one chain, each tested where it can break:
 *
 *  1. the middleware stamps `x-sales-channel` on the inbound request when no
 *     proxy did, from the channel the backend resolves for this storefront —
 *     and leaves a proxy's value alone;
 *  2. `getServerContext()` therefore always has a code, and falls back to the
 *     channel identity it read if the middleware could not stamp one;
 *  3. the transport (`apiGet`, `apiGetAuthed`, `apiMutate`) sends the stamped
 *     code when its caller passed no context — which is what makes the 128 call
 *     sites without one carry it — and sends nothing, without throwing, outside
 *     a request.
 */

const state: {
  identity: ChannelIdentityRead;
  /** The inbound request headers `next/headers` answers with; `null` = no request scope. */
  requestHeaders: Headers | null;
} = {
  identity: { kind: 'value', value: { code: 'retail', anonymousAccess: true, prefixDefaultLanguage: true, urlLanguages: [], urlLanguageAliases: [] } },
  requestHeaders: null,
};

vi.mock('../../lib/channel/channel-identity', () => ({
  readChannelIdentity: vi.fn(async () => state.identity),
}));
vi.mock('../../lib/seo/crawler-policy', () => ({
  readRobotsPolicy: vi.fn(async () => ({ kind: 'none' })),
}));
// Feature 171 — the middleware's blog routing read: no blog mapping here.
vi.mock('../../lib/blog/blog-routing', () => ({
  readBlogRouting: vi.fn(async () => null),
  blogRouteDecision: vi.fn(() => null),
}));
vi.mock('../../lib/api/backend-reachability', () => ({
  backendReachability: vi.fn(async () => 'reachable'),
}));
vi.mock('next/headers', () => ({
  headers: vi.fn(async () => {
    if (state.requestHeaders === null) {
      throw new Error('`headers` was called outside a request scope.');
    }
    return state.requestHeaders;
  }),
  cookies: vi.fn(async () => ({ get: () => undefined })),
}));
vi.mock('../../lib/api/i18n', () => ({
  getI18nConfig: vi.fn(async () => ({
    defaultLanguageCode: 'en-US',
    languages: [{ code: 'en-US', isActive: true }],
  })),
}));
vi.mock('../../lib/api/module-presence', () => ({
  getModulePresence: vi.fn(async () => ({ isPresent: () => true })),
}));
const channelRead = vi.fn();
vi.mock('../../lib/api/sales-channel', () => ({
  getPublicSalesChannel: (...args: unknown[]) => channelRead(...args),
}));

const { middleware } = await import('../../middleware');
const { readChannelIdentity } = await import('../../lib/channel/channel-identity');
const { getServerContext } = await import('../../lib/server-context');
const { apiGet } = await import('../../lib/api/client');
const { apiGetAuthed, apiMutate } = await import('../../lib/api/mutations');

function forwarded(response: Response): Map<string, string> {
  const names = (response.headers.get('x-middleware-override-headers') ?? '')
    .split(',')
    .filter((name) => name !== '');
  return new Map(
    names.map((name) => [name, response.headers.get(`x-middleware-request-${name}`) ?? '']),
  );
}

const originalFetch = globalThis.fetch;
let sent: Array<Record<string, string>> = [];

beforeEach(() => {
  state.identity = { kind: 'value', value: { code: 'retail', anonymousAccess: true, prefixDefaultLanguage: true, urlLanguages: [], urlLanguageAliases: [] } };
  state.requestHeaders = null;
  sent = [];
  channelRead.mockReset();
  channelRead.mockResolvedValue(null);
  vi.mocked(readChannelIdentity).mockClear();
  globalThis.fetch = vi.fn(async (_url: unknown, init: unknown) => {
    sent.push(((init as { headers?: Record<string, string> }).headers ?? {}) as Record<string, string>);
    return new Response(JSON.stringify({ data: {} }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('the middleware stamps the active channel', () => {
  it('stamps the channel the backend resolves when no proxy named one', async () => {
    const response = await middleware(new NextRequest('http://shop.test/catalog'));
    expect(vi.mocked(readChannelIdentity).mock.calls).toEqual([[undefined]]);
    expect(forwarded(response).get('x-sales-channel')).toBe('retail');
  });

  it('stamps it on files too, so a route handler asks about the same store', async () => {
    const response = await middleware(new NextRequest('http://shop.test/sitemap.xml'));
    expect(forwarded(response).get('x-sales-channel')).toBe('retail');
  });

  it('keeps the value a proxy stamped, and asks about that channel', async () => {
    // A code the identity read does not echo, so an override would show.
    state.identity = { kind: 'value', value: { code: 'resolved-elsewhere', anonymousAccess: true, prefixDefaultLanguage: true, urlLanguages: [], urlLanguageAliases: [] } };
    const response = await middleware(
      new NextRequest('http://shop.test/catalog', { headers: { 'x-sales-channel': 'trade' } }),
    );
    expect(vi.mocked(readChannelIdentity).mock.calls).toEqual([['trade']]);
    // The render reads the proxy's header as it arrived.
    expect(forwarded(response).get('x-sales-channel')).toBe('trade');
  });

  it('stamps nothing when the identity cannot be read, and still serves the page', async () => {
    state.identity = { kind: 'unknown' };
    const response = await middleware(new NextRequest('http://shop.test/catalog'));
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(forwarded(response).has('x-sales-channel')).toBe(false);
  });
});

describe('getServerContext always has a channel code', () => {
  it('takes the stamped request header', async () => {
    state.requestHeaders = new Headers({ 'x-sales-channel': 'retail' });
    const { ctx } = await getServerContext();
    expect(ctx.salesChannelCode).toBe('retail');
    expect(channelRead).toHaveBeenCalledWith({ salesChannelCode: 'retail' });
  });

  it('falls back to the code of the channel it read when nothing was stamped', async () => {
    state.requestHeaders = new Headers();
    channelRead.mockResolvedValue({ code: 'retail', name: 'Retail', anonymousAccess: true });
    const { ctx } = await getServerContext();
    expect(ctx.salesChannelCode).toBe('retail');
  });
});

describe('the transport sends the stamped channel when its caller passed none', () => {
  beforeEach(() => {
    state.requestHeaders = new Headers({ 'x-sales-channel': 'retail' });
  });

  it('apiGet', async () => {
    await apiGet('/api/v1/catalog/products');
    expect(sent[0]!['X-Sales-Channel']).toBe('retail');
  });

  it('apiGetAuthed', async () => {
    await apiGetAuthed({ path: '/api/v1/me', sessionCookie: 's' });
    expect(sent[0]!['X-Sales-Channel']).toBe('retail');
  });

  it('apiMutate', async () => {
    await apiMutate({ method: 'POST', path: '/api/v1/cart/items', body: {} });
    expect(sent[0]!['X-Sales-Channel']).toBe('retail');
  });

  it('a caller’s explicit channel wins over the stamped one', async () => {
    await apiGet('/api/v1/catalog/products', { salesChannelCode: 'trade' });
    await apiMutate({ method: 'POST', path: '/x', ctx: { salesChannelCode: 'trade' } });
    expect(sent.map((h) => h['X-Sales-Channel'])).toEqual(['trade', 'trade']);
  });
});

describe('outside a request', () => {
  it('sends no channel and does not throw', async () => {
    state.requestHeaders = null;
    await apiGet('/api/v1/catalog/products');
    await apiGetAuthed({ path: '/api/v1/me', sessionCookie: 's' });
    await apiMutate({ method: 'POST', path: '/x', body: {} });
    expect(sent).toHaveLength(3);
    for (const headers of sent) expect(headers).not.toHaveProperty('X-Sales-Channel');
  });
});
