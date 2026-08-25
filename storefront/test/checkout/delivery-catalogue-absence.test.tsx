import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { listDeliveryMethods } from '../../lib/api/methods';
import { ShippingMethods } from '../../components/checkout/ShippingMethods';
import { blockTitle, placeOrderBlock } from '../../lib/checkout/place-order-gate';
import { PlaceOrderButton } from '../../components/checkout/PlaceOrderButton';
import { tForLocale } from '../../lib/i18n/messages';
import CheckoutError from '../../app/(commerce)/checkout/error';

/**
 * What a buyer sees in checkout when there is nothing to deliver with.
 *
 * `delivery_methods` owns `GET /api/v1/delivery-methods` and registers it
 * through the gated seam, so an operator who switches that module off makes the
 * endpoint answer `503 MODULE_DISABLED`. `listDeliveryMethods` threw on it, and
 * since the checkout error boundary landed the buyer stopped getting Next's 500
 * page and started getting *"We could not load checkout"* — better, and still
 * not what Constitution XVII asks for. A module that is off behaves as if never
 * installed, and a shop that has installed no delivery method renders the
 * section's empty state.
 *
 * The value of the degrade is entirely in its **asymmetry**, exactly as it is
 * for the payment twin: a `503 MODULE_DISABLED` is a decision the platform made
 * and checkout renders around it, while a 500, a draining load balancer or an
 * unparseable body is a failure that must reach the boundary. If the propagation
 * cases below ever go green by accident the catch has become blanket and a
 * genuine bug is being dressed up as a product state.
 *
 * SSR-only harness: `renderToString`, node env, no jsdom.
 */
const originalFetch = globalThis.fetch;

function stubResponse(body: unknown, status: number): void {
  globalThis.fetch = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  ) as unknown as typeof fetch;
}

describe('listDeliveryMethods when the catalogue module is switched off', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('answers no methods for the MODULE_DISABLED envelope `delivery_methods` returns', async () => {
    // The exact envelope the gated route registration produces — the shape
    // `backend/test/integration/delivery_methods/catalogue-with-delivery-capability-absent.test.ts`
    // measures against a live composition with the module switched off.
    stubResponse(
      { error: { code: 'MODULE_DISABLED', message: 'Module delivery_methods is disabled' } },
      503,
    );
    await expect(listDeliveryMethods()).resolves.toEqual([]);
  });

  it('propagates a real backend failure instead of reporting an empty catalogue', async () => {
    stubResponse({ error: { code: 'INTERNAL', message: 'boom' } }, 500);
    await expect(listDeliveryMethods()).rejects.toThrow();
  });

  it('propagates a 503 that is not a module refusal', async () => {
    // A load balancer draining, a dependency timing out. Same status, different
    // meaning; only the code discriminates them.
    stubResponse({ error: { code: 'SERVICE_UNAVAILABLE', message: 'draining' } }, 503);
    await expect(listDeliveryMethods()).rejects.toThrow();
  });

  it('returns the catalogue untouched when the module is on', async () => {
    stubResponse({ data: [{ id: 'd1', code: 'courier' }] }, 200);
    await expect(listDeliveryMethods()).resolves.toHaveLength(1);
  });
});

describe('ShippingMethods empty state', () => {
  it('renders the English sentence and no radio when nothing is available', () => {
    const html = renderToString(<ShippingMethods methods={[]} locale="en-US" />);
    expect(html).toContain('No delivery method is available');
    expect(html).not.toContain('name="deliveryMethodId"');
  });

  it('renders the Polish sentence for a pl-PL buyer', () => {
    const html = renderToString(<ShippingMethods methods={[]} locale="pl-PL" />);
    expect(html).toContain('Brak dostępnych metod dostawy');
  });

  it('falls back to English for a locale that ships no catalogue', () => {
    const html = renderToString(<ShippingMethods methods={[]} locale="de-DE" />);
    expect(html).toContain('No delivery method is available');
  });
});

describe('the delivery empty-state copy', () => {
  const en = tForLocale('en-US');
  const pl = tForLocale('pl-PL');

  it('ships in both languages, and the two differ', () => {
    // `tForLocale` falls back to `en-US` for a missing key, so equality is the
    // silent failure a missing `pl` entry produces — asserting the two differ is
    // what proves the Polish entry is really there.
    expect(en('checkout.delivery.none')).toContain('No delivery method is available');
    expect(pl('checkout.delivery.none')).toContain('Brak dostępnych metod dostawy');
    expect(pl('checkout.delivery.none')).not.toBe(en('checkout.delivery.none'));
  });

  it('is not the payment sentence', () => {
    // Two capabilities, two sentences. A buyer told "no payment method" while
    // the delivery section is the empty one is being sent to the wrong section.
    expect(en('checkout.delivery.none')).not.toBe(en('checkout.payment.none'));
    expect(pl('checkout.delivery.none')).not.toBe(pl('checkout.payment.none'));
  });
});

describe('placeOrderBlock with the delivery gate', () => {
  const ok = { canTransact: true, deliveryMethodCount: 1, paymentMethodCount: 1 };

  it('blocks on an empty delivery catalogue', () => {
    expect(placeOrderBlock({ ...ok, deliveryMethodCount: 0 })).toBe('no-delivery-method');
  });

  it('lets a buyer with one of each through', () => {
    expect(placeOrderBlock(ok)).toBeNull();
  });

  it('ranks moderation above both capability gaps', () => {
    expect(
      placeOrderBlock({ canTransact: false, deliveryMethodCount: 0, paymentMethodCount: 0 }),
    ).toBe('moderation');
  });

  it('names delivery first when the buyer has neither', () => {
    // The deliberate precedence. Checkout renders delivery above payment and the
    // delivery choice is upstream of the payment one — it sets the shipping cost
    // the total is computed from, and the total is what an amount-sensitive
    // option like the credit limit is judged against. Naming the payment gap
    // while the delivery gap is also standing walks the buyer past the first
    // section they cannot complete to the second. Fix delivery and the button
    // re-evaluates and names payment, if payment is still standing.
    expect(placeOrderBlock({ canTransact: true, deliveryMethodCount: 0, paymentMethodCount: 0 })).toBe(
      'no-delivery-method',
    );
  });

  it('still names payment when delivery is fine', () => {
    expect(placeOrderBlock({ ...ok, paymentMethodCount: 0 })).toBe('no-payment-method');
  });
});

describe('blockTitle', () => {
  const pl = tForLocale('pl-PL');

  it('gives the delivery gate the delivery sentence, in the buyer language', () => {
    // The mapping is the thing that can silently show the wrong sentence for
    // the right gate, which is why it is a function and not a ternary in JSX.
    expect(blockTitle('no-delivery-method', pl, null)).toBe(pl('checkout.delivery.none'));
  });

  it('gives the payment gate the payment sentence', () => {
    expect(blockTitle('no-payment-method', pl, null)).toBe(pl('checkout.payment.none'));
  });

  it('keeps the operator moderation message rather than translating it away', () => {
    expect(blockTitle('moderation', pl, 'Awaiting document review.')).toBe(
      'Awaiting document review.',
    );
  });

  it('has no tooltip when nothing is blocking', () => {
    expect(blockTitle(null, pl, 'Awaiting document review.')).toBeUndefined();
  });
});

describe('PlaceOrderButton for the delivery gate', () => {
  it('is disabled, with the delivery sentence as its tooltip', () => {
    const html = renderToString(
      <PlaceOrderButton
        blocked="no-delivery-method"
        label="Place order"
        pendingLabel="Placing order…"
        title={tForLocale('pl-PL')('checkout.delivery.none')}
      />,
    );
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('data-blocked="no-delivery-method"');
    expect(html).toContain('Brak dostępnych metod dostawy');
  });
});

describe('the checkout error boundary, for the delivery case', () => {
  it('never renders the delivery empty-state sentence', () => {
    // The negative half. What reaches the boundary is a genuine failure, and
    // telling that buyer "no delivery method is available" would launder a bug
    // into a product state — the same reason the payment sentence is kept out.
    const html = renderToString(
      <CheckoutError error={new Error('kaboom')} reset={(): void => {}} />,
    );
    expect(html).not.toContain('No delivery method is available');
    expect(html).toContain('We could not load checkout');
  });
});
