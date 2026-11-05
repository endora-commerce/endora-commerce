import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { CartSummary } from '../../lib/api/cart';

/**
 * Issue #650 — a buyer whose basket was rejected is told so, and why. The
 * rejection closed that basket, so the cart page shows a new one — empty, or
 * refilled — and the notice comes from the answer's `previousRejection`, through
 * `CartApprovalBanner`'s rejected variant.
 *
 * Rendered as `cart-page-locale.test.tsx` renders the page: awaited, with the
 * cart, the session and the request context mocked.
 */
let locale = 'en-US';
let cart: CartSummary | 'cart-unavailable' = 'cart-unavailable';

vi.mock('../../lib/session', () => ({
  getSessionCookie: async () => null,
  getAnonCartCookie: async () => 'anon',
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
vi.mock('../../lib/api/account', () => ({ getMe: async () => null }));
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

function line(id: string, quantity: number): CartSummary['items'][number] {
  return {
    id,
    productId: `p-${id}`,
    variantId: null,
    quantity,
    unitPrice: { amount: 10, currency: 'PLN' },
    productName: `Bolt ${id}`,
    productSku: `BOLT-${id}`,
  };
}

function summary(items: CartSummary['items']): CartSummary {
  return {
    id: 'c1',
    customerAccountId: null,
    organizationId: null,
    anonymousCartToken: 'anon',
    items,
    itemCount: items.length,
    subtotal: { amount: 30, currency: 'PLN' },
  };
}

async function render(searchParams: Record<string, string> = {}): Promise<string> {
  const tree = await CartPage({ searchParams: Promise.resolve(searchParams) });
  return renderToString(<>{tree}</>).replaceAll('<!-- -->', '');
}

const REJECTION = {
  cartId: '00000000-0000-4000-8000-000000000650',
  rejectedAt: '2026-11-03T10:00:00.000Z',
  reason: 'Over the quarterly budget',
};

beforeEach(() => {
  locale = 'en-US';
  cart = 'cart-unavailable';
});

describe('cart page — the rejection of the previous basket (issue #650)', () => {
  it.each([
    ['en-US', 'Your previous cart was rejected by an approver in your organization. Reason: Over the quarterly budget'],
    ['pl-PL', 'Twój poprzedni koszyk został odrzucony przez osobę zatwierdzającą w Twojej organizacji. Powód: Over the quarterly budget'],
  ])('tells the buyer on the empty basket that replaced it, in %s', async (l, sentence) => {
    locale = l;
    cart = { ...summary([]), previousRejection: REJECTION };
    const html = await render();
    expect(html).toContain(sentence);
    expect(html).toContain('role="alert"');
  });

  it('tells them on a refilled basket too', async () => {
    cart = { ...summary([line('1', 1)]), approvalStatus: 'not_required', previousRejection: REJECTION };
    const html = await render();
    expect(html).toContain('Your previous cart was rejected by an approver in your organization. Reason: Over the quarterly budget');
    expect(html).toContain('Proceed to checkout');
  });

  it('says it without a reason when none was stored', async () => {
    cart = { ...summary([]), previousRejection: { ...REJECTION, reason: null } };
    const html = await render();
    expect(html).toContain('Your previous cart was rejected by an approver in your organization.');
    expect(html).not.toContain('Reason:');
  });

  // Issue #755 — the rejected basket's lines are restored into the next one.
  it.each([
    [
      'en-US',
      'Your previous cart was rejected by an approver in your organization. Reason: Over the quarterly budget Its items have been restored to this cart so you can change it and submit it again.',
    ],
    [
      'pl-PL',
      'Twój poprzedni koszyk został odrzucony przez osobę zatwierdzającą w Twojej organizacji. Powód: Over the quarterly budget Jego pozycje zostały przywrócone do tego koszyka, więc możesz go poprawić i wysłać ponownie.',
    ],
  ])('says the items were restored when they were, in %s', async (l, sentence) => {
    locale = l;
    cart = {
      ...summary([line('1', 1)]),
      approvalStatus: 'not_required',
      previousRejection: { ...REJECTION, restoredLineCount: 1, skippedLines: [] },
    };
    expect(await render()).toContain(sentence);
  });

  it('does not say so when nothing was restored', async () => {
    cart = { ...summary([]), previousRejection: { ...REJECTION, restoredLineCount: 0, skippedLines: [] } };
    expect(await render()).not.toContain('restored');
  });

  it('names the lines that could not be restored', async () => {
    cart = {
      ...summary([line('1', 1)]),
      approvalStatus: 'not_required',
      previousRejection: {
        ...REJECTION,
        restoredLineCount: 1,
        skippedLines: [{ productId: 'p-gone', productName: 'Retired bolt', reason: 'not_purchasable' }],
      },
    };
    const html = await render();
    expect(html).toContain('Some lines were skipped');
    expect(html).toContain('Retired bolt');
    expect(html).toContain('no longer available');
  });

  it.each([
    ['null', { previousRejection: null }],
    ['absent', {}],
  ] as const)('says nothing when there is no rejection (%s)', async (_label, field) => {
    cart = { ...summary([line('1', 1)]), approvalStatus: 'not_required', ...field };
    const html = await render();
    expect(html).not.toContain('was rejected');
    expect(html).not.toContain('role="alert"');
  });
});
