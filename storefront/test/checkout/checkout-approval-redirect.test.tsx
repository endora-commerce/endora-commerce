import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { CartSummary } from '../../lib/api/cart';

/**
 * Issue #750 — `/checkout` was reachable by URL for a basket the member's role must send for
 * approval first (`specs/170-organization-roles/`, FR-031), and offered "Place order" only for
 * placement to refuse it. The page now follows the same verdict the cart page renders its
 * primary control from — the backend's `cart.primaryCta` — and sends a basket that still needs
 * approval, is awaiting it, or is blocked by the organization back to `/cart` in the request's
 * language.
 *
 * The page is awaited with the cart, the methods and the request context mocked (as in
 * `checkout-page-locale.test.tsx`); the channel prefixes Polish, so the redirect target shows
 * it went through the locale-aware helper.
 */
let cart: CartSummary;

vi.mock('../../lib/session', () => ({
  getSessionCookie: async () => 'sess',
  getAnonCartCookie: async () => null,
  setAnonCartCookie: async () => undefined,
}));
vi.mock('../../lib/server-context', () => ({
  getServerContext: async () => ({
    locale: 'pl-PL',
    ctx: {},
    urlState: {
      languages: [{ languageCode: 'pl-PL', prefix: 'pl', prefixed: true, isDefault: true }],
      aliases: [],
      current: 'pl-PL',
    },
  }),
}));
vi.mock('../../lib/api/cart', () => ({
  CART_UNAVAILABLE: 'cart-unavailable',
  getCart: async () => ({ cart }),
  applyCartCoupon: async () => ({}),
  clearCartCoupon: async () => undefined,
}));
vi.mock('../../lib/api/organization', () => ({
  listAddresses: async () => [],
  createAddress: async () => ({ id: 'a1' }),
}));
vi.mock('../../lib/api/methods', () => ({
  listDeliveryMethods: async () => [],
  listPaymentMethods: async () => [],
}));
vi.mock('../../lib/api/dictionary', () => ({ listCountries: async () => [] }));
vi.mock('../../lib/api/orders', () => ({
  placeOrder: async () => ({}),
  previewOrderTotal: async () => null,
}));
vi.mock('../../lib/api/credit-limit', () => ({ getMyCreditLimit: async () => null }));
vi.mock('../../lib/api/quick-order', () => ({ getResolvedQuickOrderDefaults: async () => null }));
vi.mock('../../lib/api/account', () => ({ getMe: async () => null }));
vi.mock('../../components/CreditLimitWidget', () => ({ CreditLimitWidget: () => null }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));

const { default: CheckoutPage } = await import('../../app/(commerce)/checkout/page');

function summary(
  approvalStatus: NonNullable<CartSummary['approvalStatus']>,
  primaryCta: NonNullable<CartSummary['primaryCta']>,
): CartSummary {
  return {
    id: 'c1',
    customerAccountId: 'cust-1',
    organizationId: 'org-1',
    anonymousCartToken: null,
    items: [
      {
        id: 'l1',
        productId: 'p1',
        variantId: null,
        quantity: 3,
        unitPrice: { amount: 10, currency: 'PLN' },
        productName: 'Bolt',
      },
    ],
    itemCount: 1,
    subtotal: { amount: 30, currency: 'PLN' },
    grandTotal: { amount: 30, currency: 'PLN' },
    approvalStatus,
    primaryCta,
  };
}

async function render(): Promise<string> {
  const tree = await CheckoutPage({ searchParams: Promise.resolve({}) });
  return renderToString(<>{tree}</>).replaceAll('<!-- -->', '');
}

beforeEach(() => {
  cart = summary('not_required', 'checkout');
});

describe('checkout page — a basket that needs approval (issue #750)', () => {
  it('redirects to the cart when the role requires approval and the basket was not submitted', async () => {
    cart = summary('not_required', 'submit_for_approval');
    await expect(render()).rejects.toThrow('redirect /pl/cart');
  });

  it('redirects to the cart while the basket is awaiting approval', async () => {
    cart = summary('pending', 'awaiting_approval');
    await expect(render()).rejects.toThrow('redirect /pl/cart');
  });

  it('redirects to the cart when the organization blocks the basket (rejected by its admin)', async () => {
    // Owner ruling on PR #754: `blocked_by_organization` (`rejected_by_org_admin`, or a cart
    // whose status is `rejected` / `completed`) cannot be placed either.
    cart = summary('rejected_by_org_admin', 'blocked_by_organization');
    await expect(render()).rejects.toThrow('redirect /pl/cart');
  });

  it('renders checkout for an approved basket', async () => {
    cart = summary('approved', 'checkout');
    const html = await render();
    expect(html).toContain('<h1>Kasa</h1>');
    expect(html).toContain('Złóż zamówienie');
  });

  it('renders checkout when approval is not required (carts.order_without_approval)', async () => {
    cart = summary('not_required', 'checkout');
    const html = await render();
    expect(html).toContain('<h1>Kasa</h1>');
    expect(html).toContain('Złóż zamówienie');
  });
});
