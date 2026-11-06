import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { CartSummary } from '../../lib/api/cart';
import { StorefrontApiError } from '../../lib/api/client';
import { visibleText } from '../account/i18n/text';
import { actionsOf, form, redirectOf } from './actions';

/**
 * Issue #745 (and its comment) — checkout sent the placement refusal to
 * `/checkout/failure?reason=<sentence>`, and the failure page rendered it, so
 * a crafted link put any text under "We could not complete your order". The
 * reason is a code now. The same holds for `/checkout?couponError=`, and for
 * the failure page's pay-again, which lands on `/orders/:id?error=`.
 */

let locale = 'en-US';
let failure: Error | null = null;
let retry: { opened: boolean; nextAction: { kind: string } } = { opened: true, nextAction: { kind: 'none' } };

vi.mock('../../lib/session', () => ({
  getSessionCookie: async () => 'sess',
  getAnonCartCookie: async () => null,
  setAnonCartCookie: async () => undefined,
}));
vi.mock('../../lib/server-context', () => ({
  getServerContext: async () => ({ locale, ctx: { locale } }),
}));
vi.mock('../../lib/i18n/navigation', () => ({
  localeRedirect: async (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));
vi.mock('../../lib/api/cart', () => ({
  CART_UNAVAILABLE: 'cart-unavailable',
  getCart: async () => ({ cart: basket() }),
  applyCartCoupon: async () => ({ outcome: 'rejected', reason: 'expired' }),
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
  placeOrder: async () => {
    throw failure ?? new Error('fetch failed');
  },
  previewOrderTotal: async () => null,
  getMyOrder: async (_session: string, id: string) => ({
    id,
    businessId: 'ORD-1',
    paymentStatus: 'failed',
    paymentMethod: { kind: 'gateway' },
  }),
}));
vi.mock('../../lib/api/payments', () => ({
  retryOrderPayment: async () => {
    if (failure) throw failure;
    return retry;
  },
}));
vi.mock('../../lib/api/credit-limit', () => ({ getMyCreditLimit: async () => null }));
vi.mock('../../lib/api/quick-order', () => ({ getResolvedQuickOrderDefaults: async () => null }));
vi.mock('../../lib/api/account', () => ({ getMe: async () => null }));
vi.mock('../../components/CreditLimitWidget', () => ({ CreditLimitWidget: () => null }));

const { default: CheckoutPage } = await import('../../app/(commerce)/checkout/page');
const { default: FailurePage } = await import('../../app/(commerce)/checkout/failure/page');

function basket(): CartSummary {
  return {
    id: 'c1',
    customerAccountId: 'acc-1',
    organizationId: 'org-1',
    anonymousCartToken: null,
    items: [
      { id: 'l1', productId: 'p1', variantId: null, quantity: 3, unitPrice: { amount: 10, currency: 'PLN' }, productName: 'Bolt' },
    ],
    itemCount: 1,
    subtotal: { amount: 30, currency: 'PLN' },
  };
}

async function checkoutText(sp: Record<string, string>): Promise<string> {
  const tree = await CheckoutPage({ searchParams: Promise.resolve(sp) });
  return visibleText(renderToString(<>{tree}</>));
}

async function failureText(sp: Record<string, string>): Promise<string> {
  const tree = await FailurePage({ searchParams: Promise.resolve(sp) });
  return visibleText(renderToString(<>{tree}</>));
}

beforeEach(() => {
  locale = 'en-US';
  failure = null;
  retry = { opened: true, nextAction: { kind: 'none' } };
});

describe('a crafted ?reason= never reaches the checkout failure page', () => {
  it.each(['Twoja rola wymaga akceptacji… zadzwoń pod 555 000 111', 'SOMETHING_ELSE', 'constructor'])(
    '%s',
    async (crafted) => {
      const out = await failureText({ reason: crafted });
      expect(out).not.toContain(crafted);
      expect(out).toContain('Something went wrong while placing your order');
    },
  );
});

describe('each placement code reads in English and Polish on the failure page', () => {
  it.each([
    [
      'ORDER_CART_APPROVAL_REQUIRED.cart_approval_not_submitted',
      'Your role requires approval of this cart before it can be ordered. Send it for approval first.',
      'Twoja rola wymaga akceptacji tego koszyka przed zamówieniem. Najpierw wyślij go do akceptacji.',
    ],
    [
      'CART_PRICE_CHANGED',
      'The prices in your cart have changed. Review your cart and place the order again.',
      'Ceny w Twoim koszyku uległy zmianie. Sprawdź koszyk i złóż zamówienie ponownie.',
    ],
    [
      'LIMIT_INSUFFICIENT',
      'The available credit limit does not cover this order. Reduce the order or choose a different payment method.',
      'Dostępny limit kredytowy nie pokrywa wartości tego zamówienia. Zmniejsz zamówienie albo wybierz inną metodę płatności.',
    ],
    ['PLACE_FAILED', 'Could not place the order.', 'Nie udało się złożyć zamówienia.'],
  ])('%s', async (code, en, pl) => {
    expect(await failureText({ reason: code })).toContain(en);
    locale = 'pl-PL';
    expect(await failureText({ reason: code })).toContain(pl);
  });
});

/**
 * Issue #791 — the figures the backend's sentences carried come back as typed
 * values, validated when the page reads them; one out of shape is dropped and
 * the code reads as its bare sentence.
 */
describe('the failure page reads a refusal’s figures as typed values (issue #791)', () => {
  const limit = { reason: 'LIMIT_INSUFFICIENT', available: '1000.00', total: '1250.50', currency: 'PLN' };

  it('a credit-limit refusal names both amounts, in English and Polish', async () => {
    const en = await failureText(limit);
    expect(en).toContain('The available credit limit (PLN 1,000.00) does not cover this order (PLN 1,250.50).');
    locale = 'pl-PL';
    const pl = await failureText(limit);
    expect(pl).toContain('Dostępny limit kredytowy (1000,00 zł) nie pokrywa wartości tego zamówienia (1250,50 zł).');
  });

  it.each([
    { available: 'abc' },
    { available: '-50.00' },
    { total: 'NaN' },
    { total: '1e3' },
    { currency: 'pln' },
    { currency: 'ZŁ' },
    { currency: 'PLN<b>' },
    { currency: '' },
  ])('a figure out of shape (%o) reads as the bare sentence', async (crafted) => {
    const out = await failureText({ ...limit, ...crafted });
    expect(out).toContain(
      'The available credit limit does not cover this order. Reduce the order or choose a different payment method.',
    );
    expect(out).not.toContain('NaN');
    expect(out).not.toContain('abc');
  });

  it('a minimum refusal names the minimum, in English and Polish', async () => {
    const sp = { reason: 'PRODUCT_BELOW_MINIMUM_QUANTITY', min: '10' };
    expect(await failureText(sp)).toContain('A product is below its minimum order quantity (10 pcs).');
    locale = 'pl-PL';
    expect(await failureText(sp)).toContain('Ilość produktu jest poniżej minimalnej ilości zamówienia (10 szt.).');
  });

  it('a packaging-unit minimum names the number of units, never a unit name', async () => {
    const sp = { reason: 'PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY', min: '2' };
    expect(await failureText(sp)).toContain('A product must be ordered in more packaging units (minimum: 2).');
    locale = 'pl-PL';
    expect(await failureText(sp)).toContain('Produkt trzeba zamówić w większej liczbie jednostek opakowania (minimum: 2).');
  });

  it('a minimum out of shape reads as the bare sentence', async () => {
    const out = await failureText({ reason: 'PRODUCT_BELOW_MINIMUM_QUANTITY', min: '10 pcs, call 555' });
    expect(out).not.toContain('call 555');
    expect(out).toContain('A product is below its minimum order quantity. Increase the quantity and try again.');
  });

  it('figures beside a code that carries none are ignored', async () => {
    const out = await failureText({ reason: 'CART_PRICE_CHANGED', min: '10', available: '1.00', total: '2.00', currency: 'PLN' });
    expect(out).toContain('The prices in your cart have changed. Review your cart and place the order again.');
    expect(out).not.toContain('10 pcs');
  });

  it('the placement carries the credit-limit figures beside the code', async () => {
    failure = new StorefrontApiError(409, 'LIMIT_INSUFFICIENT', 'Dostępny limit kredytowy…', undefined, {
      availableAmount: '1000.00',
      orderTotal: '1250.50',
      currency: 'PLN',
    });
    const tree = await CheckoutPage({ searchParams: Promise.resolve({}) });
    const action = actionsOf(tree).get('submitAction')!;
    expect(await redirectOf(() => action(form({ deliveryAddressId: 'a1', billingSameAsShipping: 'on' }) as never))).toBe(
      '/checkout/failure?reason=LIMIT_INSUFFICIENT&available=1000.00&total=1250.50&currency=PLN',
    );
  });

  // Architect ruling on #831 (Q2): a limit lowered below what is already used has a negative
  // available amount; the figure written is clamped at 0, and the reader stays strict.
  it('a negative available amount is written as 0', async () => {
    failure = new StorefrontApiError(409, 'LIMIT_INSUFFICIENT', 'Dostępny limit kredytowy…', undefined, {
      availableAmount: '-50.00',
      orderTotal: '1250.50',
      currency: 'PLN',
    });
    const tree = await CheckoutPage({ searchParams: Promise.resolve({}) });
    const action = actionsOf(tree).get('submitAction')!;
    const to = await redirectOf(() => action(form({ deliveryAddressId: 'a1', billingSameAsShipping: 'on' }) as never));
    expect(to).toBe('/checkout/failure?reason=LIMIT_INSUFFICIENT&available=0&total=1250.50&currency=PLN');
    const out = await failureText(Object.fromEntries(new URL(to, 'http://x').searchParams));
    expect(out).toContain('The available credit limit (PLN 0.00) does not cover this order (PLN 1,250.50).');
  });

  it('the placement carries the minimum beside the code', async () => {
    failure = new StorefrontApiError(422, 'PRODUCT_BELOW_MINIMUM_QUANTITY', '"Bolt" has a minimum…', undefined, {
      productName: 'Bolt',
      minimum: 10,
    });
    const tree = await CheckoutPage({ searchParams: Promise.resolve({}) });
    const action = actionsOf(tree).get('submitAction')!;
    expect(await redirectOf(() => action(form({ deliveryAddressId: 'a1', billingSameAsShipping: 'on' }) as never))).toBe(
      '/checkout/failure?reason=PRODUCT_BELOW_MINIMUM_QUANTITY&min=10',
    );
  });
});

/** Issue #832 — the order-minimum-value refusal's figures, as typed values validated on read. */
describe('the failure page names an order-minimum-value refusal’s figures (issue #832)', () => {
  const below = { reason: 'ORDER_BELOW_MINIMUM_VALUE', minValue: '100.00', subtotal: '80.00', currency: 'PLN' };

  it('names the subtotal and the minimum, in English and Polish', async () => {
    expect(await failureText(below)).toContain(
      'The value of the order (PLN 80.00) is below the minimum order value of this store (PLN 100.00).',
    );
    locale = 'pl-PL';
    expect(await failureText(below)).toContain(
      'Wartość zamówienia (80,00 zł) jest niższa od minimalnej wartości zamówienia w tym sklepie (100,00 zł).',
    );
  });

  it.each([
    { minValue: 'abc' },
    { minValue: '1e3' },
    { subtotal: 'NaN' },
    { subtotal: '-5' },
    { subtotal: '80.005' },
    { currency: 'pln' },
    { currency: 'PLN<b>' },
  ])('a figure out of shape (%o) reads as the bare sentence', async (crafted) => {
    const out = await failureText({ ...below, ...crafted });
    expect(out).toContain('The value of the order is below the minimum order value of this store.');
    expect(out).not.toContain('NaN');
  });

  it('the placement carries the figures beside the code', async () => {
    failure = new StorefrontApiError(422, 'ORDER_BELOW_MINIMUM_VALUE', 'Order total 80.00 is below the minimum 100.00…', undefined, {
      minimum: '100.00',
      subtotal: '80.00',
      currency: 'PLN',
    });
    const tree = await CheckoutPage({ searchParams: Promise.resolve({}) });
    const action = actionsOf(tree).get('submitAction')!;
    expect(await redirectOf(() => action(form({ deliveryAddressId: 'a1', billingSameAsShipping: 'on' }) as never))).toBe(
      '/checkout/failure?reason=ORDER_BELOW_MINIMUM_VALUE&minValue=100.00&subtotal=80.00&currency=PLN',
    );
  });
});

describe('checkout’s placement redirects with a code, never a sentence', () => {
  async function submit(): Promise<string> {
    const tree = await CheckoutPage({ searchParams: Promise.resolve({}) });
    const action = actionsOf(tree).get('submitAction')!;
    return redirectOf(() => action(form({ deliveryAddressId: 'a1', billingSameAsShipping: 'on' }) as never));
  }

  it('carries the refinement of an approval refusal', async () => {
    failure = new StorefrontApiError(409, 'ORDER_CART_APPROVAL_REQUIRED', 'Twoja rola wymaga akceptacji…', undefined, {
      code: 'cart_approval_not_submitted',
    });
    expect(await submit()).toBe('/checkout/failure?reason=ORDER_CART_APPROVAL_REQUIRED.cart_approval_not_submitted');
  });

  it('carries PLACE_FAILED for anything it cannot name', async () => {
    failure = new StorefrontApiError(500, 'INTERNAL', 'Database exploded.');
    expect(await submit()).toBe('/checkout/failure?reason=PLACE_FAILED');
    failure = null;
    expect(await submit()).toBe('/checkout/failure?reason=PLACE_FAILED');
  });
});

describe('checkout’s ?error= and ?couponError= never echo the URL', () => {
  it('a crafted ?error= shows nothing — no checkout action produces one', async () => {
    const out = await checkoutText({ error: 'Pay to IBAN PL00 0000' });
    expect(out).not.toContain('Pay to IBAN');
  });

  it('a crafted ?couponError= reads as the generic coupon refusal', async () => {
    const out = await checkoutText({ couponError: 'Use code FREE at evil.example' });
    expect(out).not.toContain('evil.example');
    expect(out).toContain('This coupon could not be applied.');
  });

  it('a coupon refusal travels as its reason code and reads in the page language', async () => {
    const tree = await CheckoutPage({ searchParams: Promise.resolve({}) });
    const apply = actionsOf(tree).get('applyCouponAction')!;
    expect(await redirectOf(() => apply(form({ couponCode: 'SPRING' }) as never))).toBe('/checkout?couponError=expired');
    expect(await checkoutText({ couponError: 'expired' })).toContain('This coupon has expired.');
    locale = 'pl-PL';
    expect(await checkoutText({ couponError: 'expired' })).toContain('Ten kupon wygasł.');
  });
});

describe('the failure page’s pay-again lands on the order with a code', () => {
  async function payAgain(): Promise<string> {
    const tree = await FailurePage({ searchParams: Promise.resolve({ id: 'o1', outcome: 'failed' }) });
    const action = actionsOf(tree).get('payAgainAction')!;
    return redirectOf(() => action(form({ id: 'o1' }) as never));
  }

  it('carries PAYMENT_RETRY_IN_PROGRESS when no new attempt opened', async () => {
    retry = { opened: false, nextAction: { kind: 'none' } };
    expect(await payAgain()).toBe('/orders/o1?error=PAYMENT_RETRY_IN_PROGRESS');
  });

  it('carries the API code it names, or PAYMENT_RETRY_FAILED', async () => {
    failure = new StorefrontApiError(409, 'PAYMENT_NOT_DUE', 'This order is not awaiting payment.');
    expect(await payAgain()).toBe('/orders/o1?error=PAYMENT_NOT_DUE');
    failure = new StorefrontApiError(500, 'INTERNAL', 'Database exploded.');
    expect(await payAgain()).toBe('/orders/o1?error=PAYMENT_RETRY_FAILED');
  });
});
