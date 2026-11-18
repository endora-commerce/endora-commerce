/**
 * The case detail the `ReturnDetail` tests of `specs/180-off-platform-complaints/`
 * render, with the phase-A fields (`reference`, `authorizedAt`, `authorizedBy`).
 */
export const CASE_180 = {
  id: 'r1',
  rmaNumber: null as string | null,
  reference: '#3F9A21C0',
  kind: 'complaint',
  orderId: '00000000-0000-4000-8000-000000000001',
  statusCode: 'new',
  statusLabel: 'New',
  totalRefundAmount: 0,
  currency: 'PLN',
  submittedAt: '2026-11-01T10:00:00Z',
  salesChannelId: '00000000-0000-4000-8000-000000000001',
  customerAccountId: '00000000-0000-4000-8000-000000000002',
  organizationId: '00000000-0000-4000-8000-000000000003',
  returnDeliveryMethodId: null,
  appliedReturnCost: 0,
  returnCostBearer: 'customer',
  freeReturnEligible: false,
  resolutionType: null,
  rejectionReason: null,
  consumerWithdrawal: false,
  alternativeResolutionConsent: null,
  items: [],
  comments: [] as Array<Record<string, unknown>>,
  correctiveInvoice: null,
  authorizedAt: null as string | null,
  authorizedBy: null as { adminUserId: string | null; name: string | null } | null,
};
