import { describe, expect, it } from 'vitest';
import {
  judgeQuoteCommitments,
  quotesReliedOn,
  type QuoteCommitmentQuote,
} from './quote-commitment.js';

const ORG = '00000000-0000-4000-8000-0000000000aa';
const OTHER_ORG = '00000000-0000-4000-8000-0000000000ab';
const QUOTE = '00000000-0000-4000-8000-000000000301';
const OTHER_QUOTE = '00000000-0000-4000-8000-000000000302';
const NOW = new Date('2026-11-02T12:00:00.000Z');

const approved = (overrides: Partial<QuoteCommitmentQuote> = {}): QuoteCommitmentQuote => ({
  organizationId: ORG,
  status: 'Approved',
  expiresAt: new Date('2026-11-09T12:00:00.000Z'),
  ...overrides,
});

const judge = (
  quotes: Record<string, QuoteCommitmentQuote | null>,
  relied: { quoteRequestIds: string[]; unattributed: boolean } = { quoteRequestIds: Object.keys(quotes), unattributed: false },
  quoteDeskPresent = true,
) =>
  judgeQuoteCommitments({
    organizationId: ORG,
    relied,
    quoteDeskPresent,
    quotes: new Map(Object.entries(quotes)),
    now: NOW,
  });

describe('quotesReliedOn — the basket lines ordered at a quote’s agreed price (issue #167)', () => {
  const cart = { sourceQuoteRequestId: QUOTE };

  it('names the quote of a line still at its agreed quantity', () => {
    expect(
      quotesReliedOn(cart, [{ quantity: 5, quoteSeededQuantity: 5, quoteRequestId: QUOTE }]),
    ).toEqual({ quoteRequestIds: [QUOTE], unattributed: false });
  });

  it('ignores a line moved off its agreed quantity — it is priced from the list', () => {
    expect(
      quotesReliedOn(cart, [{ quantity: 6, quoteSeededQuantity: 5, quoteRequestId: QUOTE }]),
    ).toEqual({ quoteRequestIds: [], unattributed: false });
  });

  it('ignores a line that carries no agreement', () => {
    expect(
      quotesReliedOn(cart, [{ quantity: 5, quoteSeededQuantity: null, quoteRequestId: null }]),
    ).toEqual({ quoteRequestIds: [], unattributed: false });
  });

  it('falls back to the basket’s mark for a line seeded before lines named their quote', () => {
    expect(quotesReliedOn(cart, [{ quantity: 5, quoteSeededQuantity: 5 }])).toEqual({
      quoteRequestIds: [QUOTE],
      unattributed: false,
    });
  });

  it('reports an agreed line no quote is named for at all', () => {
    expect(
      quotesReliedOn({ sourceQuoteRequestId: null }, [{ quantity: 5, quoteSeededQuantity: 5, quoteRequestId: null }]),
    ).toEqual({ quoteRequestIds: [], unattributed: true });
  });

  it('names each quote once', () => {
    expect(
      quotesReliedOn(cart, [
        { quantity: 5, quoteSeededQuantity: 5, quoteRequestId: QUOTE },
        { quantity: 2, quoteSeededQuantity: 2, quoteRequestId: QUOTE },
        { quantity: 1, quoteSeededQuantity: 1, quoteRequestId: OTHER_QUOTE },
      ]),
    ).toEqual({ quoteRequestIds: [QUOTE, OTHER_QUOTE], unattributed: false });
  });
});

describe('judgeQuoteCommitments — a quote’s agreed prices bind until its validity ends (issue #167)', () => {
  it('honours a basket that relies on no quote', () => {
    expect(judge({}, { quoteRequestIds: [], unattributed: false })).toBeNull();
  });

  it('honours an approved quote inside its validity window', () => {
    expect(judge({ [QUOTE]: approved() })).toBeNull();
  });

  it('honours an approved quote the operator set no validity date on', () => {
    expect(judge({ [QUOTE]: approved({ expiresAt: null }) })).toBeNull();
  });

  it('refuses a quote whose validity date has passed since the basket was seeded', () => {
    expect(judge({ [QUOTE]: approved({ expiresAt: new Date('2026-11-01T12:00:00.000Z') }) })).toBe('lapsed');
  });

  it('refuses at the validity instant itself — the boundary `quote_requests` applies', () => {
    expect(judge({ [QUOTE]: approved({ expiresAt: NOW }) })).toBe('lapsed');
  });

  it('honours a quote another order has already completed — one quote, one source, not one price (FR-100)', () => {
    expect(judge({ [QUOTE]: approved({ status: 'Completed' }) })).toBeNull();
  });

  it('still refuses a completed quote once its validity has passed', () => {
    expect(
      judge({ [QUOTE]: approved({ status: 'Completed', expiresAt: new Date('2026-11-01T12:00:00.000Z') }) }),
    ).toBe('lapsed');
  });

  it.each(['Canceled', 'Expired', 'Pending', 'Created from admin'] as const)(
    'refuses a quote that moved to %s after the basket was seeded',
    (status) => {
      expect(judge({ [QUOTE]: approved({ status }) })).toBe('withdrawn');
    },
  );

  it('refuses a quote that no longer exists', () => {
    expect(judge({ [QUOTE]: null })).toBe('withdrawn');
  });

  it('refuses a quote of another Organization (Constitution XI)', () => {
    expect(judge({ [QUOTE]: approved({ organizationId: OTHER_ORG }) })).toBe('withdrawn');
  });

  it('refuses an agreed line no quote is named for', () => {
    expect(judge({}, { quoteRequestIds: [], unattributed: true })).toBe('withdrawn');
  });

  it('refuses when one of two quotes has lapsed', () => {
    expect(
      judge({
        [QUOTE]: approved(),
        [OTHER_QUOTE]: approved({ expiresAt: new Date('2026-11-01T12:00:00.000Z') }),
      }),
    ).toBe('lapsed');
  });

  it('fails closed while quote_requests is off: nothing can vouch for an agreed price', () => {
    expect(judge({}, { quoteRequestIds: [QUOTE], unattributed: false }, false)).toBe('unavailable');
  });

  it('asks nothing of an absent quote desk for a basket that relies on no quote', () => {
    expect(judge({}, { quoteRequestIds: [], unattributed: false }, false)).toBeNull();
  });
});
