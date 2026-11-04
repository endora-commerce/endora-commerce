import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  adminReturnRowSchema,
  returnCaseDetailSchema,
  returnCaseSummarySchema,
  type AdminReturnRow,
  type ReturnCaseSummary,
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
