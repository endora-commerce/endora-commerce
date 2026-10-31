import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { CartSummary } from '../../lib/api/cart';

/**
 * Issue #85 — the checkout page's own copy (headings, the note field, the
 * review table, the credit notice, the buttons) was English whatever the page
 * language; it is the `commerce.checkout.*` catalogue now.
 *
 * The page is awaited with the cart, the methods and the request context
 * mocked (as in `test/account/quick-order-locale.test.tsx`).
 */
let locale = 'en-US';
let cart: CartSummary;
let creditLimit: { availableAmount: number; currency: string } | null = null;

vi.mock('../../lib/session', () => ({
  getSessionCookie: async () => 'sess',
  getAnonCartCookie: async () => null,
  setAnonCartCookie: async () => undefined,
}));
vi.mock('../../lib/server-context', () => ({
  getServerContext: async () => ({ locale, ctx: {} }),
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
vi.mock('../../lib/api/credit-limit', () => ({ getMyCreditLimit: async () => creditLimit }));
vi.mock('../../lib/api/quick-order', () => ({ getResolvedQuickOrderDefaults: async () => null }));
vi.mock('../../lib/api/account', () => ({ getMe: async () => null }));
vi.mock('../../components/CreditLimitWidget', () => ({ CreditLimitWidget: () => null }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));

const { default: CheckoutPage } = await import('../../app/(commerce)/checkout/page');

function summary(items: CartSummary['items']): CartSummary {
  return {
    id: 'c1',
    customerAccountId: null,
    organizationId: null,
    anonymousCartToken: null,
    items,
    itemCount: items.length,
    subtotal: { amount: 30, currency: 'PLN' },
    discount: { code: 'SPRING', amount: 3, currency: 'PLN' },
    grandTotal: { amount: 27, currency: 'PLN' },
  };
}

const LINE: CartSummary['items'][number] = {
  id: 'l1',
  productId: 'p1',
  variantId: null,
  quantity: 3,
  unitPrice: { amount: 10, currency: 'PLN' },
  productName: 'Bolt',
};

async function render(): Promise<string> {
  const tree = await CheckoutPage({ searchParams: Promise.resolve({}) });
  return renderToString(<>{tree}</>).replaceAll('<!-- -->', '');
}

beforeEach(() => {
  locale = 'en-US';
  cart = summary([LINE]);
  creditLimit = null;
});

describe('checkout page — issue #85', () => {
  it.each([
    ['en-US', '<h1>Checkout</h1>', 'Your cart is empty — add a product before checking out.', 'Browse the catalog'],
    ['pl-PL', '<h1>Kasa</h1>', 'Twój koszyk jest pusty — dodaj produkt, zanim przejdziesz do kasy.', 'Przejdź do katalogu'],
  ])('says the cart is empty in %s', async (l, heading, sentence, link) => {
    locale = l;
    cart = summary([]);
    const html = await render();
    expect(html).toContain(heading);
    expect(html).toContain(sentence);
    expect(html).toContain(link);
  });

  it('renders the review and the actions in English', async () => {
    creditLimit = { availableAmount: 5, currency: 'PLN' };
    const html = await render();
    for (const text of [
      '<h1>Checkout</h1>',
      'Note for the seller (optional)',
      '<h3>Review</h3>',
      'x 3',
      'Subtotal',
      'Discount (SPRING)',
      '<strong>Total</strong>',
      'Back to cart',
      'Place order',
      'Payment method',
      'exceeds the available credit',
    ]) {
      expect(html).toContain(text);
    }
  });

  it('renders the review and the actions in Polish', async () => {
    locale = 'pl-PL';
    creditLimit = { availableAmount: 5, currency: 'PLN' };
    const html = await render();
    for (const text of [
      '<h1>Kasa</h1>',
      'Uwagi dla sprzedawcy (opcjonalnie)',
      '<h3>Przegląd zamówienia</h3>',
      'Suma częściowa',
      'Rabat (SPRING)',
      '<strong>Razem</strong>',
      'Wróć do koszyka',
      'Złóż zamówienie',
      'Metoda płatności',
      'przekracza dostępny limit kredytowy',
    ]) {
      expect(html).toContain(text);
    }
    expect(html).not.toContain('Place order');
    expect(html).not.toContain('Subtotal');
  });
});
