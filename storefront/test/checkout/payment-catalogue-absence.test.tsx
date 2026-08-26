import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { listPaymentMethods } from '../../lib/api/methods';
import CheckoutError from '../../app/(commerce)/checkout/error';
import { documentLocale, FALLBACK_LOCALE } from '../../lib/i18n/document-locale';

/**
 * The two halves of "checkout does not 500 when payment capability is absent".
 *
 * The first half is the degrade, and its value is entirely in the *asymmetry*:
 * a `503 MODULE_DISABLED` is a decision the platform made and checkout renders
 * around it, while a 500, a 502 or an unparseable body is a failure the buyer
 * must not be shown as "no payment method is available". If the second set of
 * assertions ever goes green by accident, this file has stopped being worth
 * anything — the catch would be blanket and a genuine bug would be dressed up
 * as a product state.
 *
 * The second half is the boundary those failures now reach. It is asserted to
 * say something *different* from the empty state, for the same reason.
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

describe('listPaymentMethods when the catalogue module is switched off', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('answers no methods for the MODULE_DISABLED envelope `payment_methods` returns', () => {
    // The exact envelope the gated route registration produces. Before this the
    // error escaped `listPaymentMethods`, was re-thrown by the checkout page's
    // `Promise.all` catch (which tolerates only 401) and — with no `error.tsx`
    // anywhere under `storefront/app` — reached the buyer as Next's 500 page.
    stubResponse(
      { error: { code: 'MODULE_DISABLED', message: 'Module payment_methods is disabled' } },
      503,
    );
    return expect(listPaymentMethods()).resolves.toEqual([]);
  });

  it('propagates a real backend failure instead of reporting an empty catalogue', async () => {
    stubResponse({ error: { code: 'INTERNAL', message: 'boom' } }, 500);
    await expect(listPaymentMethods()).rejects.toThrow();
  });

  it('propagates a 503 that is not a module refusal', async () => {
    // A load balancer draining, a dependency timing out. Same status, different
    // meaning; only the code discriminates them.
    stubResponse({ error: { code: 'SERVICE_UNAVAILABLE', message: 'draining' } }, 503);
    await expect(listPaymentMethods()).rejects.toThrow();
  });

  it('returns the catalogue untouched when the module is on', async () => {
    stubResponse({ data: [{ id: 'p1', code: 'bank_transfer' }] }, 200);
    await expect(listPaymentMethods()).resolves.toHaveLength(1);
  });
});

describe('the checkout error boundary', () => {
  const render = (digest?: string): string => {
    const error = Object.assign(new Error('kaboom'), digest ? { digest } : {});
    return renderToString(<CheckoutError error={error} reset={(): void => {}} />);
  };

  it('says checkout failed, not that no payment method is available', () => {
    const html = render();
    expect(html).toContain('We could not load checkout');
    // The distinction this whole change rests on: a genuine bug must not be
    // laundered into the empty state's friendly, actionable-looking sentence.
    expect(html).not.toContain('No payment method is available');
  });

  it('offers a retry and a way back rather than a dead end', () => {
    const html = render();
    expect(html).toContain('Try again');
    expect(html).toContain('/cart');
  });

  it('shows the digest Next attaches, so a report can be joined to the server log', () => {
    expect(render('9f2c1a')).toContain('9f2c1a');
    expect(render()).not.toContain('Reference:');
  });

  it('renders the fallback language on the server, where there is no document', () => {
    // A hydration match, not a translation gap: the boundary reads `<html lang>`
    // after mount, so the server HTML and the first client render agree here.
    expect(documentLocale()).toBe(FALLBACK_LOCALE);
    expect(render()).toContain('We could not load checkout');
  });
});
