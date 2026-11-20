// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CartSummary } from '../../lib/api/cart';
import type { DeliveryMethodSummary, PaymentMethodSummary } from '../../lib/api/methods';

/**
 * Issue #1250 — the coupon *Apply* and *Remove* buttons sat inside the checkout form and
 * submitted it to the coupon actions, which then reloaded `/checkout`: React resets a form once
 * its action settles, and the reload re-rendered the page, so the new delivery address, the
 * chosen shipping and payment method and the note the buyer had entered were gone.
 *
 * The page is awaited with its data mocked and mounted in jsdom; after each coupon action the
 * page is awaited again and rendered into the same root, which is what the router does with the
 * refreshed tree.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let cart: CartSummary;
let couponOutcome: { outcome: 'applied' } | { outcome: 'rejected'; reason: string } = {
  outcome: 'applied',
};
const placeOrder = vi.fn(async () => ({ id: 'o1' }));
const applyCartCoupon = vi.fn(async (_jar: unknown, code: string) => {
  if (couponOutcome.outcome === 'applied') {
    cart = {
      ...cart,
      discount: { code, amount: 3, currency: 'PLN' },
      grandTotal: { amount: 27, currency: 'PLN' },
    };
  }
  return couponOutcome;
});
const clearCartCoupon = vi.fn(async () => {
  const { discount: _discount, ...rest } = cart;
  cart = { ...rest, grandTotal: { amount: 30, currency: 'PLN' } };
});

vi.mock('../../lib/session', () => ({
  getSessionCookie: async () => 'sess',
  getAnonCartCookie: async () => null,
  setAnonCartCookie: async () => undefined,
}));
vi.mock('../../lib/server-context', () => ({
  getServerContext: async () => ({
    locale: 'en-US',
    ctx: { locale: 'en-US' },
    modules: { isPresent: () => true, presentIds: [], absentIds: [] },
  }),
}));
vi.mock('../../lib/i18n/navigation', () => ({ localeRedirect: async () => undefined }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('../../lib/api/cart', () => ({
  CART_UNAVAILABLE: 'cart-unavailable',
  getCart: async () => ({ cart }),
  applyCartCoupon,
  clearCartCoupon,
}));
vi.mock('../../lib/api/organization', () => ({
  listAddresses: async () => [],
  createAddress: async () => ({ id: 'a1' }),
}));
// `specs/182-related-payers/` — no related payers: the checkout without a *Paid by* choice.
vi.mock('../../lib/api/related-payers', () => ({ listCheckoutPayers: async () => [] }));
vi.mock('../../lib/api/methods', () => ({
  listDeliveryMethods: async () => [delivery('d1', 'Courier'), delivery('d2', 'Pallet freight')],
  listPaymentMethods: async () => [payment('p1', 'Bank transfer'), payment('p2', 'Cash on pickup')],
}));
vi.mock('../../lib/api/dictionary', () => ({
  listCountries: async () => [
    { code: 'PL', label: 'Poland' },
    { code: 'DE', label: 'Germany' },
  ],
}));
vi.mock('../../lib/api/orders', () => ({ placeOrder, previewOrderTotal: async () => null }));
vi.mock('../../lib/api/credit-limit', () => ({ getMyCreditLimit: async () => null }));
vi.mock('../../lib/api/quick-order', () => ({ getResolvedQuickOrderDefaults: async () => null }));
vi.mock('../../lib/api/account', () => ({ getMe: async () => null }));
vi.mock('../../components/analytics/EcommerceTrackers', () => ({
  BeginCheckoutTracker: () => null,
}));

const { default: CheckoutPage } = await import('../../app/(commerce)/checkout/page');

function delivery(id: string, name: string): DeliveryMethodSummary {
  return {
    id,
    code: id,
    name: { default: name },
    cost: { amount: 0, currency: 'PLN' },
    status: 'active',
    adapter: 'flat',
    rendererKey: null,
  };
}
function payment(id: string, name: string): PaymentMethodSummary {
  return {
    id,
    code: id,
    name: { default: name },
    kind: 'bank_transfer',
    status: 'active',
    adapter: 'bank_transfer',
    additionalPrice: 0,
    rendererKey: null,
  };
}

function basket(): CartSummary {
  return {
    id: 'c1',
    customerAccountId: 'acc-1',
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
  };
}

let host: HTMLElement;
let root: Root;

/** Await the page and render it into the same root — what the router does with a refreshed tree. */
async function renderPage(): Promise<void> {
  const tree = await CheckoutPage({ searchParams: Promise.resolve({}) });
  await act(async () => root.render(<>{tree}</>));
}

function field<T extends HTMLElement>(selector: string): T {
  const el = host.querySelector<T>(selector);
  if (!el) throw new Error(`no ${selector}`);
  return el;
}

function type(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function button(label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
  if (!found) throw new Error(`no button "${label}"`);
  return found;
}

async function press(label: string): Promise<void> {
  await act(async () => {
    button(label).click();
  });
  // The action settles in a transition; let it, then hand the router's refreshed tree in.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await renderPage();
}

const ENTERED = {
  delivery_recipientName: 'Anna Nowak',
  delivery_street: 'Prosta 1',
  delivery_postalCode: '00-001',
  delivery_city: 'Warszawa',
  delivery_phone: '+48 600 000 000',
};

async function fillCheckout(): Promise<void> {
  await act(async () => {
    for (const [name, value] of Object.entries(ENTERED)) type(field(`[name="${name}"]`), value);
    type(field<HTMLSelectElement>('[name="delivery_country"]'), 'DE');
    field<HTMLInputElement>('input[name="deliveryMethodId"][value="d2"]').click();
    field<HTMLInputElement>('input[name="paymentMethodId"][value="p2"]').click();
    type(
      field<HTMLTextAreaElement>('textarea[name="customerNote"]'),
      'Please call before delivery.',
    );
  });
}

function expectCheckoutKept(): void {
  for (const [name, value] of Object.entries(ENTERED)) {
    expect(field<HTMLInputElement>(`[name="${name}"]`).value, name).toBe(value);
  }
  expect(field<HTMLSelectElement>('[name="delivery_country"]').value).toBe('DE');
  expect(field<HTMLInputElement>('input[name="deliveryMethodId"][value="d2"]').checked).toBe(true);
  expect(field<HTMLInputElement>('input[name="paymentMethodId"][value="p2"]').checked).toBe(true);
  expect(field<HTMLTextAreaElement>('textarea[name="customerNote"]').value).toBe(
    'Please call before delivery.',
  );
}

beforeEach(async () => {
  cart = basket();
  couponOutcome = { outcome: 'applied' };
  placeOrder.mockClear();
  applyCartCoupon.mockClear();
  clearCartCoupon.mockClear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await renderPage();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('checkout coupon — issue #1250', () => {
  it('the coupon control does not belong to the checkout form', () => {
    const checkout = field<HTMLInputElement>('textarea[name="customerNote"]').form;
    expect(checkout).not.toBeNull();
    expect(field<HTMLInputElement>('input[name="couponCode"]').form).not.toBe(checkout);
    expect(button('Apply').form).not.toBe(checkout);
  });

  it('keeps the address, the methods and the note through applying and removing a coupon', async () => {
    await fillCheckout();
    expectCheckoutKept();

    await act(async () => type(field('input[name="couponCode"]'), 'SPRING'));
    await press('Apply');
    expect(applyCartCoupon).toHaveBeenCalledWith(expect.anything(), 'SPRING');
    expect(host.textContent).toContain('Discount (SPRING)');
    expectCheckoutKept();

    await press('Remove');
    expect(clearCartCoupon).toHaveBeenCalledTimes(1);
    expect(host.textContent).not.toContain('Discount (SPRING)');
    expectCheckoutKept();
    expect(placeOrder).not.toHaveBeenCalled();
  });

  it('keeps them, and the code typed, when the coupon is refused — and says why', async () => {
    couponOutcome = { outcome: 'rejected', reason: 'expired' };
    await fillCheckout();
    await act(async () => type(field('input[name="couponCode"]'), 'OLD10'));
    await press('Apply');
    expectCheckoutKept();
    expect(field<HTMLInputElement>('input[name="couponCode"]').value).toBe('OLD10');
    const alert = field('[role="alert"]');
    expect(alert.textContent).toBe('This coupon has expired.');
    expect(
      field<HTMLInputElement>('input[name="couponCode"]').getAttribute('aria-describedby'),
    ).toContain(alert.id);
    expect(field<HTMLInputElement>('input[name="couponCode"]').getAttribute('aria-invalid')).toBe(
      'true',
    );
  });

  it('announces the applied and the removed coupon in a status region present before either', async () => {
    const status = field('[role="status"]');
    expect(status.textContent).toBe('');
    await act(async () => type(field('input[name="couponCode"]'), 'SPRING'));
    await press('Apply');
    expect(field('[role="status"]')).toBe(status);
    expect(status.textContent).toContain('SPRING');
    await press('Remove');
    expect(field('[role="status"]')).toBe(status);
    expect(status.textContent).toBe('Coupon removed.');
  });
});
