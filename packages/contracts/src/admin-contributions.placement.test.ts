import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  AdminZoneNameSchema,
  RECORD_TAB_ZONE_NAMES,
  isRecordTabZoneName,
  type AdminZoneProps,
  type OpportunityDetailZoneProps,
  type OrderDetailZoneProps,
  type OrganizationDetailSalesZoneProps,
  type ProjectDetailZoneProps,
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

/**
 * Issue #1905 — the Project detail was the one record screen of its family no
 * module could add to. It gains a stack after its tabs and a sidebar beside
 * them, on the terms of the order's and the quote request's two members, and
 * **no** record-tab zone: `specs/183-record-tab-contributions/research.md`
 * ruled that the Project's own tab strip adopts no contributed tab.
 */
describe('the Project detail zones (issue #1905)', () => {
  it('declares project.detail.after and project.detail.sidebar', () => {
    expect(AdminZoneNameSchema.options).toEqual(
      expect.arrayContaining(['project.detail.after', 'project.detail.sidebar']),
    );
  });

  it('declares no record-tab zone for the Project', () => {
    expect(AdminZoneNameSchema.options).not.toContain('project.detail.tabs');
    expect(isRecordTabZoneName('project.detail.after')).toBe(false);
    expect(isRecordTabZoneName('project.detail.sidebar')).toBe(false);
    expect(RECORD_TAB_ZONE_NAMES).toEqual(['opportunity.detail.tabs']);
  });

  it('carries the Project id and nothing else', () => {
    expectTypeOf<AdminZoneProps<'project.detail.after'>>().toEqualTypeOf<ProjectDetailZoneProps>();
    expectTypeOf<AdminZoneProps<'project.detail.sidebar'>>().toEqualTypeOf<ProjectDetailZoneProps>();
    expectTypeOf<ProjectDetailZoneProps>().toEqualTypeOf<{ readonly projectId: string }>();
  });
});
