import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { CheckoutPayer } from '@endora-commerce/contracts';
import type { CartSummary } from '../../lib/api/cart';

/**
 * `specs/182-related-payers/` FR-110, US9-1 — the cart **page** offers the *Paid by* choice
 * (RP-22) on a cart with lines. `buying-for.test.tsx` renders the component alone; this renders
 * the page, so a control placed in a branch the page never reaches with lines is caught.
 *
 * The page is an async server component: it is awaited and rendered with the cart, the session,
 * the member and the payer list mocked (as in `test/checkout/cart-page-locale.test.tsx`).
 */
let locale = 'en-US';
let cart: CartSummary;
let payers: CheckoutPayer[] = [];
let permissions: string[] = [];

vi.mock('../../lib/session', () => ({
  getSessionCookie: async () => 'session',
  getAnonCartCookie: async () => null,
  setAnonCartCookie: async () => undefined,
}));
vi.mock('../../lib/server-context', () => ({
  getServerContext: async () => ({ locale, ctx: {}, modules: { isPresent: () => true, presentIds: [], absentIds: [] } }),
}));
vi.mock('../../lib/api/cart', () => ({
  CART_UNAVAILABLE: 'cart-unavailable',
  getCart: async () => ({ cart }),
  getCartUpsells: async () => [],
  touchCart: async () => undefined,
  removeCartItem: async () => ({}),
  updateCartItem: async () => ({}),
  applyCartCoupon: async () => ({}),
  clearCartCoupon: async () => undefined,
  convertCartToQuoteRequest: async () => ({}),
  submitCartForApproval: async () => undefined,
  setCartBuyingFor: async () => ({ repriced: 0, unpriced: 0 }),
  saveCartItemToShoppingList: async () => undefined,
}));
vi.mock('../../lib/api/shopping-lists', () => ({ listShoppingLists: async () => [] }));
vi.mock('../../lib/api/account', () => ({
  getMe: async () => ({
    customerAccount: { permissions, organizationRole: { kind: 'member' } },
    organization: { id: 'org-x', name: 'Buyer X', canTransact: true, status: 'approved', moderationMessage: null },
  }),
}));
vi.mock('../../lib/api/related-payers', () => ({ listCheckoutPayers: async () => payers }));
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

function payer(id: string, name: string, commercialTerms: 'buyer' | 'payer'): CheckoutPayer {
  return {
    payerOrganizationId: id,
    name,
    taxId: 'PL1234567890',
    commercialTerms,
    billingAddresses: [],
    paymentMethodIds: null,
    creditAvailable: null,
  };
}

const BETA = payer('00000000-0000-4000-8000-0000000000b2', 'Beta SA', 'payer');

function summary(lineCount: number, extra: Partial<CartSummary> = {}): CartSummary {
  return {
    id: 'c1',
    customerAccountId: 'acc-1',
    organizationId: 'org-x',
    anonymousCartToken: null,
    items: Array.from({ length: lineCount }, (_, i) => ({
      id: `l${i}`,
      productId: `p-${i}`,
      variantId: null,
      quantity: 1,
      unitPrice: { amount: 10, currency: 'PLN' },
      productName: `Bolt ${i}`,
      productSku: `BOLT-${i}`,
    })),
    itemCount: lineCount,
    subtotal: { amount: 10 * lineCount, currency: 'PLN' },
    ...extra,
  };
}

async function render(searchParams: Record<string, string> = {}): Promise<string> {
  const tree = await CartPage({ searchParams: Promise.resolve(searchParams) });
  return renderToString(<>{tree}</>).replaceAll('<!-- -->', '');
}

beforeEach(() => {
  locale = 'en-US';
  cart = summary(1);
  payers = [BETA];
  permissions = ['carts.create', 'related_payers.order_with_payer'];
});

describe('cart page — Paid by (FR-110, US9-1, RP-22)', () => {
  it('offers the choice on a cart with lines, listing the own Organization and the payer', async () => {
    const html = await render();
    expect(html).toContain('name="payerOrganizationId"');
    expect(html).toContain('Paid by');
    expect(html).toContain('Buyer X');
    expect(html).toContain('Beta SA');
  });

  it('labels the choice "Płaci" in Polish', async () => {
    locale = 'pl-PL';
    const html = await render();
    expect(html).toContain('Płaci');
    expect(html).not.toContain('Kupujesz dla');
  });

  it('offers nothing to a member who may not edit the cart', async () => {
    permissions = ['related_payers.order_with_payer'];
    expect(await render()).not.toContain('name="payerOrganizationId"');
  });

  it('offers nothing when the only payers are on the buyer\'s terms (chosen at checkout)', async () => {
    payers = [payer('00000000-0000-4000-8000-0000000000c3', 'Gamma SA', 'buyer')];
    const html = await render();
    expect(html).not.toContain('name="payerOrganizationId"');
    expect(html).not.toContain('Gamma SA');
  });

  it('says what the last switch changed, on a cart with lines (FR-113)', async () => {
    const html = await render({ buyingForRepriced: '1', buyingForUnpriced: '0' });
    expect(html).toContain('Prices updated for 1 line(s).');
  });

  it('says why the cart returned to the buyer\'s own prices (FR-116)', async () => {
    cart = summary(1, { buyingForReset: { reason: 'terms_changed' } });
    expect(await render()).toContain('back on your own prices');
  });
});
