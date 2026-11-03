import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { CartSummary } from '../../lib/api/cart';

/**
 * Issue #619 — a member of an Organization that requires cart approval is
 * offered "Submit for approval", not checkout.
 *
 * The backend says so with `primaryCta: 'submit_for_approval'` on a
 * `not_required` basket. The page used to decide "the policy is on" from the
 * approval state alone, which is `not_required` exactly when the basket has
 * not been sent yet — so the banner asking the buyer to submit could never be
 * shown. The page is awaited and rendered with its reads mocked, as in
 * `cart-page-locale.test.tsx`.
 */
let locale = 'en-US';
let cart: CartSummary | 'cart-unavailable' = 'cart-unavailable';

vi.mock('../../lib/session', () => ({
  getSessionCookie: async () => 'session',
  getAnonCartCookie: async () => null,
  setAnonCartCookie: async () => undefined,
}));
vi.mock('../../lib/server-context', () => ({
  getServerContext: async () => ({ locale, ctx: {} }),
}));
vi.mock('../../lib/api/cart', () => ({
  CART_UNAVAILABLE: 'cart-unavailable',
  getCart: async () => (cart === 'cart-unavailable' ? cart : { cart }),
  getCartUpsells: async () => [],
  touchCart: async () => undefined,
  removeCartItem: async () => ({}),
  updateCartItem: async () => ({}),
  applyCartCoupon: async () => ({}),
  clearCartCoupon: async () => undefined,
  convertCartToQuoteRequest: async () => ({}),
  submitCartForApproval: async () => undefined,
  saveCartItemToShoppingList: async () => undefined,
}));
vi.mock('../../lib/api/shopping-lists', () => ({ listShoppingLists: async () => [] }));
vi.mock('../../lib/api/account', () => ({
  getMe: async () => ({
    customerAccount: { role: 'regular_user' },
    organization: { name: 'Acme', canTransact: true, status: 'active', moderationMessage: null },
  }),
}));
vi.mock('../../lib/api/pricing', () => ({
  PRICING_UNAVAILABLE: 'pricing-unavailable',
  getProductDisplayMode: async () => ({ displayMode: 'net_only' }),
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));

const { default: CartPage } = await import('../../app/(commerce)/cart/page');

function basket(state: Pick<CartSummary, 'approvalStatus' | 'primaryCta'>): CartSummary {
  return {
    id: 'c1',
    customerAccountId: 'member-1',
    organizationId: 'org-1',
    anonymousCartToken: null,
    items: [
      {
        id: 'l1',
        productId: 'p1',
        variantId: null,
        quantity: 1,
        unitPrice: { amount: 10, currency: 'PLN' },
        productName: 'Bolt',
        productSku: 'BOLT-1',
      },
    ],
    itemCount: 1,
    subtotal: { amount: 10, currency: 'PLN' },
    status: 'active',
    ...state,
  };
}

async function render(): Promise<string> {
  const tree = await CartPage({ searchParams: Promise.resolve({}) });
  return renderToString(<>{tree}</>).replaceAll('<!-- -->', '');
}

beforeEach(() => {
  locale = 'en-US';
  cart = 'cart-unavailable';
});

describe('cart page — submit for approval (issue #619)', () => {
  it.each([
    ['en-US', 'Your organization requires cart approval before checkout.', 'Submit for approval', 'Proceed to checkout'],
    ['pl-PL', 'Twoja organizacja wymaga akceptacji koszyka przed realizacją.', 'Zgłoś do akceptacji', 'Przejdź do kasy'],
  ])('offers the submit, not checkout, for a basket that must be sent (%s)', async (l, banner, submit, checkout) => {
    locale = l;
    cart = basket({ approvalStatus: 'not_required', primaryCta: 'submit_for_approval' });
    const html = await render();
    expect(html).toContain(banner);
    expect(html).toContain(submit);
    expect(html).toContain('type="submit"');
    expect(html).not.toContain(checkout);
  });

  it('shows the pending notice and no submit once the basket is sent', async () => {
    cart = basket({ approvalStatus: 'pending', primaryCta: 'awaiting_approval' });
    const html = await render();
    expect(html).toContain('Your cart is awaiting approval by an organization administrator.');
    expect(html).toContain('Awaiting approval');
    expect(html).not.toContain('Submit for approval');
    expect(html).not.toContain('Proceed to checkout');
  });

  it('offers checkout for a basket of an Organization that requires no approval', async () => {
    cart = basket({ approvalStatus: 'not_required', primaryCta: 'checkout' });
    const html = await render();
    expect(html).toContain('Proceed to checkout');
    expect(html).not.toContain('Submit for approval');
    expect(html).not.toContain('requires cart approval');
  });
});
