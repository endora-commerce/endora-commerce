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
