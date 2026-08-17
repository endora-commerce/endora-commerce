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
  /**
   * The VAT rate applied to this line's net unit price, as a fraction
   * (e.g. `0.23` for 23%). Resolved at read time from the Organization's
   * VAT status and the tax rules (mirrors the Orders flow). `0` when the
   * Organization is VAT-exempt / reverse-charge or no tax rule applies.
   */
  taxRate: z.number().finite().nonnegative().default(0),
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
  /** Feature 055 — custom-field values captured on this quote request. */
  customFieldValues: z.record(z.string(), z.unknown()).default({}),
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
  /**
   * The VAT rate (fraction, e.g. `0.23`) applied across this quote's net
   * line prices. Resolved at read time from the Organization's VAT status
   * and the tax rules; `0` when VAT-exempt / reverse-charge. Per-line rates
   * live on each item's `taxRate`.
   */
  taxRate: z.number().finite().nonnegative().default(0),
  /**
   * Admin-detail enrichment (optional): the requesting Organization and
   * Customer resolved to display fields, so the admin RFQ detail can show
   * them by name the same way the Order detail does. Absent on the
   * storefront/customer serialization.
   */
  organization: z
    .object({
      id: uuidSchema,
      name: z.string(),
      legalName: z.string().nullable(),
      taxId: z.string(),
      vatStatus: z.string(),
    })
    .nullable()
    .optional(),
  customer: z
    .object({
      id: uuidSchema,
      firstName: z.string().nullable(),
      lastName: z.string().nullable(),
      email: z.string(),
    })
    .nullable()
    .optional(),
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
  /** Net totals (tax-exclusive). Gross = total × (1 + `taxRate`). */
  totalAtCustomerPrice: z.number().nullable(),
  totalAtAgreedPrice: z.number().nullable(),
  /** Flat VAT rate (fraction) applied to this quote's net totals. */
  taxRate: z.number().finite().nonnegative().default(0),
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
    /** Feature 055 — custom-field values for this quote request (validated on write). */
    customFieldValues: z.record(z.string(), z.unknown()).optional(),
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

// ---------------------------------------------------------------------------
// --- ports -----------------------------------------------------------------
//
// The in-process surface `quote_requests` publishes to the six modules that
// read it (feature 075, Phase P). Plain TypeScript, not Zod: these describe
// in-process calls, not an API boundary.
// ---------------------------------------------------------------------------

/**
 * The lifecycle statuses of a quote request.
 *
 * Published as a **union, not a port** (FR-013): `organizations`' sales-rep
 * screen counts the three open ones by name, and switching a module off does
 * not change what `'Pending'` is spelled. Unlike the order lifecycle these are
 * fixed at compile time — a quote's status set is not admin-configurable.
 *
 * The capitalised, space-separated spellings are the persisted column values
 * (research §R3); do not tidy them.
 */
export type QuoteRequestStatus =
  | 'Created from admin'
  | 'Pending'
  | 'Canceled'
  | 'Approved'
  | 'Completed'
  | 'Expired';

/** The statuses that mean "this quote is still live". */
export const OPEN_QUOTE_REQUEST_STATUSES: readonly QuoteRequestStatus[] = [
  'Pending',
  'Created from admin',
  'Approved',
];

/**
 * A quote request as it crosses a module boundary — a plain shape, never the
 * ORM entity (FR-011). The full customer-facing projection is `RfqDto`
 * (`QuoteRequest` above), which carries the items, the events and the revision
 * comparison; this is the row, for the two modules that only need to count or
 * cross-reference one.
 */
export interface QuoteRequestRecord {
  id: string;
  businessId: string;
  organizationId: string;
  customerAccountId: string;
  createdByAdminUserId: string | null;
  assignedAdminUserId: string | null;
  status: QuoteRequestStatus;
  headerNote: string | null;
  cancellationReason: string | null;
  awaitingCustomerRevisionAcceptance: boolean;
  lastCustomerSeenRevisionNumber: number;
  currentRevisionNumber: number;
  submittedAt: Date | null;
  approvedAt: Date | null;
  canceledAt: Date | null;
  completedAt: Date | null;
  expiredAt: Date | null;
  expiresAt: Date | null;
  convertedOrderId: string | null;
  customFieldValues: Record<string, unknown>;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * One quote-request line, as the module that converts one back into a cart
 * reads it (feature 075, `carts`' cut).
 *
 * Narrower than the row on purpose: the conversion re-resolves every price
 * against the buyer's current price list (FR-017), so the money columns are
 * deliberately absent — a caller that cannot see `desiredUnitPrice` cannot
 * accidentally carry it over, which is the rule the conversion exists to obey.
 * `productName` travels because a dropped line is reported by name.
 */
export interface QuoteRequestLineRecord {
  id: string;
  quoteRequestId: string;
  productId: string;
  productName: string;
  variantId: string | null;
  quantity: number;
  packagingUnitName: string | null;
  packagingUnitBaseQuantity: number | null;
}

/**
 * Container name: `quoteRequestReadPort`. Owner: `quote_requests`.
 *
 * Two consumers, two questions. `carts` resolves the quote a cart was
 * converted from, to show the buyer where the prices came from;
 * `organizations` counts the open quotes per organisation on the sales-rep
 * screen, which is where `OPEN_QUOTE_REQUEST_STATUSES` had been written out by
 * hand.
 */
export interface QuoteRequestReadPort {
  findById(id: string): Promise<QuoteRequestRecord | null>;
  /**
   * Open quotes for the given organisations. Empty `organizationIds` answers
   * the empty array rather than every quote — a rep assigned nothing sees
   * nothing, which is not the same question as "no filter".
   */
  listOpenForOrganizations(
    organizationIds: readonly string[],
  ): Promise<QuoteRequestRecord[]>;
  /**
   * The quote's lines, in insertion order. Added in `carts`' cut: the
   * quote-to-cart conversion read `QuoteRequestItem` directly, so it kept
   * re-stocking a cart from quotes belonging to a module an operator had
   * switched off.
   */
  listItems(quoteRequestId: string): Promise<QuoteRequestLineRecord[]>;
}

/** Who is asking, on a customer-facing quote path. */
export interface RfqCustomerContext {
  customerAccountId: string;
  organizationId: string;
  /**
   * True when the account holds the org-admin role on the current
   * organisation (FR-011 — broader visibility).
   */
  isOrgAdmin: boolean;
}

/**
 * Container name: `rfqService`. Owner: `quote_requests`.
 *
 * The customer-facing quote surface five modules reach: `carts` converting a
 * cart, `orders` cloning an order to a quote, `shopping_lists` and
 * `quick_order` quoting a built list, `customers` listing a buyer's quotes.
 *
 * Both methods already answer with contract DTOs, so this port needed no
 * adapter — only a published name for the shape the five were importing the
 * class to get.
 */
export interface RfqCustomerPort {
  createForCustomer(ctx: RfqCustomerContext, input: CreateQuoteRequest): Promise<QuoteRequest>;
  listForCustomer(ctx: RfqCustomerContext): Promise<QuoteRequestSummary[]>;
}
