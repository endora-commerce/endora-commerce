import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common.js';

/**
 * Returns & Complaints (Refunds, RMA) — feature 046.
 *
 * Source-of-truth Zod schemas for the returns module boundary (admin + customer
 * APIs and the configurable workflow). Mirrors the orders module's contract
 * organization. TS types are inferred (`z.infer`), never hand-maintained.
 */

// ---------------------------------------------------------------------------
// Core enums
// ---------------------------------------------------------------------------

/** A case is either a withdrawal-style Return or a warranty Complaint. */
export const returnKindSchema = z.enum(['return', 'complaint']);
export type ReturnKind = z.infer<typeof returnKindSchema>;

/** Settlement resolution chosen by the admin. */
export const resolutionTypeSchema = z.enum(['refund', 'credit', 'replacement', 'repair']);
export type ResolutionType = z.infer<typeof resolutionTypeSchema>;

/** State of a recorded refund's money movement. */
export const settlementStateSchema = z.enum(['issued', 'pending_manual', 'failed']);
export type SettlementState = z.infer<typeof settlementStateSchema>;

/** Who bears the return shipping cost. */
export const returnCostBearerSchema = z.enum(['shop', 'customer']);
export type ReturnCostBearer = z.infer<typeof returnCostBearerSchema>;

/** Inspection outcome for a received line. */
export const inspectionOutcomeSchema = z.enum(['pending', 'passed', 'failed']);
export type InspectionOutcome = z.infer<typeof inspectionOutcomeSchema>;

/** Status code is a free-form machine identifier (the workflow is configurable). */
export const returnStatusCodeSchema = z.string().min(1).max(64);

// ---------------------------------------------------------------------------
// Status graph (workflow configuration — US3)
// ---------------------------------------------------------------------------

export const returnStatusSchema = z.object({
  code: returnStatusCodeSchema,
  name: z.record(z.string().min(2), z.string()),
  defaultName: z.string().min(1),
  isInitial: z.boolean(),
  isTerminal: z.boolean(),
  isSystem: z.boolean(),
  weight: z.number().int(),
  color: z.string(),
});
export type ReturnStatusDto = z.infer<typeof returnStatusSchema>;

export const returnTransitionSchema = z.object({
  fromStatusCode: returnStatusCodeSchema,
  toStatusCode: returnStatusCodeSchema,
  isSystem: z.boolean(),
});
export type ReturnTransitionDto = z.infer<typeof returnTransitionSchema>;

export const returnStatusGraphResponseSchema = z.object({
  statuses: z.array(returnStatusSchema.extend({ inUseCount: z.number().int().nonnegative() })),
  transitions: z.array(returnTransitionSchema),
});
export type ReturnStatusGraphResponse = z.infer<typeof returnStatusGraphResponseSchema>;

export const returnStatusCreateSchema = z.object({
  code: z.string().min(1).max(64).regex(/^[a-z0-9_]+$/, 'lowercase, digits, underscore only'),
  name: z.record(z.string().min(2), z.string()),
  defaultName: z.string().min(1).max(120),
  isTerminal: z.boolean().optional(),
  weight: z.number().int().optional(),
  color: z.string().max(16).optional(),
});

export const returnStatusUpdateSchema = z.object({
  name: z.record(z.string().min(2), z.string()).optional(),
  defaultName: z.string().min(1).max(120).optional(),
  isTerminal: z.boolean().optional(),
  weight: z.number().int().optional(),
  color: z.string().max(16).optional(),
});

export const returnTransitionsSetSchema = z.object({
  transitions: z.array(
    z.object({ fromStatusCode: returnStatusCodeSchema, toStatusCode: returnStatusCodeSchema }),
  ),
});

// ---------------------------------------------------------------------------
// Case + items
// ---------------------------------------------------------------------------

export const returnCaseItemSchema = z.object({
  id: uuidSchema,
  orderItemId: uuidSchema,
  productId: uuidSchema,
  productName: z.string(),
  quantity: z.number().int().positive(),
  reasonId: uuidSchema.nullable(),
  description: z.string().nullable(),
  inspectionOutcome: inspectionOutcomeSchema.nullable(),
  defaultRefundAmount: z.number().finite(),
  approvedRefundAmount: z.number().finite(),
});
export type ReturnCaseItemDto = z.infer<typeof returnCaseItemSchema>;

export const returnCaseCommentSchema = z.object({
  id: uuidSchema,
  authorKind: z.enum(['admin', 'customer']),
  body: z.string(),
  isCustomerVisible: z.boolean(),
  createdAt: isoDateTimeSchema,
});
export type ReturnCaseCommentDto = z.infer<typeof returnCaseCommentSchema>;

export const returnCaseSummarySchema = z.object({
  id: uuidSchema,
  rmaNumber: z.string().nullable(),
  kind: returnKindSchema,
  orderId: uuidSchema,
  statusCode: returnStatusCodeSchema,
  statusLabel: z.string(),
  totalRefundAmount: z.number().finite(),
  currency: z.string().length(3),
  submittedAt: isoDateTimeSchema,
});
export type ReturnCaseSummary = z.infer<typeof returnCaseSummarySchema>;

export const returnCaseDetailSchema = returnCaseSummarySchema.extend({
  salesChannelId: uuidSchema,
  customerAccountId: uuidSchema,
  organizationId: uuidSchema.nullable(),
  returnDeliveryMethodId: uuidSchema.nullable(),
  appliedReturnCost: z.number().finite(),
  returnCostBearer: returnCostBearerSchema,
  freeReturnEligible: z.boolean(),
  resolutionType: resolutionTypeSchema.nullable(),
  rejectionReason: z.string().nullable(),
  items: z.array(returnCaseItemSchema),
  comments: z.array(returnCaseCommentSchema),
});
export type ReturnCaseDetail = z.infer<typeof returnCaseDetailSchema>;

// ---------------------------------------------------------------------------
// Customer requests (US1)
// ---------------------------------------------------------------------------

export const returnableLineSchema = z.object({
  orderItemId: uuidSchema,
  productId: uuidSchema,
  name: z.string(),
  purchasedQty: z.number().int().positive(),
  remainingReturnableQty: z.number().int().nonnegative(),
  paidUnitAmount: z.number().finite(),
  currency: z.string().length(3),
});

export const returnableResponseSchema = z.object({
  eligible: z.boolean(),
  reason: z.enum(['order_not_completing', 'window_passed', 'fully_returned']).optional(),
  freeReturnEligible: z.boolean(),
  lines: z.array(returnableLineSchema),
});
export type ReturnableResponse = z.infer<typeof returnableResponseSchema>;

export const createReturnCaseRequestSchema = z.object({
  orderId: uuidSchema,
  kind: returnKindSchema,
  lines: z
    .array(
      z.object({
        orderItemId: uuidSchema,
        quantity: z.number().int().positive(),
        reasonId: uuidSchema,
        description: z.string().max(2000).optional(),
      }),
    )
    .min(1),
  attachmentAssetIds: z.array(uuidSchema).optional(),
  comment: z.string().max(2000).optional(),
});
export type CreateReturnCaseRequest = z.infer<typeof createReturnCaseRequestSchema>;

export const customerAddCommentRequestSchema = z.object({ body: z.string().min(1).max(2000) });

// ---------------------------------------------------------------------------
// Admin requests (US2 / US3)
// ---------------------------------------------------------------------------

export const adminTransitionRequestSchema = z.object({
  to: returnStatusCodeSchema,
  reason: z.string().max(2000).optional(),
});

export const adminRejectRequestSchema = z.object({ reason: z.string().min(1).max(2000) });

export const adminAddCommentRequestSchema = z.object({
  body: z.string().min(1).max(2000),
  isCustomerVisible: z.boolean(),
  notifyCustomer: z.boolean(),
});

export const adminReturnRowSchema = returnCaseSummarySchema.extend({
  customerName: z.string().nullable(),
  organizationName: z.string().nullable(),
});
export type AdminReturnRow = z.infer<typeof adminReturnRowSchema>;

// ---------------------------------------------------------------------------
// Settlement (US5)
// ---------------------------------------------------------------------------

export const settlementPrefillSchema = z.object({
  currency: z.string().length(3),
  resolutionOptions: z.array(resolutionTypeSchema),
  items: z.array(
    z.object({
      returnCaseItemId: uuidSchema,
      productName: z.string(),
      quantity: z.number().int().positive(),
      defaultRefundAmount: z.number().finite(),
      approvedRefundAmount: z.number().finite(),
    }),
  ),
});
export type SettlementPrefill = z.infer<typeof settlementPrefillSchema>;

export const settlementRequestSchema = z.object({
  resolutionType: resolutionTypeSchema,
  lines: z
    .array(
      z.object({
        returnCaseItemId: uuidSchema,
        approvedRefundAmount: z.number().finite().nonnegative(),
      }),
    )
    .default([]),
  refundPaymentMethodId: uuidSchema.optional(),
  createCorrectiveInvoice: z.boolean().optional(),
});
export type SettlementRequest = z.infer<typeof settlementRequestSchema>;

export const settlementResultSchema = z.object({
  totalRefundAmount: z.number().finite(),
  refund: z
    .object({
      settlementState: settlementStateSchema,
      externalReference: z.string().nullable().optional(),
    })
    .optional(),
  correctiveInvoiceId: uuidSchema.nullable().optional(),
  creditLimitTopupApplied: z.boolean().optional(),
});
export type SettlementResult = z.infer<typeof settlementResultSchema>;

// ---------------------------------------------------------------------------
// Return delivery methods + shipments (US6)
// ---------------------------------------------------------------------------

export const returnDeliveryMethodSchema = z.object({
  id: uuidSchema,
  deliveryMethodId: uuidSchema,
  returnCost: z.number().finite().nonnegative(),
  currency: z.string().length(3),
  isActive: z.boolean(),
});
export type ReturnDeliveryMethodDto = z.infer<typeof returnDeliveryMethodSchema>;

export const returnDeliveryMethodCreateSchema = z.object({
  deliveryMethodId: uuidSchema,
  returnCost: z.number().finite().nonnegative(),
  currency: z.string().length(3),
  isActive: z.boolean().optional(),
});

export const returnDeliveryMethodUpdateSchema = z.object({
  returnCost: z.number().finite().nonnegative().optional(),
  currency: z.string().length(3).optional(),
  isActive: z.boolean().optional(),
});

export const selectReturnDeliveryMethodRequestSchema = z.object({
  returnDeliveryMethodId: uuidSchema,
});

export const selectReturnDeliveryMethodResultSchema = z.object({
  appliedReturnCost: z.number().finite(),
  returnCostBearer: returnCostBearerSchema,
  currency: z.string().length(3),
});

export const returnShipmentDirectionSchema = z.enum(['inbound', 'replacement']);

export const returnShipmentSchema = z.object({
  id: uuidSchema,
  direction: returnShipmentDirectionSchema,
  deliveryMethodId: uuidSchema.nullable(),
  externalReference: z.string().nullable(),
  status: z.enum(['pending', 'received', 'failed']),
  createdAt: isoDateTimeSchema,
});
export type ReturnShipmentDto = z.infer<typeof returnShipmentSchema>;

export const createReturnShipmentRequestSchema = z.object({
  direction: returnShipmentDirectionSchema,
  deliveryMethodId: uuidSchema.optional(),
  externalReference: z.string().max(128).optional(),
});

// ---------------------------------------------------------------------------
// Reasons (US7)
// ---------------------------------------------------------------------------

export const reasonAppliesToSchema = z.enum(['return', 'complaint', 'both']);

export const returnReasonSchema = z.object({
  id: uuidSchema,
  label: z.record(z.string().min(2), z.string()),
  appliesTo: reasonAppliesToSchema,
  isActive: z.boolean(),
  weight: z.number().int(),
});
export type ReturnReasonDto = z.infer<typeof returnReasonSchema>;

export const returnReasonCreateSchema = z.object({
  label: z.record(z.string().min(2), z.string()),
  appliesTo: reasonAppliesToSchema,
  isActive: z.boolean().optional(),
  weight: z.number().int().optional(),
});

export const returnReasonUpdateSchema = z.object({
  label: z.record(z.string().min(2), z.string()).optional(),
  appliesTo: reasonAppliesToSchema.optional(),
  isActive: z.boolean().optional(),
  weight: z.number().int().optional(),
});

// ---------------------------------------------------------------------------
// Admin list, bulk actions, saved views, export (US8)
// ---------------------------------------------------------------------------

export const adminReturnsSortSchema = z.enum([
  'submittedAt:asc',
  'submittedAt:desc',
  'rmaNumber:asc',
  'rmaNumber:desc',
]);

export const adminReturnsListQuerySchema = z.object({
  /** Comma-separated status codes. */
  status: z.string().optional(),
  kind: returnKindSchema.optional(),
  rmaNumber: z.string().optional(),
  q: z.string().optional(),
  sort: adminReturnsSortSchema.optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(200).optional(),
});
export type AdminReturnsListQuery = z.infer<typeof adminReturnsListQuerySchema>;

export const adminReturnsListResponseSchema = z.object({
  rows: z.array(adminReturnRowSchema),
  total: z.number().int().nonnegative(),
  counts: z.record(z.string(), z.number().int().nonnegative()),
});
export type AdminReturnsListResponse = z.infer<typeof adminReturnsListResponseSchema>;

export const bulkTransitionRequestSchema = z.object({
  ids: z.array(uuidSchema).min(1),
  to: returnStatusCodeSchema,
  reason: z.string().max(2000).optional(),
});

export const bulkTransitionResultSchema = z.object({
  moved: z.array(uuidSchema),
  skipped: z.array(z.object({ id: uuidSchema, reason: z.string() })),
});
export type BulkTransitionResult = z.infer<typeof bulkTransitionResultSchema>;

export const returnSavedViewSortSchema = z.object({
  field: z.string(),
  dir: z.enum(['asc', 'desc']),
});

export const returnSavedViewSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  shared: z.boolean(),
  filters: z.record(z.string(), z.unknown()),
  sort: returnSavedViewSortSchema,
  visibleColumns: z.array(z.string()).nullable(),
});
export type ReturnSavedViewDto = z.infer<typeof returnSavedViewSchema>;

export const returnSavedViewCreateSchema = z.object({
  name: z.string().min(1).max(200),
  shared: z.boolean().optional(),
  filters: z.record(z.string(), z.unknown()),
  sort: returnSavedViewSortSchema,
  visibleColumns: z.array(z.string()).optional(),
});

export const returnSavedViewUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  shared: z.boolean().optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
  sort: returnSavedViewSortSchema.optional(),
  visibleColumns: z.array(z.string()).nullable().optional(),
});
