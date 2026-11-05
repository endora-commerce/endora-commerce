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
