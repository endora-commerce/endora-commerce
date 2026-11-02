import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { QuoteValidityNotice } from '../../components/checkout/QuoteValidityNotice';
import { blockTitle, placeOrderBlock } from '../../lib/checkout/place-order-gate';
import { tForLocale } from '../../lib/i18n/messages';

/**
 * Issue #167 — the checkout preview's `quoteCommitmentRefusal`: the basket is priced at a quote
 * that no longer binds, so placement will refuse it (`410 QUOTE_VALIDITY_ENDED`). The page says
 * so, in the buyer's language, before they try — and the Place Order button is blocked.
 */

describe('placeOrderBlock — a quote that no longer binds', () => {
  const open = { canTransact: true, deliveryMethodCount: 1, paymentMethodCount: 1 };

  it('blocks on an ended quote', () => {
    expect(placeOrderBlock({ ...open, quoteEnded: true })).toBe('quote-ended');
  });

  it('ranks it after moderation and before the minimums — a new quote is the upstream fix', () => {
    expect(placeOrderBlock({ ...open, canTransact: false, quoteEnded: true })).toBe('moderation');
    expect(placeOrderBlock({ ...open, quoteEnded: true, belowMinimum: true })).toBe('quote-ended');
  });

  it('does not block without one', () => {
    expect(placeOrderBlock({ ...open, quoteEnded: false })).toBeNull();
  });

  it('has a tooltip sentence in both languages', () => {
    expect(blockTitle('quote-ended', tForLocale('en-US'), null)).toBe(
      'The prices in your basket come from a quote that can no longer be ordered.',
    );
    expect(blockTitle('quote-ended', tForLocale('pl-PL'), null)).toBe(
      'Ceny w koszyku pochodzą z oferty, której nie można już zamówić.',
    );
  });
});

describe('QuoteValidityNotice', () => {
  const render = (refusal: 'lapsed' | 'withdrawn' | 'unavailable' | null, locale = 'en-US') =>
    renderToString(<QuoteValidityNotice id="checkout-quote-ended" refusal={refusal} locale={locale} />);

  it('renders nothing when the quote prices still bind', () => {
    expect(render(null)).toBe('');
  });

  it('says the quote expired and a new one is needed', () => {
    const html = render('lapsed');
    expect(html).toContain('id="checkout-quote-ended"');
    expect(html).toContain('The quote has expired');
    expect(html).toContain('Ask your sales representative for a new quote');
    expect(html).toContain('href="/quote-requests"');
    expect(html).toContain('href="/cart"');
  });

  it('says the same in Polish', () => {
    const html = render('lapsed', 'pl-PL');
    expect(html).toContain('Oferta straciła ważność');
    expect(html).toContain('Poproś opiekuna handlowego o nową ofertę');
  });

  it('says a withdrawn quote is no longer in force', () => {
    expect(render('withdrawn')).toContain('The quote is no longer in force');
    expect(render('withdrawn', 'pl-PL')).toContain('Oferta już nie obowiązuje');
  });

  it('offers no quote link while quotes cannot be confirmed — only the cart', () => {
    const html = render('unavailable');
    expect(html).toContain('Quote prices cannot be confirmed');
    expect(html).not.toContain('href="/quote-requests"');
    expect(html).toContain('href="/cart"');
  });
});
