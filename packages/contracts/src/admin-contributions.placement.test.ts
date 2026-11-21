import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  AdminZoneNameSchema,
  type AdminZoneProps,
  type OpportunityDetailZoneProps,
  type OrderDetailZoneProps,
  type OrganizationDetailSalesZoneProps,
  type QuoteRequestDetailZoneProps,
} from './admin-contributions.js';

/**
 * Issue #1452 (UX audit DS-20) and #1526 (WORK-12) — a contribution declares
 * whether it belongs in a tab body or in a sidebar by naming the host-declared
 * member for that place. The placement is the member, so `check:admin-zones`
 * compares it to what the host renders.
 */
describe('placement members of the zone enum', () => {
  it('declares the organization Sales tab body and three detail sidebars', () => {
    expect(AdminZoneNameSchema.options).toEqual(
      expect.arrayContaining([
        'organization.detail.sales',
        'order.detail.sidebar',
        'quote_request.detail.sidebar',
        'opportunity.detail.sidebar',
      ]),
    );
  });

  it('keeps every `.detail.after` member the sidebars sit beside', () => {
    expect(AdminZoneNameSchema.options).toEqual(
      expect.arrayContaining([
        'organization.detail.after',
        'order.detail.after',
        'quote_request.detail.after',
        'opportunity.detail.after',
        'task.detail.after',
      ]),
    );
  });

  it('carries the host record id and nothing else', () => {
    expectTypeOf<AdminZoneProps<'organization.detail.sales'>>().toEqualTypeOf<OrganizationDetailSalesZoneProps>();
    expectTypeOf<OrganizationDetailSalesZoneProps>().toEqualTypeOf<{ readonly organizationId: string }>();
    expectTypeOf<AdminZoneProps<'order.detail.sidebar'>>().toEqualTypeOf<OrderDetailZoneProps>();
    expectTypeOf<AdminZoneProps<'quote_request.detail.sidebar'>>().toEqualTypeOf<QuoteRequestDetailZoneProps>();
    expectTypeOf<AdminZoneProps<'opportunity.detail.sidebar'>>().toEqualTypeOf<OpportunityDetailZoneProps>();
  });
});
