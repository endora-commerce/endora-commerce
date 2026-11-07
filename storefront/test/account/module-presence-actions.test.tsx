import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { ReactNode } from 'react';
import type { CartSummary } from '../../lib/api/cart';
import type { OrderSummary } from '../../lib/api/orders';
import type { ModulePresenceSet } from '../../lib/api/module-presence';
import { tForLocale } from '../../lib/i18n/messages';

/**
 * Issue #672 — Principle XVII, item 5, past the product pages: the order
 * detail, the cart, the checkout notice, the not-found page and the
 * preferences page each offered an action, a link or a whole page belonging to
 * a module that can be switched off — a return, an order cloned into a quote
 * request, a cart converted into one, a cart line saved to a shopping list, a
 * link to the quote requests, the quick-order defaults.
 *
 * Each is asserted absent while its own module is off and present while it is
 * on. The member holds every code, so what disappears is presence's doing; the
 * role gate (`specs/170-organization-roles/`) is pinned by the tests beside
 * this one and stays.
 */

const en = tForLocale('en-US');
const NOT_FOUND = 'NEXT_NOT_FOUND';

function presenceWithout(...absent: string[]): ModulePresenceSet {
  return { isPresent: (id: string) => !absent.includes(id), presentIds: [], absentIds: absent };
}

let modules: ModulePresenceSet = presenceWithout();
let returnableCalls = 0;
let cart: CartSummary | null = null;

const PERMISSIONS = [
  'carts.create',
  'quote_requests.create',
  'shopping_lists.create',
  'carts.order_without_approval',
  'returns.create',
];

vi.mock('../../lib/session', () => ({
  getSessionCookie: async () => 'session',
  getAnonCartCookie: async () => null,
  setAnonCartCookie: async () => undefined,
}));
vi.mock('../../lib/server-context', () => ({
  getServerContext: async () => ({ locale: 'en-US', ctx: { locale: 'en-US' }, modules }),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    throw new Error(NOT_FOUND);
  },
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));
vi.mock('../../lib/i18n/navigation', () => ({
  localeRedirect: async (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));
vi.mock('../../lib/api/account', () => ({
  getMe: async () => ({
    customerAccount: {
      id: 'member-1',
      organizationRole: { id: 'role-1', kind: 'custom', name: 'Purchasing' },
      permissions: PERMISSIONS,
    },
    organization: { id: 'org-1', name: 'Acme', isPersonal: false, canTransact: true, status: 'active', moderationMessage: null },
    impersonation: null,
  }),
}));

// ── the order detail's reads ──────────────────────────────────────────────

const order = {
  id: '11111111-2222-4333-8444-555555555555',
  businessId: 'ORD-2001-2026',
  organizationId: 'org-1',
  status: 'completed',
  paymentStatus: 'paid',
  deliveryAddress: {},
  billingAddress: {},
  deliveryMethod: { id: 'd1', code: 'courier', name: {}, cost: 0 },
  paymentMethod: { id: 'p1', code: 'bank_transfer', name: {}, kind: 'bank_transfer' },
  items: [],
  subtotal: 100,
  taxTotal: 23,
  discountTotal: 0,
  deliveryTotal: 0,
  total: 123,
  currency: 'PLN',
  customerNote: null,
  placedAt: '2026-08-21T10:00:00.000Z',
  nextAction: null,
} as unknown as OrderSummary;

vi.mock('../../lib/api/orders', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api/orders')>('../../lib/api/orders');
  return { ...actual, getMyOrder: async () => order, listOrderComments: async () => [] };
});
vi.mock('../../lib/api/returns', () => ({
  getReturnable: async () => {
    returnableCalls += 1;
    return { eligible: true, freeReturnEligible: false, lines: [] };
  },
}));
vi.mock('../../lib/api/invoices', () => ({ listMyOrderInvoices: async () => [], invoiceDownloadUrl: () => '#' }));
vi.mock('../../lib/api/payments', () => ({ retryOrderPayment: async () => ({ opened: false }) }));
vi.mock('../../components/analytics/EcommerceTrackers', () => ({ PurchaseTracker: () => null }));

// ── the cart's reads ──────────────────────────────────────────────────────

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
  saveCartItemToShoppingList: async () => undefined,
}));
vi.mock('../../lib/api/shopping-lists', () => ({ listShoppingLists: async () => [] }));
vi.mock('../../lib/api/pricing', () => ({
  PRICING_UNAVAILABLE: 'pricing-unavailable',
  getProductDisplayMode: async () => ({ displayMode: 'net_only' }),
}));

// ── the not-found page's reads ────────────────────────────────────────────

vi.mock('../../lib/api/catalog', () => ({ getCategoryTree: async () => [] }));
vi.mock('../../lib/api/shop', () => ({ getShopInfo: async () => ({ supportEmail: '', contactEmail: '', phone: '' }) }));

const { default: OrderPage } = await import('../../app/(account)/orders/[id]/page');
const { default: CartPage } = await import('../../app/(commerce)/cart/page');
const { default: NotFound } = await import('../../app/not-found');
const { QuoteValidityNotice } = await import('../../components/checkout/QuoteValidityNotice');

function html(node: unknown): string {
  return renderToString(<>{node as ReactNode}</>).replaceAll('<!-- -->', '');
}

beforeEach(() => {
  modules = presenceWithout();
  returnableCalls = 0;
  cart = {
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
    approvalStatus: 'not_required',
    primaryCta: 'checkout',
  } as unknown as CartSummary;
});

describe('order detail — module presence of its actions (issue #672)', () => {
  const page = async (): Promise<string> =>
    html(await OrderPage({ params: Promise.resolve({ id: order.id }), searchParams: Promise.resolve({}) }));
  const RETURN = 'href="/returns/new?orderId=';
  const CLONE_TO_QUOTE = en('account.order.reorderToQuote');
  const REORDER = en('account.order.reorderToCart');

  it('offers the return and the clone into a quote request while both modules are present', async () => {
    const out = await page();
    expect(out).toContain(RETURN);
    expect(out).toContain(CLONE_TO_QUOTE);
    expect(out).toContain(REORDER);
  });

  it('drops the return, and does not ask returns about the order, while returns is off', async () => {
    modules = presenceWithout('returns');
    const out = await page();
    expect(out).not.toContain(RETURN);
    expect(returnableCalls).toBe(0);
    expect(out).toContain(CLONE_TO_QUOTE);
    expect(out).toContain(REORDER);
  });

  it('drops the clone into a quote request while quote_requests is off', async () => {
    modules = presenceWithout('quote_requests');
    const out = await page();
    expect(out).not.toContain(CLONE_TO_QUOTE);
    expect(out).toContain(RETURN);
    expect(out).toContain(REORDER);
  });
});

describe('cart — module presence of its actions (issue #672)', () => {
  const page = async (): Promise<string> => html(await CartPage({ searchParams: Promise.resolve({}) }));
  const CONVERT = en('commerce.cart.convert.label');
  const SAVE_TO_LIST = en('commerce.cart.line.saveToList');

  it('offers the conversion to a quote request and save-to-list while both modules are present', async () => {
    const out = await page();
    expect(out).toContain(CONVERT);
    expect(out).toContain(SAVE_TO_LIST);
  });

  it('drops the conversion to a quote request while quote_requests is off', async () => {
    modules = presenceWithout('quote_requests');
    const out = await page();
    expect(out).not.toContain(CONVERT);
    expect(out).toContain(SAVE_TO_LIST);
  });

  it('drops save-to-list while shopping_lists is off', async () => {
    modules = presenceWithout('shopping_lists');
    const out = await page();
    expect(out).not.toContain(SAVE_TO_LIST);
    expect(out).toContain(CONVERT);
  });
});

describe('checkout — the ended-quote notice (issue #672)', () => {
  const TO_QUOTES = 'href="/quote-requests"';
  const render = (quoteRequestsPresent: boolean): string =>
    html(
      <QuoteValidityNotice
        id="checkout-quote-ended"
        refusal="lapsed"
        locale="en-US"
        quoteRequestsPresent={quoteRequestsPresent}
      />,
    );

  it('leads to the quote requests only while quote_requests is present', () => {
    expect(render(true)).toContain(TO_QUOTES);
    const absent = render(false);
    expect(absent).not.toContain(TO_QUOTES);
    expect(absent).toContain('href="/cart"');
  });
});

describe('not-found page — module presence (issue #672)', () => {
  it('offers the quote-request draft only while quote_requests is present', async () => {
    expect(html(await NotFound())).toContain('href="/quote-request"');
    modules = presenceWithout('quote_requests');
    const out = html(await NotFound());
    expect(out).not.toContain('href="/quote-request"');
    expect(out).toContain('href="/catalog"');
  });
});

describe('preferences page — the quick-order defaults (issue #672)', () => {
  it('answers not-found while quick_order is off, and renders its page while present', async () => {
    const { default: Layout } = await import('../../app/(account)/preferences/layout');
    modules = presenceWithout('quick_order');
    await expect(Layout({ children: 'page' })).rejects.toThrow(NOT_FOUND);
    modules = presenceWithout();
    expect(html(await Layout({ children: 'page' }))).toBe('page');
  });
});
