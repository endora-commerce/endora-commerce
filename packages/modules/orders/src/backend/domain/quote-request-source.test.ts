import { describe, expect, it } from 'vitest';
import { judgeQuoteRequestSource, type QuoteRequestSourceClaim } from './quote-request-source.js';

const ORG = '00000000-0000-4000-8000-0000000000aa';
const OTHER_ORG = '00000000-0000-4000-8000-0000000000ab';
const PRODUCT = '00000000-0000-4000-8000-000000000101';
const OTHER_PRODUCT = '00000000-0000-4000-8000-000000000102';
const VARIANT = '00000000-0000-4000-8000-000000000201';

const claim = (overrides: Partial<QuoteRequestSourceClaim> = {}): QuoteRequestSourceClaim => ({
  orderOrganizationId: ORG,
  quoteRequest: { organizationId: ORG, status: 'Approved' },
  alreadyOrdered: false,
  quoteRequestLines: [{ productId: PRODUCT, variantId: null, agreedUnitPrice: '11.2500' }],
  basketLines: [{ productId: PRODUCT, variantId: null, unitPrice: '11.25' }],
  ...overrides,
});

describe('judgeQuoteRequestSource', () => {
  it('accepts an approved request of the same Organization whose agreed line is on the basket', () => {
    expect(judgeQuoteRequestSource(claim())).toEqual({ accepted: true });
  });

  it('accepts it with other lines beside the agreed one', () => {
    const judged = judgeQuoteRequestSource(
      claim({
        basketLines: [
          { productId: OTHER_PRODUCT, variantId: null, unitPrice: '24.50' },
          { productId: PRODUCT, variantId: null, unitPrice: '11.25' },
        ],
      }),
    );
    expect(judged).toEqual({ accepted: true });
  });

  it('refuses a request that does not exist', () => {
    expect(judgeQuoteRequestSource(claim({ quoteRequest: null }))).toEqual({ accepted: false, reason: 'not-found' });
  });

  it('refuses a request of another Organization, before anything else about it is weighed', () => {
    expect(
      judgeQuoteRequestSource(claim({ quoteRequest: { organizationId: OTHER_ORG, status: 'Approved' } })),
    ).toEqual({ accepted: false, reason: 'other-organization' });
  });

  it.each(['Pending', 'Created from admin', 'Canceled', 'Expired', 'Completed'] as const)(
    'refuses a request that is %s',
    (status) => {
      expect(judgeQuoteRequestSource(claim({ quoteRequest: { organizationId: ORG, status } }))).toEqual({
        accepted: false,
        reason: 'not-convertible',
      });
    },
  );

  it('refuses a request an Order already names, though it still reads Approved', () => {
    expect(judgeQuoteRequestSource(claim({ alreadyOrdered: true }))).toEqual({
      accepted: false,
      reason: 'already-ordered',
    });
  });

  it('refuses when the product is there at another price — re-added from the price list', () => {
    expect(
      judgeQuoteRequestSource(claim({ basketLines: [{ productId: PRODUCT, variantId: null, unitPrice: '19.99' }] })),
    ).toEqual({ accepted: false, reason: 'no-agreed-line' });
  });

  it('refuses when only other products are left', () => {
    expect(
      judgeQuoteRequestSource(
        claim({ basketLines: [{ productId: OTHER_PRODUCT, variantId: null, unitPrice: '11.25' }] }),
      ),
    ).toEqual({ accepted: false, reason: 'no-agreed-line' });
  });

  it('tells a variant from its product', () => {
    expect(
      judgeQuoteRequestSource(claim({ basketLines: [{ productId: PRODUCT, variantId: VARIANT, unitPrice: '11.25' }] })),
    ).toEqual({ accepted: false, reason: 'no-agreed-line' });
  });

  it('never reads a line with no agreed price as zero', () => {
    expect(
      judgeQuoteRequestSource(
        claim({
          quoteRequestLines: [{ productId: PRODUCT, variantId: null, agreedUnitPrice: null }],
          basketLines: [{ productId: PRODUCT, variantId: null, unitPrice: '0.0000' }],
        }),
      ),
    ).toEqual({ accepted: false, reason: 'no-agreed-line' });
  });

  it('recognises an agreed price of exactly zero', () => {
    expect(
      judgeQuoteRequestSource(
        claim({
          quoteRequestLines: [{ productId: PRODUCT, variantId: null, agreedUnitPrice: '0.0000' }],
          basketLines: [{ productId: PRODUCT, variantId: null, unitPrice: '0.00' }],
        }),
      ),
    ).toEqual({ accepted: true });
  });

  it('refuses an empty basket', () => {
    expect(judgeQuoteRequestSource(claim({ basketLines: [] }))).toEqual({ accepted: false, reason: 'no-agreed-line' });
  });
});
