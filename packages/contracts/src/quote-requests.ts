import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common.js';

/**
 * Quote Requests (RFQ) module contracts — feature 008 workflow rewrite.
 * Source of truth per Principle V; the backend re-uses these schemas as
 * route validators and the frontends consume the inferred TS types.
 *
 * Replaces the foundation 001 contract entirely. The legacy seven-state
 * status set is gone; the feature-008 six-state set lives below.
 *
 * See specs/008-quote-requests/contracts/ for the HTTP contract docs.
 */

// ---------------------------------------------------------------------------
// Statuses
// ---------------------------------------------------------------------------

export const rfqStatusSchema = z.enum([
  'Created from admin',
  'Pending',
  'Canceled',
  'Approved',
  'Completed',
  'Expired',
]);
export type RfqStatus = z.infer<typeof rfqStatusSchema>;

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export const quoteRequestItemSchema = z.object({
  id: uuidSchema,
  productId: uuidSchema,
  productName: z.string(),
  productSlug: z.string().nullable(),
  variantId: uuidSchema.nullable(),
  variantLabel: z.string().nullable(),
  quantity: z.number().int().positive(),
  desiredUnitPrice: z.number().finite().nullable(),
  agreedUnitPrice: z.number().finite().nullable(),
  lineNote: z.string().nullable(),
  lineCurrency: z.string().length(3),
  discountPercent: z.number().finite().min(0).max(100).nullable(),
});
export type QuoteRequestItem = z.infer<typeof quoteRequestItemSchema>;

// ---------------------------------------------------------------------------
// Events (history)
// ---------------------------------------------------------------------------

export const rfqEventTypeSchema = z.enum([
  'created',
  'submitted',
  'modified',
  'approved',
  'canceled',
  'expired',
  'completed',
  'customer-accepted-revision',
  'customer-rejected-revision',
  're-submitted',
  'note-added',
]);
export type RfqEventType = z.infer<typeof rfqEventTypeSchema>;

export const quoteRequestEventSchema = z.object({
  id: uuidSchema,
  eventType: rfqEventTypeSchema,
  actorAdminUserId: uuidSchema.nullable(),
  actorCustomerAccountId: uuidSchema.nullable(),
  actorRoleLabel: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()),
  revisionId: uuidSchema.nullable(),
  createdAt: isoDateTimeSchema,
});
export type QuoteRequestEvent = z.infer<typeof quoteRequestEventSchema>;

// ---------------------------------------------------------------------------
// Comparison view (rendered when awaitingCustomerRevisionAcceptance is true)
// ---------------------------------------------------------------------------

export const rfqDiffEntrySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('header_note'),
    before: z.string().nullable(),
    after: z.string().nullable(),
  }),
  z.object({
    kind: z.literal('line_added'),
    productId: uuidSchema,
    productName: z.string(),
    quantity: z.number().int().positive(),
    agreedUnitPrice: z.number().nullable(),
  }),
  z.object({
    kind: z.literal('line_removed'),
    productId: uuidSchema,
    productName: z.string(),
  }),
  z.object({
    kind: z.literal('line_quantity'),
    productId: uuidSchema,
    productName: z.string(),
    before: z.number().int().positive(),
    after: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal('line_agreed_unit_price'),
    productId: uuidSchema,
    productName: z.string(),
    before: z.number().nullable(),
    after: z.number().nullable(),
  }),
]);
export type RfqDiffEntry = z.infer<typeof rfqDiffEntrySchema>;

export const rfqComparisonAgainstLastSeenSchema = z.object({
  diff: z.array(rfqDiffEntrySchema),
  lastSeenRevisionNumber: z.number().int().nonnegative(),
  currentRevisionNumber: z.number().int().nonnegative(),
});
export type RfqComparisonAgainstLastSeen = z.infer<typeof rfqComparisonAgainstLastSeenSchema>;

// ---------------------------------------------------------------------------
// Quote Request — full and summary projections
// ---------------------------------------------------------------------------

export const quoteRequestSchema = z.object({
  id: uuidSchema,
  /**
   * Customer-facing business Quote Request ID, distinct from the internal
   * UUID `id`: `${prefix}${sequence}${suffix}`, where prefix/suffix come from
   * the `quote_requests.business_id.*` settings. This is the identifier shown
   * to the Customer; `id` stays internal. Mirrors `orders.businessId`.
   */
  businessId: z.string(),
  organizationId: uuidSchema,
  customerAccountId: uuidSchema,
  createdByAdminUserId: uuidSchema.nullable(),
  assignedAdminUserId: uuidSchema.nullable(),
  status: rfqStatusSchema,
  awaitingCustomerRevisionAcceptance: z.boolean(),
  currentRevisionNumber: z.number().int().nonnegative(),
  lastCustomerSeenRevisionNumber: z.number().int().nonnegative(),
  headerNote: z.string().nullable(),
  cancellationReason: z.string().nullable(),
  items: z.array(quoteRequestItemSchema),
  events: z.array(quoteRequestEventSchema),
  comparisonAgainstLastSeen: rfqComparisonAgainstLastSeenSchema.nullable(),
  submittedAt: isoDateTimeSchema.nullable(),
  approvedAt: isoDateTimeSchema.nullable(),
  canceledAt: isoDateTimeSchema.nullable(),
  completedAt: isoDateTimeSchema.nullable(),
  expiredAt: isoDateTimeSchema.nullable(),
  expiresAt: isoDateTimeSchema.nullable(),
  convertedOrderId: uuidSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  version: z.number().int().nonnegative(),
});
export type QuoteRequest = z.infer<typeof quoteRequestSchema>;

export const quoteRequestSummarySchema = z.object({
  id: uuidSchema,
  businessId: z.string(),
  organizationId: uuidSchema,
  customerAccountId: uuidSchema,
  status: rfqStatusSchema,
  awaitingCustomerRevisionAcceptance: z.boolean(),
  lineCount: z.number().int().nonnegative(),
  totalAtCustomerPrice: z.number().nullable(),
  totalAtAgreedPrice: z.number().nullable(),
  currency: z.string().length(3),
  submittedAt: isoDateTimeSchema.nullable(),
  expiresAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  version: z.number().int().nonnegative(),
  originalRequester: z
    .object({
      customerAccountId: uuidSchema,
      displayName: z.string().nullable(),
    })
    .optional(),
  organizationName: z.string().optional(),
  customerDisplayName: z.string().nullable().optional(),
});
export type QuoteRequestSummary = z.infer<typeof quoteRequestSummarySchema>;

// ---------------------------------------------------------------------------
// Customer-facing request schemas
// ---------------------------------------------------------------------------

export const createQuoteRequestLineSchema = z.object({
  productId: uuidSchema,
  variantId: uuidSchema.optional(),
  quantity: z.number().int().positive(),
  desiredUnitPrice: z.number().finite().nonnegative().optional(),
  lineNote: z.string().max(2000).optional(),
  /** Feature 043 — snapshot when the line was added as a packaging unit. */
  packagingUnitName: z.string().max(160).optional(),
  packagingUnitBaseQuantity: z.number().int().positive().optional(),
});
export type CreateQuoteRequestLine = z.infer<typeof createQuoteRequestLineSchema>;

export const createQuoteRequestSchema = z.object({
  headerNote: z.string().max(2000).optional(),
  items: z.array(createQuoteRequestLineSchema).min(1),
});
export type CreateQuoteRequest = z.infer<typeof createQuoteRequestSchema>;

export const patchQuoteRequestSchema = z
  .object({
    headerNote: z.string().max(2000).nullable().optional(),
    items: z.array(createQuoteRequestLineSchema).min(1).optional(),
  })
  .strict();
export type PatchQuoteRequest = z.infer<typeof patchQuoteRequestSchema>;

export const acceptRevisionSchema = z.object({
  expectedRevisionNumber: z.number().int().nonnegative(),
});
export type AcceptRevisionRequest = z.infer<typeof acceptRevisionSchema>;

export const rejectRevisionSchema = z.object({
  expectedRevisionNumber: z.number().int().nonnegative(),
  reason: z.string().max(2000).optional(),
});
export type RejectRevisionRequest = z.infer<typeof rejectRevisionSchema>;

export const resubmitQuoteRequestSchema = z
  .object({
    headerNote: z.string().max(2000).optional(),
  })
  .strict();
export type ResubmitQuoteRequest = z.infer<typeof resubmitQuoteRequestSchema>;

// ---------------------------------------------------------------------------
// Admin-facing request schemas
// ---------------------------------------------------------------------------

export const adminCreateQuoteRequestLineSchema = z.object({
  productId: uuidSchema,
  variantId: uuidSchema.optional(),
  quantity: z.number().int().positive(),
  agreedUnitPrice: z.number().finite().nonnegative(),
  lineNote: z.string().max(2000).optional(),
});
export type AdminCreateQuoteRequestLine = z.infer<typeof adminCreateQuoteRequestLineSchema>;

export const adminCreateQuoteRequestSchema = z.object({
  organizationId: uuidSchema,
  customerAccountId: uuidSchema,
  headerNote: z.string().max(2000).optional(),
  items: z.array(adminCreateQuoteRequestLineSchema).min(1),
  expiresInDays: z.number().int().nonnegative().optional(),
});
export type AdminCreateQuoteRequest = z.infer<typeof adminCreateQuoteRequestSchema>;

export const adminPatchQuoteRequestLineSchema = z.object({
  id: uuidSchema.optional(),
  productId: uuidSchema,
  variantId: uuidSchema.optional(),
  quantity: z.number().int().positive(),
  agreedUnitPrice: z.number().finite().nonnegative().nullable().optional(),
  lineNote: z.string().max(2000).nullable().optional(),
});
export type AdminPatchQuoteRequestLine = z.infer<typeof adminPatchQuoteRequestLineSchema>;

export const adminPatchQuoteRequestSchema = z
  .object({
    headerNote: z.string().max(2000).nullable().optional(),
    items: z.array(adminPatchQuoteRequestLineSchema).min(1).optional(),
    expiresInDays: z.number().int().nonnegative().optional(),
  })
  .strict();
export type AdminPatchQuoteRequest = z.infer<typeof adminPatchQuoteRequestSchema>;

export const adminApproveQuoteRequestSchema = z
  .object({ note: z.string().max(2000).optional() })
  .strict();
export type AdminApproveQuoteRequest = z.infer<typeof adminApproveQuoteRequestSchema>;

export const adminCancelQuoteRequestSchema = z
  .object({ reason: z.string().max(2000).optional() })
  .strict();
export type AdminCancelQuoteRequest = z.infer<typeof adminCancelQuoteRequestSchema>;

export const adminAssignQuoteRequestSchema = z.object({
  adminUserId: uuidSchema,
});
export type AdminAssignQuoteRequest = z.infer<typeof adminAssignQuoteRequestSchema>;

export const convertQuoteRequestResponseSchema = z.object({
  cartId: uuidSchema,
  checkoutUrl: z.string(),
});
export type ConvertQuoteRequestResponse = z.infer<typeof convertQuoteRequestResponseSchema>;

// ---------------------------------------------------------------------------
// Storefront public settings (FR-032 / FR-033)
// ---------------------------------------------------------------------------

export const storefrontQuoteRequestSettingsSchema = z.object({
  showAddToQuoteOnCard: z.boolean(),
  showAddToQuoteOnPdp: z.boolean(),
});
export type StorefrontQuoteRequestSettings = z.infer<typeof storefrontQuoteRequestSettingsSchema>;
