import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { CartSummary } from '../../lib/api/cart';

/**
 * Issue #619 — a member whose basket must be approved is offered "Submit for
 * approval", not checkout. Since `specs/170-organization-roles/` (FR-031,
 * FR-057) that is the member's **role** — it lacks
 * `carts.order_without_approval` — and the page follows the backend's
 * `primaryCta` alone: there is no Organization flag left to read.
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
let sessionCookie: string | null = 'session';
let permissions: string[] = [];

vi.mock('../../lib/session', () => ({
  getSessionCookie: async () => sessionCookie,
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
    customerAccount: { organizationRole: { id: 'role-1', kind: 'member', name: 'Member' }, permissions },
    // The removed Organization switch, still answered by a stale backend: never read (FR-057).
    organization: { name: 'Acme', canTransact: true, status: 'active', moderationMessage: null, requiresCartApproval: true },
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

const ALL = ['carts.create', 'quote_requests.create', 'shopping_lists.create', 'carts.order_without_approval'];

beforeEach(() => {
  locale = 'en-US';
  cart = 'cart-unavailable';
  sessionCookie = 'session';
  permissions = [...ALL];
});

describe('cart page — submit for approval (issue #619)', () => {
  it.each([
    ['en-US', 'Your role requires approval of this cart before checkout.', 'Submit for approval', 'Proceed to checkout'],
    ['pl-PL', 'Twoja rola wymaga akceptacji koszyka przed realizacją zamówienia.', 'Zgłoś do akceptacji', 'Przejdź do kasy'],
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
    expect(html).toContain('Your cart is awaiting approval in your organization.');
    expect(html).toContain('Awaiting approval');
    expect(html).not.toContain('Submit for approval');
    expect(html).not.toContain('Proceed to checkout');
  });

  it('offers checkout when `primaryCta` says so, whatever a stale Organization flag says', async () => {
    cart = basket({ approvalStatus: 'not_required', primaryCta: 'checkout' });
    const html = await render();
    expect(html).toContain('Proceed to checkout');
    expect(html).not.toContain('Submit for approval');
    expect(html).not.toContain('requires approval');
  });
});

/**
 * `specs/170-organization-roles/` T100 (FR-030, FR-040, FR-047, FR-057; PR-4, R-35) — the cart
 * page's actions follow the member's role; a signed-out visitor keeps editing the guest basket.
 */
describe('cart page — actions per the member’s role', () => {
  const stepper = 'name="step"';
  const removeButton = 'aria-label="Remove"';
  const coupon = 'Coupon code';
  const convert = 'Convert to quote request';
  const saveToList = 'Save to list';
  const readOnly = 'Your role does not allow changing the cart.';

  it('a signed-out visitor still edits the guest basket (PR-4)', async () => {
    sessionCookie = null;
    cart = basket({} as Pick<CartSummary, 'approvalStatus' | 'primaryCta'>);
    const html = await render();
    expect(html).toContain(stepper);
    expect(html).toContain(removeButton);
    expect(html).toContain(coupon);
    expect(html).not.toContain(readOnly);
  });

  it('a member holding every code edits, converts and saves to a list', async () => {
    cart = basket({ approvalStatus: 'not_required', primaryCta: 'checkout' });
    const html = await render();
    expect(html).toContain(stepper);
    expect(html).toContain(removeButton);
    expect(html).toContain(coupon);
    expect(html).toContain(convert);
    expect(html).toContain(saveToList);
    expect(html).not.toContain(readOnly);
  });

  it('without `carts.create` the lines and the coupon are read-only, and the page says why', async () => {
    permissions = ALL.filter((c) => c !== 'carts.create');
    cart = basket({ approvalStatus: 'not_required', primaryCta: 'checkout' });
    const html = await render();
    expect(html).not.toContain(stepper);
    expect(html).not.toContain(removeButton);
    expect(html).not.toContain(coupon);
    expect(html).toContain(readOnly);
    // Reading the basket and ordering it stay open (R-5): the CTA is the backend's.
    expect(html).toContain('Proceed to checkout');
  });

  it('without `quote_requests.create` the cart is not offered as a quote request', async () => {
    permissions = ALL.filter((c) => c !== 'quote_requests.create');
    cart = basket({ approvalStatus: 'not_required', primaryCta: 'checkout' });
    expect(await render()).not.toContain(convert);
  });

  it('without `shopping_lists.create` a line is not offered for a list', async () => {
    permissions = ALL.filter((c) => c !== 'shopping_lists.create');
    cart = basket({ approvalStatus: 'not_required', primaryCta: 'checkout' });
    expect(await render()).not.toContain(saveToList);
  });
});

/**
 * Issue #751 — the subtitle under the heading follows the approval state: a
 * basket that must be sent, or is waiting for an answer, is not "ready for
 * checkout".
 */
describe('cart page — the subtitle follows the approval state (issue #751)', () => {
  it.each([
    ['en-US', 'not_required', 'checkout', '1 item ready for checkout.'],
    ['en-US', 'not_required', 'submit_for_approval', '1 item needs approval before checkout.'],
    ['en-US', 'pending', 'awaiting_approval', '1 item awaiting approval.'],
    ['en-US', 'not_required', 'blocked_by_organization', '1 item in your cart.'],
    ['pl-PL', 'approved', 'checkout', '1 pozycja gotowa do kasy.'],
    ['pl-PL', 'not_required', 'submit_for_approval', '1 pozycja wymaga akceptacji przed przejściem do kasy.'],
    ['pl-PL', 'pending', 'awaiting_approval', '1 pozycja oczekuje na akceptację.'],
    ['pl-PL', 'not_required', 'blocked_by_organization', '1 pozycja w koszyku.'],
  ] as const)('%s, %s / %s', async (l, approvalStatus, primaryCta, subtitle) => {
    locale = l;
    cart = basket({ approvalStatus, primaryCta });
    const html = await render();
    expect(html).toContain(`<p class="mt-1 text-[13px] text-muted">${subtitle}</p>`);
  });
});
