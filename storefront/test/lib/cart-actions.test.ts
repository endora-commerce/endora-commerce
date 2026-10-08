import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The header cart count and the quick add-to-cart are answered for the buyer's
 * *storefront* cart identity.
 *
 * `b2b_session` and `b2b_cart_anon` are httpOnly cookies scoped to the
 * storefront origin (`lib/session.ts`). A browser `fetch` to the backend origin
 * never carries them, so wherever the two origins are different hosts the
 * backend answered the header's count read for an anonymous caller — `0` — and
 * the badge overwrote the correct server-rendered count with it. These actions
 * are the same-origin path: they read the storefront cookies and forward them.
 */

const jar = new Map<string, string>();
const setCalls: Array<{ name: string; value: string }> = [];

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => {
      setCalls.push({ name, value });
      jar.set(name, value);
    },
    delete: (name: string) => {
      jar.delete(name);
    },
  }),
}));

const { getCartItemCountAction, addProductToCartAction } = await import(
  '../../lib/actions/cart'
);

const originalFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  cookie: string | null;
  body: unknown;
}

function stubFetch(
  respond: (req: Recorded) => { status?: number; body: unknown; setCookie?: string },
): Recorded[] {
  const seen: Recorded[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const req: Recorded = {
      url: String(input),
      method: init?.method ?? 'GET',
      cookie: headers.get('cookie'),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
    };
    seen.push(req);
    const answer = respond(req);
    const responseHeaders = new Headers({ 'content-type': 'application/json' });
    if (answer.setCookie) responseHeaders.append('set-cookie', answer.setCookie);
    return new Response(JSON.stringify(answer.body), {
      status: answer.status ?? 200,
      headers: responseHeaders,
    });
  }) as unknown as typeof fetch;
  return seen;
}

beforeEach(() => {
  jar.clear();
  setCalls.length = 0;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('getCartItemCountAction', () => {
  it('reads the count with the anonymous cart cookie held on the storefront origin', async () => {
    jar.set('b2b_cart_anon', 'anon-token');
    const seen = stubFetch(() => ({ body: { data: { itemCount: 3 } } }));

    await expect(getCartItemCountAction()).resolves.toBe(3);

    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe('http://api.test/api/v1/cart?view=mini');
    expect(seen[0]!.cookie).toBe('b2b_cart_anon=anon-token');
  });

  it('reads the count with the session cookie of a signed-in buyer', async () => {
    jar.set('b2b_session', 'sess');
    jar.set('b2b_cart_anon', 'anon-token');
    const seen = stubFetch(() => ({ body: { data: { itemCount: 7 } } }));

    await expect(getCartItemCountAction()).resolves.toBe(7);
    expect(seen[0]!.cookie).toBe('b2b_session=sess; b2b_cart_anon=anon-token');
  });

  it('answers 0 without asking the backend when the buyer has no cart identity yet', async () => {
    const seen = stubFetch(() => ({ body: { data: { itemCount: 99 } } }));

    await expect(getCartItemCountAction()).resolves.toBe(0);
    expect(seen).toHaveLength(0);
  });
});

describe('addProductToCartAction', () => {
  it('persists the cart cookie minted on the first add, so the count read finds that cart', async () => {
    const seen = stubFetch((req) =>
      req.method === 'POST'
        ? {
            status: 201,
            body: { data: { id: 'c1', items: [], itemCount: 1 } },
            setCookie: 'b2b_cart_anon=minted; Path=/; HttpOnly; SameSite=Lax',
          }
        : { body: { data: { itemCount: req.cookie === 'b2b_cart_anon=minted' ? 1 : 0 } } },
    );

    await expect(addProductToCartAction({ productId: 'p1', quantity: 1 })).resolves.toEqual({
      ok: true,
    });

    expect(seen[0]!.url).toBe('http://api.test/api/v1/cart/items');
    expect(seen[0]!.cookie).toBeNull();
    expect(seen[0]!.body).toEqual({ productId: 'p1', quantity: 1 });
    expect(setCalls).toEqual([{ name: 'b2b_cart_anon', value: 'minted' }]);

    // The first add is the case the report is about: the very next count read
    // must be for the cart that add created.
    await expect(getCartItemCountAction()).resolves.toBe(1);
  });

  it('adds to the existing cart and mints nothing on a later add', async () => {
    jar.set('b2b_cart_anon', 'anon-token');
    const seen = stubFetch(() => ({ body: { data: { id: 'c1', items: [], itemCount: 2 } } }));

    await expect(addProductToCartAction({ productId: 'p2', quantity: 4 })).resolves.toEqual({
      ok: true,
    });
    expect(seen[0]!.cookie).toBe('b2b_cart_anon=anon-token');
    expect(seen[0]!.body).toEqual({ productId: 'p2', quantity: 4 });
    expect(setCalls).toEqual([]);
  });

  it("reports the backend's refusal with its message instead of throwing", async () => {
    stubFetch(() => ({
      status: 409,
      body: { error: { code: 'OUT_OF_STOCK', message: 'Not enough stock.' } },
    }));

    await expect(addProductToCartAction({ productId: 'p1', quantity: 1 })).resolves.toEqual({
      ok: false,
      message: 'Not enough stock.',
    });
  });

  it('refuses a malformed request without calling the backend', async () => {
    const seen = stubFetch(() => ({ body: {} }));

    await expect(addProductToCartAction({ productId: '  ', quantity: 1 })).resolves.toEqual({
      ok: false,
      message: null,
    });
    await expect(addProductToCartAction({ productId: 'p1', quantity: 0 })).resolves.toEqual({
      ok: false,
      message: null,
    });
    expect(seen).toHaveLength(0);
  });
});
