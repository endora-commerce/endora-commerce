import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { CartSummary } from '../../lib/api/cart';

/**
 * Issue #85 — the cart page speaks the page's language. Its copy was an inline
 * `locale.startsWith('pl') ? {…} : {…}` table; it is the `commerce.cart.*`
 * catalogue now, with the counted sentences in their plural forms.
 *
 * The page is an async server component: it is awaited and rendered with the
 * cart, the session and the request context mocked (as in
 * `test/account/quick-order-locale.test.tsx`).
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

beforeEach(() => {
  locale = 'en-US';
  cart = 'cart-unavailable';
});

describe('cart page — issue #85', () => {
  it.each([
    ['en-US', 'The cart is unavailable', 'Browse the catalog', 'aria-label="Breadcrumb"'],
    ['pl-PL', 'Koszyk jest niedostępny', 'Przejdź do katalogu', 'aria-label="Ścieżka nawigacji"'],
  ])('says the cart is unavailable in %s', async (l, heading, cta, crumb) => {
    locale = l;
    const html = await render();
    expect(html).toContain(heading);
    expect(html).toContain(cta);
    expect(html).toContain(crumb);
  });

  it.each([
    ['en-US', 'Your cart is empty.'],
    ['pl-PL', 'Twój koszyk jest pusty.'],
  ])('says the cart is empty in %s', async (l, sentence) => {
    locale = l;
    cart = summary([]);
    expect(await render()).toContain(sentence);
  });

  it('renders a filled cart in English, with no Polish in it', async () => {
    cart = summary([line('1', 1), line('2', 2), line('3', 3)]);
    const html = await render({ qrCreated: '1', listAdded: 'Workshop' });
    for (const text of [
      '<h1 class="m-0 text-[24px] font-semibold tracking-[-0.02em] text-fg">Your cart</h1>',
      '3 items ready for checkout.',
      'Continue shopping',
      'Convert to quote request',
      'Coupon code',
      'Proceed to checkout',
      'Taxes and delivery are calculated at checkout.',
      "We&#x27;ve sent your cart to sales as a new quote request.",
      'Saved line to your &quot;Workshop&quot; list.',
      'Summary',
    ]) {
      expect(html).toContain(text);
    }
    expect(html).not.toMatch(/[ąćęłńóśźż]/i);
  });

  it('renders a filled cart in Polish, with the plural forms Polish needs', async () => {
    locale = 'pl-PL';
    cart = summary([line('1', 1), line('2', 2), line('3', 3)]);
    const html = await render({ qrCreated: '1', listAdded: 'Warsztat' });
    for (const text of [
      'Twój koszyk',
      '3 pozycje gotowe do kasy.',
      'Kontynuuj zakupy',
      'Zamień na zapytanie ofertowe',
      'Kupon rabatowy',
      'Przejdź do kasy',
      'Podatki i koszty dostawy zostaną naliczone w następnym kroku.',
      'Twój koszyk został wysłany do działu sprzedaży jako nowe zapytanie ofertowe.',
      'Pozycja została zapisana na liście „Warsztat”.',
      'Podsumowanie',
    ]) {
      expect(html).toContain(text);
    }
  });

  it.each([
    [1, '1 pozycja gotowa do kasy.'],
    [5, '5 pozycji gotowych do kasy.'],
    [12, '12 pozycji gotowych do kasy.'],
    [22, '22 pozycje gotowe do kasy.'],
  ])('counts %i lines in Polish', async (n, sentence) => {
    locale = 'pl-PL';
    cart = summary(Array.from({ length: n }, (_, i) => line(String(i), 1)));
    expect(await render()).toContain(sentence);
  });

  it('counts one line in English', async () => {
    cart = summary([line('1', 1)]);
    expect(await render()).toContain('1 item ready for checkout.');
  });
});
