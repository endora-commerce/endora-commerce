import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { PaymentMethods } from '../../components/checkout/PaymentMethods';
import { PlaceOrderButton } from '../../components/checkout/PlaceOrderButton';
import { placeOrderBlock } from '../../lib/checkout/place-order-gate';
import { tForLocale } from '../../lib/i18n/messages';
import type { PaymentMethodSummary } from '../../lib/api/methods';

/**
 * What a buyer sees in checkout when there is nothing to pay with.
 *
 * Two operator actions arrive here as the same empty list — `payments` off,
 * where the adapter registry drops all four built-ins so the catalogue route
 * honestly answers `200 {"data": []}`, and `payment_methods` off, where the
 * route answers `503` and `listPaymentMethods` degrades it. The buyer is told
 * the same thing in both, in their own language, and cannot submit the form.
 *
 * SSR-only harness: `renderToString`, no jsdom. `PaymentMethods` is a client
 * component whose `useEffect` Apple Pay pass does not run here, which is the
 * server-rendered state a buyer's first paint actually is.
 */
const method = (id: string, name: string): PaymentMethodSummary => ({
  id,
  code: id,
  name: { default: name },
  kind: 'bank_transfer',
  status: 'active',
  adapter: 'bank_transfer',
  additionalPrice: 0,
  rendererKey: null,
});

describe('PaymentMethods empty state', () => {
  it('renders the English sentence and no radio when nothing is available', () => {
    const html = renderToString(<PaymentMethods methods={[]} locale="en-US" />);
    expect(html).toContain('No payment method is available');
    expect(html).not.toContain('name="paymentMethodId"');
  });

  it('renders the Polish sentence for a pl-PL buyer', () => {
    const html = renderToString(<PaymentMethods methods={[]} locale="pl-PL" />);
    expect(html).toContain('Brak dostępnych metod płatności');
  });

  it('falls back to English for a locale that ships no catalogue', () => {
    const html = renderToString(<PaymentMethods methods={[]} locale="de-DE" />);
    expect(html).toContain('No payment method is available');
  });

  it('still renders the methods it is given', () => {
    const html = renderToString(
      <PaymentMethods methods={[method('p1', 'Bank transfer')]} locale="en-US" />,
    );
    expect(html).toContain('Bank transfer');
    expect(html).not.toContain('No payment method is available');
  });
});

describe('the new checkout copy', () => {
  const en = tForLocale('en-US');
  const pl = tForLocale('pl-PL');

  it('ships the empty state in both languages, the Polish one as the owner asked', () => {
    // Principle VIII — a user-facing string exists in `en` and `pl`, and the
    // Polish lives in the catalogue as a translation value, which is where
    // Polish belongs. `tForLocale` falls back to `en-US` for a missing key, so
    // asserting the two differ is what proves the `pl` entry is really there.
    expect(en('checkout.payment.none')).toContain('No payment method is available');
    expect(pl('checkout.payment.none')).toContain('Brak dostępnych metod płatności');
  });

  it('ships the error-boundary copy in both languages too', () => {
    for (const key of [
      'checkout.error.title',
      'checkout.error.body',
      'checkout.error.retry',
      'checkout.error.backToCart',
      'checkout.error.referencePrefix',
    ] as const) {
      expect(en(key), `${key} en-US`).toBeTruthy();
      expect(pl(key), `${key} pl-PL`).toBeTruthy();
      expect(pl(key), `${key} is untranslated`).not.toBe(en(key));
    }
  });
});

describe('placeOrderBlock', () => {
  // A delivery method is present throughout, so these cases keep measuring the
  // payment gate after the delivery one joined above it; the delivery gate's own
  // cases live in `delivery-catalogue-absence.test.tsx`.
  const shippable = { canTransact: true, deliveryMethodCount: 1 };

  it('blocks on an empty payment catalogue', () => {
    expect(placeOrderBlock({ ...shippable, paymentMethodCount: 0 })).toBe('no-payment-method');
  });

  it('lets a buyer with at least one method through', () => {
    expect(placeOrderBlock({ ...shippable, paymentMethodCount: 1 })).toBeNull();
  });

  it('ranks the moderation gate above the payment one', () => {
    // Both are true at once for an unmoderated org in a shop with no methods.
    // Moderation wins, because a payment method would not help.
    expect(
      placeOrderBlock({ canTransact: false, deliveryMethodCount: 1, paymentMethodCount: 0 }),
    ).toBe('moderation');
    expect(
      placeOrderBlock({ canTransact: false, deliveryMethodCount: 1, paymentMethodCount: 3 }),
    ).toBe('moderation');
  });
});

describe('PlaceOrderButton', () => {
  it('is disabled, with the reason as its tooltip, when there is nothing to pay with', () => {
    const html = renderToString(
      <PlaceOrderButton
        blocked="no-payment-method"
        label="Place order"
        pendingLabel="Placing order…"
        title="Brak dostępnych metod płatności dla Twojego konta w tym kanale sprzedaży."
      />,
    );
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('data-blocked="no-payment-method"');
    expect(html).toContain('Brak dostępnych metod płatności');
  });
});
