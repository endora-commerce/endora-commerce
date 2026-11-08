import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  adminReturnRowSchema,
  alternativeResolutionConsentSchema,
  recordAlternativeConsentRequestSchema,
  returnCaseDetailSchema,
  returnCaseSummarySchema,
  settlementPrefillSchema,
  type AdminReturnRow,
  type RecordAlternativeConsentRequest,
  type ReturnCaseDetail,
  type ReturnCaseSummary,
  type SettlementPrefill,
} from './returns.js';

/**
 * `specs/170-organization-roles/` WP-14, T147 (FR-053, R-41 item 6) — a case
 * summary names its filer, so a buyer who sees the Organization's cases can
 * tell a colleague's from their own, as the order summary carries
 * `placedByCustomerAccountId`. Additive: the detail always carried it.
 */

const FILER = '00000000-0000-4000-8000-0000000170a1';
const summary = {
  id: '00000000-0000-4000-8000-0000000170c1',
  rmaNumber: null,
  kind: 'return',
  orderId: '00000000-0000-4000-8000-0000000170d1',
  statusCode: 'new',
  statusLabel: 'New',
  totalRefundAmount: 0,
  currency: 'PLN',
  submittedAt: '2026-11-04T10:00:00.000Z',
  customerAccountId: FILER,
} as const;

describe('ReturnCaseSummary.customerAccountId (170 WP-14)', () => {
  it('is carried by the summary', () => {
    expect(returnCaseSummarySchema.parse(summary).customerAccountId).toBe(FILER);
    expectTypeOf<ReturnCaseSummary['customerAccountId']>().toEqualTypeOf<string>();
  });

  it('is required, and must be a uuid', () => {
    const { customerAccountId: _omitted, ...withoutFiler } = summary;
    expect(returnCaseSummarySchema.safeParse(withoutFiler).success).toBe(false);
    expect(returnCaseSummarySchema.safeParse({ ...summary, customerAccountId: 'colleague' }).success).toBe(false);
  });

  it('is inherited by the operator’s row', () => {
    const row = adminReturnRowSchema.parse({ ...summary, customerName: 'Ewa', organizationName: 'Acme' });
    expect(row.customerAccountId).toBe(FILER);
    expectTypeOf<AdminReturnRow['customerAccountId']>().toEqualTypeOf<string>();
  });

  it('keeps the detail’s declaration of it', () => {
    expect(returnCaseDetailSchema.shape.customerAccountId).toBeDefined();
    expect(Object.keys(returnCaseDetailSchema.shape)).toEqual(
      expect.arrayContaining(Object.keys(returnCaseSummarySchema.shape)),
    );
  });
});

/**
 * Issue #905, PR 2 (design D1): a consumer withdrawal settles as a refund, and
 * a credit, a replacement or a repair needs the consumer's consent on record.
 * The operator records it with an evidence note; the case detail and the
 * settlement prefill say what the screen needs to know.
 */
describe('consumer withdrawal — recorded consent (#905)', () => {
  const consent = {
    resolution: 'credit',
    consentGivenAt: '2026-11-10T09:30:00.000Z',
    note: "Customer's e-mail of 2026-11-10, ticket #123",
  } as const;

  it('records consent for credit, replacement or repair, never for a refund', () => {
    for (const resolution of ['credit', 'replacement', 'repair'] as const) {
      expect(recordAlternativeConsentRequestSchema.safeParse({ ...consent, resolution }).success).toBe(true);
    }
    expect(recordAlternativeConsentRequestSchema.safeParse({ ...consent, resolution: 'refund' }).success).toBe(false);
    expectTypeOf<RecordAlternativeConsentRequest['resolution']>().toEqualTypeOf<
      'credit' | 'replacement' | 'repair'
    >();
  });

  it('requires an evidence note of 1 to 2000 characters, trimmed', () => {
    expect(recordAlternativeConsentRequestSchema.parse({ ...consent, note: '  ticket #9  ' }).note).toBe('ticket #9');
    expect(recordAlternativeConsentRequestSchema.safeParse({ ...consent, note: '   ' }).success).toBe(false);
    expect(recordAlternativeConsentRequestSchema.safeParse({ ...consent, note: 'x'.repeat(2001) }).success).toBe(false);
    const { note: _note, ...withoutNote } = consent;
    expect(recordAlternativeConsentRequestSchema.safeParse(withoutNote).success).toBe(false);
  });

  it('requires the moment the consent was given', () => {
    const { consentGivenAt: _at, ...withoutDate } = consent;
    expect(recordAlternativeConsentRequestSchema.safeParse(withoutDate).success).toBe(false);
    expect(recordAlternativeConsentRequestSchema.safeParse({ ...consent, consentGivenAt: 'yesterday' }).success).toBe(false);
  });

  it('puts the classification and the consent on the case detail', () => {
    expect(returnCaseDetailSchema.shape.consumerWithdrawal).toBeDefined();
    expect(returnCaseDetailSchema.shape.alternativeResolutionConsent).toBeDefined();
    // `null` = a case created before the classification existed.
    expectTypeOf<ReturnCaseDetail['consumerWithdrawal']>().toEqualTypeOf<boolean | null>();
    const parsed = alternativeResolutionConsentSchema.parse({
      resolution: 'repair',
      at: consent.consentGivenAt,
      note: consent.note,
      byAdminUserId: FILER,
      source: 'operator_recorded',
    });
    expect(parsed.source).toBe('operator_recorded');
    // The buyer's view of the same consent leaves the note and the operator out.
    expect(
      alternativeResolutionConsentSchema.safeParse({ resolution: 'repair', at: consent.consentGivenAt, source: 'operator_recorded' })
        .success,
    ).toBe(true);
  });

  it('gives the settlement prefill its default resolution, the consent gate and the order’s payment method', () => {
    const prefill = settlementPrefillSchema.parse({
      currency: 'PLN',
      resolutionOptions: ['refund', 'credit', 'replacement', 'repair'],
      defaultResolution: 'refund',
      consentRequiredFor: ['replacement', 'repair'],
      defaultRefundPaymentMethodId: FILER,
      items: [],
    });
    expect(prefill.consentRequiredFor).toEqual(['replacement', 'repair']);
    expectTypeOf<SettlementPrefill['defaultRefundPaymentMethodId']>().toEqualTypeOf<string | null>();
    expect(
      settlementPrefillSchema.safeParse({ currency: 'PLN', resolutionOptions: ['refund'], items: [] }).success,
    ).toBe(false);
  });
});
