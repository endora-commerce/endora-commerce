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

/**
 * What became of the corrective invoice for a settled case (D-92, issue #156).
 *
 * Three values, because `correctiveInvoiceId: null` is a two-way answer to a
 * three-way question: it stands for "no correction was due", "none was asked
 * for" and "one was asked for and we do not know" at once. `not_due` carries
 * its own reason in the enum — `order_not_invoiced` is the only one there is,
 * and a second reason becomes a fourth value rather than a free-text column.
 *
 * `issued` is exactly the case where the settlement holds an invoice id.
 */
export const correctiveInvoiceOutcomeSchema = z.enum(['issued', 'not_due', 'not_requested']);
export type CorrectiveInvoiceOutcome = z.infer<typeof correctiveInvoiceOutcomeSchema>;

/**
 * The persisted corrective-invoice answer, as the case detail reports it.
 *
 * The settlement *response* (`settlementResultSchema` below) says the same
 * thing with the document's number attached, and only at the moment of
 * settling. This is the copy a reloaded screen reads, so it names what the
 * `Refund` row holds and nothing else: resolving the number would mean reading
 * `invoices` from `returns` on a screen that must keep answering while that
 * module is off.
 */
export const returnCaseCorrectiveInvoiceSchema = z.object({
  outcome: correctiveInvoiceOutcomeSchema,
  /** The correction, when one was issued. Null in the other two outcomes. */
  invoiceId: uuidSchema.nullable(),
});
export type ReturnCaseCorrectiveInvoice = z.infer<typeof returnCaseCorrectiveInvoiceSchema>;

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
  /**
   * Null while the case has no `Refund` row — never settled, or settled as a
   * replacement or repair, which corrects no document and is not an outcome of
   * "not requested" (D-92).
   */
  correctiveInvoice: returnCaseCorrectiveInvoiceSchema.nullable(),
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

export const addReturnAttachmentRequestSchema = z.object({
  assetId: uuidSchema,
  returnCaseItemId: uuidSchema.optional(),
});

export const returnAttachmentSchema = z.object({
  id: uuidSchema,
  returnCaseId: uuidSchema,
  returnCaseItemId: uuidSchema.nullable(),
  assetId: uuidSchema,
  createdAt: isoDateTimeSchema,
});
export type ReturnAttachmentDto = z.infer<typeof returnAttachmentSchema>;

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

/**
 * What became of the corrective invoice a settlement asked for (#135).
 *
 * Both outcomes are stated. A settled return on an order that was never
 * invoiced corrects no VAT document, and this says so with a reason instead of
 * leaving the caller to read it out of a missing id — reading absence is how
 * the never-invoiced path came to emit a document that corrected nothing.
 */
export const settlementCorrectiveInvoiceSchema = z.discriminatedUnion('issued', [
  z.object({
    issued: z.literal(true),
    invoiceId: uuidSchema,
    number: z.string(),
  }),
  z.object({
    issued: z.literal(false),
    /** `order_not_invoiced` — the order carries no VAT invoice to correct. */
    reason: z.enum(['order_not_invoiced']),
  }),
]);
export type SettlementCorrectiveInvoice = z.infer<typeof settlementCorrectiveInvoiceSchema>;

export const settlementResultSchema = z.object({
  totalRefundAmount: z.number().finite(),
  refund: z
    .object({
      settlementState: settlementStateSchema,
      externalReference: z.string().nullable().optional(),
      failureReason: z.string().nullable().optional(),
    })
    .optional(),
  correctiveInvoiceId: uuidSchema.nullable().optional(),
  /** Present whenever a correction was asked for — issued or not (#135). */
  correctiveInvoice: settlementCorrectiveInvoiceSchema.optional(),
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

// ---------------------------------------------------------------------------
// --- ports -----------------------------------------------------------------
//
// The refund seam, published early (feature 075, Phase P).
//
// `returns` declares this shape and `payments` — through the four gateway
// modules — implements it. That direction is deliberate (R-03) and publishing
// it keeps it: the consumer states what it needs and the gateways satisfy it.
//
// It lands in the first Phase-P wave rather than the third, where the rest of
// `returns`' ports sit, because `payments` is a first-wave provider and its
// `GatewayRefundHandler` is written against these two shapes. Publishing the
// handler without them would leave the contract naming a file in a module.
// ---------------------------------------------------------------------------

export interface PaymentRefundInput {
  orderId: string;
  amount: number;
  currency: string;
  paymentMethodId?: string;
  /** Idempotency key (the return case id) so retries do not double-refund. */
  idempotencyKey: string;
}

export interface PaymentRefundResult {
  state: 'issued' | 'pending_manual' | 'failed';
  externalReference?: string | null;
  providerDetails?: Record<string, unknown>;
  failureReason?: string;
}

/**
 * Container name: `paymentRefundPort`. Owner: `payments`.
 *
 * The interface through which `returns` asks the payments domain to return
 * funds. The implementation resolves the order's payment and, where the method
 * supports an automatic refund, issues it; otherwise it reports
 * `pending_manual` so an operator settles it out of band (feature 046 FR-035).
 *
 * `pending_manual` is the degrade, and it is in the return type rather than in
 * a caller's `catch` — which is what makes an absent or switched-off gateway
 * leave the obligation on the platform's books, named, instead of dropping it.
 */
export interface PaymentRefundPort {
  refund(input: PaymentRefundInput): Promise<PaymentRefundResult>;
}

// --- the other three consumer-declared seams ---------------------------------
//
// The same move as `PaymentRefundPort` above, and for the same reason: this
// module states what it needs of a settlement and three other modules
// implement it. Publishing them keeps that direction (R-03) — a consumer
// declaring its own requirement is the shape feature 075 wants, and the only
// thing wrong with it was that the declaration lived in a module directory
// three other modules had to import from.

/**
 * A "credit toward future orders" resolution credits the customer's
 * organisation credit limit, which `credit_limits` already grants and the
 * checkout credit-check already redeems.
 *
 * `applied: false` when the organisation has no credit-limit grant — a
 * declared outcome, not a failure, so the settlement records the answer rather
 * than a caller inventing one from a caught error.
 */
export interface CreditTopupInput {
  organizationId: string;
  amount: number;
  currency: string;
  returnCaseId: string;
}

export interface CreditTopupResult {
  applied: boolean;
  availableAmountAfter?: number;
}

/** Container name: `creditTopupPort`. Owner: `credit_limits`. */
export interface CreditTopupPort {
  creditFromReturn(input: CreditTopupInput): Promise<CreditTopupResult>;
}

export interface OrderReturnContextLine {
  orderItemId: string;
  productId: string;
  name: string;
  purchasedQty: number;
  /** Amount paid per unit, including its proportional tax. */
  paidUnitAmount: number;
  /** Amount paid for the whole purchased line, including tax. */
  paidLineAmount: number;
}

export interface OrderReturnContext {
  salesChannelId: string;
  customerAccountId: string;
  organizationId: string | null;
  currency: string;
  /** When the order entered its fulfilment-completing status; null if it has not. */
  completingStatusEnteredAt: Date | null;
  lines: OrderReturnContextLine[];
}

/**
 * Container name: `orderReturnContextPort`. Owner: `orders`.
 *
 * The order facts a return needs — paid-per-line amounts, the
 * fulfilment-completing timestamp, channel, customer, organisation — without
 * `returns` reading the orders tables (Principle I).
 */
export interface OrderReturnContextPort {
  getReturnContext(orderId: string): Promise<OrderReturnContext | null>;
}

export interface CorrectiveInvoiceLine {
  /**
   * The order item this line credits. It is the link back to the line of the
   * original invoice being corrected: issuance snapshots `orderItemId` on every
   * product line, and a return-case item carries the same order item, so the
   * corrected line's VAT rate can be mirrored rather than assumed (issue #131).
   */
  orderItemId: string;
  productName: string;
  quantity: number;
  /** Credited amount for this line, gross (as paid, including its tax). */
  amount: number;
}

export interface CorrectiveInvoiceInput {
  orderId: string;
  lines: CorrectiveInvoiceLine[];
  /** Credited total, gross. */
  total: number;
  currency: string;
  /**
   * The caller's key for this correction — the return case id (D-91).
   *
   * A settlement attempts every external effect **before** it writes any state,
   * so a refusal from a later step leaves a retryable case behind and the retry
   * asks for the same correction again. With a key, the second call returns the
   * document the first one issued; without it, the order carries two corrections
   * for one return.
   *
   * It keys the **return case**, not the order: a second partial return against
   * the same order is a different case and legitimately gets its own correction.
   * Omitted, no deduplication is attempted and every call issues a document.
   */
  idempotencyKey?: string;
}

/** A correction was issued: the document that credits the original invoice. */
export interface CorrectiveInvoiceIssued {
  issued: true;
  invoiceId: string;
  number: string;
  status: 'pending' | 'ready' | 'cancelled';
}

/**
 * No correction was due, with the reason (issue #135).
 *
 * The settlement caller cannot know whether the order was ever invoiced — the
 * invoices module can, and answers here. `order_not_invoiced` is the only
 * reason today: with no original there is no VAT document to correct, so a
 * correction would be a number, a zero rate and an empty seller/buyer snapshot
 * standing in for a document that never existed.
 */
export interface CorrectiveInvoiceNotDue {
  issued: false;
  reason: 'order_not_invoiced';
}

export type CorrectiveInvoiceResult = CorrectiveInvoiceIssued | CorrectiveInvoiceNotDue;

/** Container name: `correctiveInvoicePort`. Owner: `invoices`. */
export interface CorrectiveInvoicePort {
  createCorrection(input: CorrectiveInvoiceInput): Promise<CorrectiveInvoiceResult>;
}
