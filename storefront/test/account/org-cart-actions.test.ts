import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StorefrontApiError } from '../../lib/api/client';

/**
 * Issue #650 — the approve and reject server actions of
 * `/organization/carts/[id]`. Each answers with a redirect back to the cart:
 * `?done=approved|rejected` on success, `?error=<code>` on a refusal. The code
 * travels, never the sentence, so a crafted link cannot put words on the
 * administrator's page; the page names the code in its own language.
 */
const calls: Array<{ fn: string; cartId: string; reason?: string }> = [];
let refusal: unknown = null;
let session: string | null = 'session';

vi.mock('../../lib/session', () => ({
  getSessionCookie: async () => session,
  getAnonCartCookie: async () => null,
}));
vi.mock('../../lib/server-context', () => ({
  getServerContext: async () => ({ locale: 'en-US', ctx: { locale: 'en-US' } }),
}));
vi.mock('../../lib/i18n/navigation', () => ({
  localeRedirect: async (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));
vi.mock('../../lib/api/cart', () => ({
  approveOrganizationCart: async (_jar: unknown, cartId: string) => {
    calls.push({ fn: 'approve', cartId });
    if (refusal) throw refusal;
  },
  rejectOrganizationCart: async (_jar: unknown, cartId: string, reason: string) => {
    calls.push({ fn: 'reject', cartId, reason });
    if (refusal) throw refusal;
  },
}));

const { approveCartAction, rejectCartAction } = await import(
  '../../app/(account)/organization/carts/[id]/actions'
);

const CART_ID = '00000000-0000-4000-8000-000000000650';

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

async function redirectOf(run: Promise<unknown>): Promise<string> {
  const err = await run.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(Error);
  const match = /^redirect (.*)$/.exec((err as Error).message);
  expect(match, (err as Error).message).not.toBeNull();
  return match![1]!;
}

beforeEach(() => {
  calls.length = 0;
  refusal = null;
  session = 'session';
});

describe('approveCartAction', () => {
  it('approves the cart and says so', async () => {
    const to = await redirectOf(approveCartAction(form({ cartId: CART_ID })));
    expect(calls).toEqual([{ fn: 'approve', cartId: CART_ID }]);
    expect(to).toBe(`/organization/carts/${CART_ID}?done=approved`);
  });

  it("carries the API's refusal code back to the page", async () => {
    refusal = new StorefrontApiError(422, 'CART_APPROVAL_NOT_PENDING', 'This cart is not awaiting approval.');
    const to = await redirectOf(approveCartAction(form({ cartId: CART_ID })));
    expect(to).toBe(`/organization/carts/${CART_ID}?error=CART_APPROVAL_NOT_PENDING`);
  });

  it('reads a failure that is not an API refusal as a generic one', async () => {
    refusal = new Error('ECONNREFUSED');
    const to = await redirectOf(approveCartAction(form({ cartId: CART_ID })));
    expect(to).toBe(`/organization/carts/${CART_ID}?error=FAILED`);
  });

  it('sends a signed-out caller to sign in, calling nothing', async () => {
    session = null;
    expect(await redirectOf(approveCartAction(form({ cartId: CART_ID })))).toBe('/login');
    expect(calls).toEqual([]);
  });

  it('goes back to the list for a form without a cart', async () => {
    expect(await redirectOf(approveCartAction(form({})))).toBe('/organization/carts');
    expect(calls).toEqual([]);
  });
});

describe('rejectCartAction', () => {
  it('rejects with the reason, trimmed, and says so', async () => {
    const to = await redirectOf(rejectCartAction(form({ cartId: CART_ID, reason: '  Over budget \n' })));
    expect(calls).toEqual([{ fn: 'reject', cartId: CART_ID, reason: 'Over budget' }]);
    expect(to).toBe(`/organization/carts/${CART_ID}?done=rejected`);
  });

  it.each(['', '   \n '])('refuses a blank reason without calling the API (%j)', async (reason) => {
    const to = await redirectOf(rejectCartAction(form({ cartId: CART_ID, reason })));
    expect(calls).toEqual([]);
    expect(to).toBe(`/organization/carts/${CART_ID}?error=REASON_REQUIRED`);
  });

  it('refuses a reason longer than the API accepts without calling it', async () => {
    const to = await redirectOf(rejectCartAction(form({ cartId: CART_ID, reason: 'x'.repeat(2001) })));
    expect(calls).toEqual([]);
    expect(to).toBe(`/organization/carts/${CART_ID}?error=REASON_TOO_LONG`);
  });

  it("carries the API's refusal code back to the page", async () => {
    refusal = new StorefrontApiError(404, 'NOT_FOUND', 'cart_not_found');
    const to = await redirectOf(rejectCartAction(form({ cartId: CART_ID, reason: 'No' })));
    expect(to).toBe(`/organization/carts/${CART_ID}?error=NOT_FOUND`);
  });
});
