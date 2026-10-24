import { z } from 'zod';
import { isoDateTimeSchema, OriginReferenceSchema, uuidSchema, type OriginReference } from './common.js';
import {
  lineGroupInputSchema,
  lineGroupKeySchema,
  lineGroupSchema,
  newLineGroupInputSchema,
  refineLineGrouping,
} from './line-groups.js';
import { customFieldCarrySkipSchema } from './custom-fields.js';
import { twoDecimalAmount } from './money-input.js';

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
  /**
   * Feature 146 — **admin replies only**; a customer reply does not carry the
   * key. The at-request reference unit price (net, per base piece) stored when
   * the line was created; `null` = none stored.
   */
  referencePrice: z
    .object({
      amount: z.number().finite(),
      currency: z.string().length(3),
      capturedAt: isoDateTimeSchema,
    })
    .nullable()
    .optional(),
  /**
   * Feature 146 — **admin replies only**. The customer's proposal for this
   * line: the line's own `desiredUnitPrice`, or — for a line of a request
   * revised before feature 146 — the value from the submission record.
   * `null` = the customer proposed nothing.
   */
  customerProposedUnitPrice: z.number().finite().nullable().optional(),
  /** Feature 043 packaging-unit snapshot, already stored on the row; both replies. */
  packagingUnitName: z.string().nullable().optional(),
  packagingUnitBaseQuantity: z.number().int().positive().nullable().optional(),
  /** Feature 155 — the resolved catalogue unit; admin and customer replies. */
  packagingUnitId: uuidSchema.nullable().optional(),
  /**
   * Feature 155 (FR-030) — **admin replies only**: set when the line is below its
   * product's current minimum. Informs only.
   */
  minimumWarning: z
    .object({
      kind: z.enum(['pieces', 'packaging_unit']),
      minimum: z.number().int().positive(),
      packagingUnitName: z.string().optional(),
    })
    .nullable()
    .optional(),
  /**
   * Feature 159 — the line's group (`itemGroups[].id`), `null` = ungrouped.
   * Admin and customer replies; defaulted so a reply written before the
   * feature parses.
   */
  groupId: uuidSchema.nullable().default(null),
  /** Feature 159 — 0-based order within the line's section (its group, or the ungrouped lines). */
  position: z.number().int().nonnegative().default(0),
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
  // Feature 153 (owner answer Q4) — the quote PDF was e-mailed. Admin replies
  // only: a customer reply leaves these events out.
  'pdf-sent',
  // Feature 162 — custom-field values a Sales Opportunity could not carry into
  // this request. Admin replies only: it names keys of possibly internal fields.
  'custom-field-carry-skipped',
]);
export type RfqEventType = z.infer<typeof rfqEventTypeSchema>;

export const quoteRequestEventSchema = z.object({
  id: uuidSchema,
  eventType: rfqEventTypeSchema,
  /** Admin replies only; a customer reply does not carry the key. */
  actorAdminUserId: uuidSchema.nullable().optional(),
  actorCustomerAccountId: uuidSchema.nullable(),
  actorRoleLabel: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()),
  revisionId: uuidSchema.nullable(),
  createdAt: isoDateTimeSchema,
});
export type QuoteRequestEvent = z.infer<typeof quoteRequestEventSchema>;

// ---------------------------------------------------------------------------
// Readable history (feature 146) — `GET /api/v1/admin/quote-requests/:id/history`
// ---------------------------------------------------------------------------

/** A line as a history change names it. */
export const quoteRequestHistoryLineRefSchema = z.object({
  productId: uuidSchema,
  variantId: uuidSchema.nullable(),
  /** Snapshot name, packaging suffix included. */
  productName: z.string(),
  /** Resolved on read; `null` when the variant is gone. */
  variantLabel: z.string().nullable(),
  /**
   * Feature 159 (research N-32) — the line's group (`null` = ungrouped), present
   * only where it tells the line apart: its product, variant and packaging unit
   * sit on more than one line of either revision.
   */
  groupName: z.string().nullable().optional(),
});
export type QuoteRequestHistoryLineRef = z.infer<typeof quoteRequestHistoryLineRefSchema>;

/**
 * One change of a `modified` entry. Packaging-unit and custom-field changes
 * are never listed. The UI maps every `kind` to a bundle key.
 */
export const quoteRequestHistoryChangeSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('line_added'),
    line: quoteRequestHistoryLineRefSchema,
    quantity: z.number().int().positive(),
    agreedUnitPrice: z.number().nullable(),
    currency: z.string().length(3),
  }),
  z.object({ kind: z.literal('line_removed'), line: quoteRequestHistoryLineRefSchema }),
  z.object({
    kind: z.literal('line_quantity'),
    line: quoteRequestHistoryLineRefSchema,
    before: z.number().int(),
    after: z.number().int(),
  }),
  z.object({
    kind: z.literal('line_agreed_unit_price'),
    line: quoteRequestHistoryLineRefSchema,
    before: z.number().nullable(),
    after: z.number().nullable(),
    currency: z.string().length(3),
  }),
  z.object({
    kind: z.literal('line_proposed_unit_price'),
    line: quoteRequestHistoryLineRefSchema,
    before: z.number().nullable(),
    after: z.number().nullable(),
    currency: z.string().length(3),
  }),
  z.object({
    kind: z.literal('line_note'),
    line: quoteRequestHistoryLineRefSchema,
    before: z.string().nullable(),
    after: z.string().nullable(),
  }),
  z.object({
    kind: z.literal('header_note'),
    before: z.string().nullable(),
    after: z.string().nullable(),
  }),
  z.object({
    kind: z.literal('validity'),
    before: isoDateTimeSchema.nullable(),
    after: isoDateTimeSchema.nullable(),
  }),
  // Feature 159 — the grouping as recorded in the revision snapshots. Groups
  // pair across snapshots by id; names are as recorded, `null` = ungrouped.
  z.object({
    kind: z.literal('group_added'),
    group: z.object({ id: uuidSchema, name: z.string() }),
  }),
  z.object({
    kind: z.literal('group_removed'),
    group: z.object({ id: uuidSchema, name: z.string() }),
  }),
  z.object({
    kind: z.literal('group_renamed'),
    groupId: uuidSchema,
    before: z.string(),
    after: z.string(),
  }),
  z.object({
    kind: z.literal('line_group'),
    line: quoteRequestHistoryLineRefSchema,
    before: z.string().nullable(),
    after: z.string().nullable(),
  }),
  /** Lines or groups reordered with no other change explaining it; at most once per entry. */
  z.object({ kind: z.literal('line_order') }),
]);
export type QuoteRequestHistoryChange = z.infer<typeof quoteRequestHistoryChangeSchema>;

/**
 * Who an entry is attributed to. An administrator is named by first and last
 * name only — the admin arm has **no e-mail key** — and `name: null` means an
 * unknown user.
 */
export const quoteRequestHistoryActorSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('admin'),
    adminUserId: uuidSchema,
    name: z.string().nullable(),
    /** The stored `actorRoleLabel`. */
    recordedRole: z.string().nullable(),
  }),
  z.object({
    kind: z.literal('customer'),
    customerAccountId: uuidSchema,
    name: z.string().nullable(),
    email: z.string().nullable(),
    recordedRole: z.string().nullable(),
  }),
  z.object({ kind: z.literal('system') }),
  z.object({ kind: z.literal('unknown'), recordedRole: z.string().nullable() }),
]);
export type QuoteRequestHistoryActor = z.infer<typeof quoteRequestHistoryActorSchema>;

export const quoteRequestHistoryEntryKindSchema = z.enum([
  'submitted',
  'resubmitted',
  'created_by_admin',
  'created',
  'modified',
  'approved',
  'accepted_by_customer',
  'rejected_by_customer',
  'canceled',
  'expired',
  'completed',
  'note_added',
  // Feature 153 (owner answer Q4).
  'pdf_sent',
  // Feature 162.
  'custom_field_carry_skipped',
]);
export type QuoteRequestHistoryEntryKind = z.infer<typeof quoteRequestHistoryEntryKindSchema>;

export const quoteRequestHistoryEntrySchema = z.object({
  /** Id of the first merged event. */
  id: uuidSchema,
  eventIds: z.array(uuidSchema).min(1).max(2),
  kind: quoteRequestHistoryEntryKindSchema,
  occurredAt: isoDateTimeSchema,
  actor: quoteRequestHistoryActorSchema,
  revisionNumber: z.number().int().positive().nullable(),
  /** Approval note or standalone note — never the automatic creation note. */
  note: z.string().nullable(),
  /** Cancellation or rejection reason. */
  reason: z.string().nullable(),
  /** `modified` entries only; `[]` = a modification that changed nothing listable. */
  changes: z.array(quoteRequestHistoryChangeSchema).nullable(),
  /** Resubmission source. */
  relatedQuoteRequestId: uuidSchema.nullable(),
  /** Completion. */
  orderId: uuidSchema.nullable(),
  /**
   * Feature 153 — `pdf_sent` entries only: who the quote PDF was e-mailed to,
   * with which template (`null` = the built-in layout) and in which language.
   */
  delivery: z
    .object({
      recipients: z.array(z.string()),
      templateName: z.string().nullable(),
      language: z.string().nullable(),
      message: z.string().nullable(),
    })
    .nullable()
    .optional(),
  /**
   * Feature 162 — `custom_field_carry_skipped` entries only: the Sales
   * Opportunity the values came from and every key not carried, with its reason.
   */
  customFieldCarry: z
    .object({
      source: z.object({
        entityType: z.literal('opportunity'),
        recordId: uuidSchema,
        reference: z.string(),
      }),
      skipped: z.array(customFieldCarrySkipSchema).min(1),
    })
    .nullable()
    .optional(),
});
export type QuoteRequestHistoryEntry = z.infer<typeof quoteRequestHistoryEntrySchema>;

/**
 * How many of a quote request's most recent events its history is built from
 * (threat model T9). Shared so the admin's truncation notice states the number
 * the server applies, rather than a copy of it.
 */
export const QUOTE_REQUEST_HISTORY_EVENT_WINDOW = 100;

/**
 * The history response body's `data`: entries oldest first, built from the
 * most recent {@link QUOTE_REQUEST_HISTORY_EVENT_WINDOW} events; `truncated` is
 * `true` when older ones exist.
 */
export const quoteRequestHistorySchema = z.object({
  entries: z.array(quoteRequestHistoryEntrySchema),
  truncated: z.boolean(),
});
export type QuoteRequestHistory = z.infer<typeof quoteRequestHistorySchema>;

// ---------------------------------------------------------------------------
// Comparison view (rendered when awaitingCustomerRevisionAcceptance is true)
// ---------------------------------------------------------------------------

/**
 * Feature 159 (research N-32) — the group of the line a comparison entry is
 * about (`null` = ungrouped), present only where the product sits on more than
 * one line of either revision (same variant and packaging unit), so "Bolt: 5 →
 * 3" says which Bolt line. The
 * group's name is one the customer was shown on that revision.
 */
const diffGroupNameSchema = z.string().nullable().optional();

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
    groupName: diffGroupNameSchema,
  }),
  z.object({
    kind: z.literal('line_removed'),
    productId: uuidSchema,
    productName: z.string(),
    groupName: diffGroupNameSchema,
  }),
  z.object({
    kind: z.literal('line_quantity'),
    productId: uuidSchema,
    productName: z.string(),
    before: z.number().int().positive(),
    after: z.number().int().positive(),
    groupName: diffGroupNameSchema,
  }),
  z.object({
    kind: z.literal('line_agreed_unit_price'),
    productId: uuidSchema,
    productName: z.string(),
    before: z.number().nullable(),
    after: z.number().nullable(),
    groupName: diffGroupNameSchema,
  }),
  /**
   * Feature 159 — the arrangement of the lines (group names, group order,
   * membership, line order) differs. Carries no other key: it names nothing
   * the customer reply does not already carry.
   */
  z.object({ kind: z.literal('grouping') }),
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
  /**
   * Feature 146 — the sales channel the request was raised on. **Admin
   * replies only**, so the admin screen can ask for a current price on that
   * channel; `null` = raised before channel attribution (system default).
   */
  salesChannelId: uuidSchema.nullable().optional(),
  /**
   * The administrator who created the quote on the customer's behalf, and the
   * one it is assigned to. **Admin replies only** — a customer reply carries
   * neither key: an administrator's identifier is not the customer's to read.
   */
  createdByAdminUserId: uuidSchema.nullable().optional(),
  assignedAdminUserId: uuidSchema.nullable().optional(),
  status: rfqStatusSchema,
  awaitingCustomerRevisionAcceptance: z.boolean(),
  currentRevisionNumber: z.number().int().nonnegative(),
  lastCustomerSeenRevisionNumber: z.number().int().nonnegative(),
  headerNote: z.string().nullable(),
  cancellationReason: z.string().nullable(),
  /** Feature 055 — custom-field values captured on this quote request. */
  customFieldValues: z.record(z.string(), z.unknown()).default({}),
  /**
   * Feature 159 — the quote's line groups in display order. Admin replies:
   * every group, empty ones included (the editor needs them). Customer
   * replies: groups holding at least one line only.
   */
  itemGroups: z.array(lineGroupSchema).default([]),
  /** In display order: each group's lines in order, then the ungrouped lines. */
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
  /**
   * Feature 153 (owner answer Q2) — the PDF template remembered for this quote,
   * `null` = none. **Admin replies only.** A stale id is kept: the export falls
   * back to the default and says so.
   */
  documentTemplateId: uuidSchema.nullable().optional(),
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
  desiredUnitPrice: twoDecimalAmount(z.number().finite().nonnegative()).optional(),
  lineNote: z.string().max(2000).optional(),
  /** Feature 043 — snapshot when the line was added as a packaging unit. */
  packagingUnitName: z.string().max(160).optional(),
  packagingUnitBaseQuantity: z.number().int().positive().optional(),
  /** Feature 155 (FR-026) — the catalogue unit the line is ordered in. Wins over name/base quantity. */
  packagingUnitId: uuidSchema.optional(),
});
export type CreateQuoteRequestLine = z.infer<typeof createQuoteRequestLineSchema>;

/**
 * Customer-facing: **not strict**, deliberately — an unknown key (a body
 * `lineReferencePrices`, a per-line `referenceUnitPrice`) is stripped, never
 * refused, and never reaches the service.
 */
export const createQuoteRequestSchema = z.object({
  headerNote: z.string().max(2000).optional(),
  items: z.array(createQuoteRequestLineSchema).min(1).max(200),
});
export type CreateQuoteRequest = z.infer<typeof createQuoteRequestSchema>;

export const patchQuoteRequestSchema = z
  .object({
    headerNote: z.string().max(2000).nullable().optional(),
    items: z.array(createQuoteRequestLineSchema).min(1).max(200).optional(),
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
  agreedUnitPrice: twoDecimalAmount(z.number().finite().nonnegative()),
  lineNote: z.string().max(2000).optional(),
  /** Feature 159 — the `groups[].key` this line belongs to; absent or `null` = ungrouped. */
  groupKey: lineGroupKeySchema.nullable().optional(),
});
export type AdminCreateQuoteRequestLine = z.infer<typeof adminCreateQuoteRequestLineSchema>;

export const adminCreateQuoteRequestSchema = z
  .object({
    organizationId: uuidSchema,
    customerAccountId: uuidSchema,
    headerNote: z.string().max(2000).optional(),
    /** Feature 159 — the new quote's groups in display order; lines name them by `groupKey`. */
    groups: z.array(newLineGroupInputSchema).optional(),
    /** In display order: each group's lines, then the ungrouped lines. */
    items: z.array(adminCreateQuoteRequestLineSchema).min(1),
    expiresInDays: z.number().int().nonnegative().optional(),
    /**
     * Where the request is being created from — opaque to `quote_requests`,
     * which validates its shape and hands it on with `rfq.created_by_admin.v1`.
     * Not stored and not returned.
     */
    origin: OriginReferenceSchema.optional(),
  })
  .superRefine((body, ctx) => refineLineGrouping(ctx, body));
export type AdminCreateQuoteRequest = z.infer<typeof adminCreateQuoteRequestSchema>;

/** The name of the event that announces a Quote Request an administrator created. */
export const RFQ_CREATED_BY_ADMIN_EVENT = 'rfq.created_by_admin.v1';

/**
 * Payload of `rfq.created_by_admin.v1`, beyond the event envelope (`eventId`,
 * `occurredAt`). Emitted once per Quote Request created through the admin
 * create path, after its rows are written; a customer's own submission is
 * `rfq.created.v1` and never this. `origin` is what the create request
 * carried, or `null`.
 */
export interface RfqCreatedByAdminEventPayload {
  rfqId: string;
  organizationId: string;
  adminUserId: string;
  origin: OriginReference | null;
}

export const adminPatchQuoteRequestLineSchema = z.object({
  id: uuidSchema.optional(),
  productId: uuidSchema,
  variantId: uuidSchema.optional(),
  quantity: z.number().int().positive(),
  agreedUnitPrice: twoDecimalAmount(z.number().finite().nonnegative()).nullable().optional(),
  lineNote: z.string().max(2000).nullable().optional(),
  /** Feature 159 — the `groups[].key` this line belongs to; `null` = ungrouped. */
  groupKey: lineGroupKeySchema.nullable().optional(),
  /**
   * Feature 159 (research N-33) — a new line split off a stored line of this
   * quote (*Split line*): with no `id`, it takes that line's variant, packaging
   * unit, customer's proposal, note, currency and stored reference, as the
   * line it was split from keeps them. A value naming no line of this quote is
   * ignored — the line is a plain new line.
   */
  splitFromId: uuidSchema.optional(),
});
export type AdminPatchQuoteRequestLine = z.infer<typeof adminPatchQuoteRequestLineSchema>;

export const adminPatchQuoteRequestSchema = z
  .object({
    headerNote: z.string().max(2000).nullable().optional(),
    /**
     * Feature 159 — the whole grouping in display order; requires `items`.
     * Absent with `items` present: every paired line keeps its group, new
     * lines are ungrouped, no group is deleted (research R-14).
     */
    groups: z.array(lineGroupInputSchema).optional(),
    /** In display order: each group's lines, then the ungrouped lines. */
    items: z.array(adminPatchQuoteRequestLineSchema).min(1).optional(),
    expiresInDays: z.number().int().nonnegative().optional(),
    /** Feature 055 — custom-field values for this quote request (validated on write). */
    customFieldValues: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
  .superRefine((body, ctx) => refineLineGrouping(ctx, body));
export type AdminPatchQuoteRequest = z.infer<typeof adminPatchQuoteRequestSchema>;

export const adminApproveQuoteRequestSchema = z
  .object({ note: z.string().max(2000).optional() })
  .strict();
export type AdminApproveQuoteRequest = z.infer<typeof adminApproveQuoteRequestSchema>;

export const adminCancelQuoteRequestSchema = z
  .object({ reason: z.string().max(2000).optional() })
  .strict();
export type AdminCancelQuoteRequest = z.infer<typeof adminCancelQuoteRequestSchema>;

/**
 * `POST /api/v1/admin/quote-requests/:id/prepare-customer-basket` (issue #170):
 * the approved request's lines are in the basket of the customer who owns it,
 * at the agreed prices, for that customer to check out.
 */
export const adminPrepareCustomerBasketResponseSchema = z.object({
  cartId: uuidSchema,
  customerAccountId: uuidSchema,
  itemCount: z.number().int().nonnegative(),
});
export type AdminPrepareCustomerBasketResponse = z.infer<typeof adminPrepareCustomerBasketResponseSchema>;

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
// Price negotiation lock (feature 146)
// ---------------------------------------------------------------------------

/** `GET|PUT /api/v1/admin/organizations/:id/quote-price-negotiation` answer. */
export const quoteRequestOrgNegotiationSchema = z.object({
  organizationId: uuidSchema,
  priceProposalsAllowed: z.boolean(),
  /** `null` when no row exists yet (the default applies). */
  updatedAt: isoDateTimeSchema.nullable(),
});
export type QuoteRequestOrgNegotiation = z.infer<typeof quoteRequestOrgNegotiationSchema>;

/** Admin body — strict. */
export const setQuoteRequestOrgNegotiationSchema = z
  .object({ priceProposalsAllowed: z.boolean() })
  .strict();
export type SetQuoteRequestOrgNegotiation = z.infer<typeof setQuoteRequestOrgNegotiationSchema>;

export const quoteRequestNegotiationOverrideSchema = z.enum(['inherit', 'allowed', 'not_allowed']);
export type QuoteRequestNegotiationOverride = z.infer<typeof quoteRequestNegotiationOverrideSchema>;

/** `GET|PUT /api/v1/admin/customers/:id/quote-price-negotiation` answer. */
export const quoteRequestAccountNegotiationSchema = z.object({
  customerAccountId: uuidSchema,
  /** The account's current organization. */
  organizationId: uuidSchema,
  override: quoteRequestNegotiationOverrideSchema,
  organizationPriceProposalsAllowed: z.boolean(),
  /** The resulting value and where it comes from. */
  effectivePriceProposalsAllowed: z.boolean(),
  effectiveSource: z.enum(['account', 'organization', 'default']),
  updatedAt: isoDateTimeSchema.nullable(),
});
export type QuoteRequestAccountNegotiation = z.infer<typeof quoteRequestAccountNegotiationSchema>;

/** Admin body — strict. */
export const setQuoteRequestAccountNegotiationSchema = z
  .object({ override: quoteRequestNegotiationOverrideSchema })
  .strict();
export type SetQuoteRequestAccountNegotiation = z.infer<typeof setQuoteRequestAccountNegotiationSchema>;

/**
 * `GET /api/v1/quote-requests/price-negotiation` — the signed-in customer's
 * effective value and nothing else: no id, no organization value, no override.
 */
export const storefrontQuoteRequestNegotiationSchema = z.object({
  priceProposalsAllowed: z.boolean(),
});
export type StorefrontQuoteRequestNegotiation = z.infer<typeof storefrontQuoteRequestNegotiationSchema>;

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
  /**
   * The channel the request was raised on; `null` when it was created outside
   * a request scope (`specs/149-pwa-order-status-push/`).
   */
  salesChannelId: string | null;
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
 * reads it (feature 075, `carts`' cut), and as the ERP export readers read it.
 *
 * Narrower than the row on purpose: the conversion re-resolves every price
 * against the buyer's current price list (FR-017 of feature 075), so it ignores
 * every money field here — the quote → cart conversion never carries a price
 * over. The money fields (`lineCurrency`, `agreedUnitPrice`, `desiredUnitPrice`,
 * `referenceUnitPrice`, `referenceCurrency`) are for export readers.
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
  /**
   * Feature 155 (FR-026) — the catalogue packaging unit the line resolved to;
   * `null` for a plain-pieces line or one stored before the feature. Optional,
   * so every structural stub of the port written before it still compiles.
   */
  packagingUnitId?: string | null;
  /** Present for ERP export callers; cart conversion ignores these (FR-017). */
  lineCurrency: string;
  agreedUnitPrice: string | null;
  desiredUnitPrice: string | null;
  /**
   * Feature 146 — the stored at-request reference unit price (net, per base
   * piece), decimal string; `null` when none is stored. For a cart-converted
   * line this is the cart's unit price — read it here, not from
   * `desiredUnitPrice`, which is `null` on those lines. Optional, so every
   * structural stub of the port written before it still compiles.
   */
  referenceUnitPrice?: string | null;
  /** Currency of `referenceUnitPrice`; `null` exactly when it is `null`. */
  referenceCurrency?: string | null;
  /**
   * Feature 159 (FR-087) — 0-based order within the line's section. Optional,
   * so every structural stub of the port written before it still compiles.
   */
  position?: number;
  /** Feature 159 — the line's group, or `null` when ungrouped. Optional as above. */
  group?: { id: string; name: string; position: number } | null;
}

/**
 * Container name: `quoteRequestReadPort`. Owner: `quote_requests`.
 *
 * Two consumers, two questions. `carts` resolves the quote a cart was
 * converted from, to show the buyer where the prices came from;
 * `organizations` counts the open quotes per organisation on the sales-rep
 * screen, which is where `OPEN_QUOTE_REQUEST_STATUSES` had been written out by
 * hand.
 *
 * **Owner off:** the seam fails closed — resolving this port throws
 * `ModuleDisabledError` and the call answers 503 `MODULE_DISABLED`, so nothing
 * half-executes. Whether `quote_requests` has an off state at all is its manifest's
 * `activation` to say, not this line's: a module declaring
 * `nonDeactivatable` never enters one.
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
   * The quote's lines, in display order (feature 159: groups in order, each
   * group's lines in order, then the ungrouped lines — insertion order for a
   * quote never grouped). Added in `carts`' cut: the
   * quote-to-cart conversion read `QuoteRequestItem` directly, so it kept
   * re-stocking a cart from quotes belonging to a module an operator had
   * switched off.
   */
  listItems(quoteRequestId: string): Promise<QuoteRequestLineRecord[]>;
  /**
   * The quote carrying this human-facing business id, or `null`.
   *
   * Added in `comarch_xl`'s cut: an ERP offer names the quote it answers by
   * the reference a person read off the document, never by the uuid, and the
   * connector had been reading `quote_requests` with a raw statement to
   * resolve it.
   */
  findByBusinessId(businessId: string): Promise<QuoteRequestRecord | null>;
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
 *
 * **Owner off:** the seam fails closed — resolving this port throws
 * `ModuleDisabledError` and the call answers 503 `MODULE_DISABLED`, so nothing
 * half-executes. Whether `quote_requests` has an off state at all is its manifest's
 * `activation` to say, not this line's: a module declaring
 * `nonDeactivatable` never enters one.
 */
/**
 * Feature 146 — the optional third argument of
 * `RfqCustomerPort.createForCustomer`.
 */
export interface CreateForCustomerOptions {
  /**
   * Server-side reference prices, index-aligned with `input.items`. Set only by
   * an in-process caller that holds a snapshot the buyer could not have forged —
   * `carts`' conversion, whose cart line price is the reference. Unreachable
   * from HTTP: the route parses its body with `createQuoteRequestSchema`, which
   * has no such field and strips it. `null` at an index = resolve that line.
   *
   * Validated before any write; each violation is a programming error and
   * throws:
   * - the array length equals `input.items.length`;
   * - each non-`null` entry's `amount` is a finite decimal string ≥ 0 with at
   *   most two decimals, and its `currency` matches `/^[A-Z]{3}$/`.
   */
  lineReferencePrices?: ReadonlyArray<{ amount: string; currency: string } | null>;
  /**
   * Feature 155 (FR-012, FR-030) — `'enforce'` (default): a buyer is writing, minimums refuse.
   * `'warn'`: a sales representative is writing through the buyer's path (admin clone-to-quote,
   * admin quick-order build); nothing is refused for minimums and the admin read flags the lines.
   * In-process only: no HTTP body can carry it (`createQuoteRequestSchema` has no such key and
   * strips it). Packaging validation (FR-026) applies either way.
   */
  minimums?: 'enforce' | 'warn';
  /**
   * Feature 155 (D3/D4) — the language a refusal names a product in: the language the
   * caller's response is answered in (`request.responseLanguage()`). Absent, the record's
   * own fallback chain.
   */
  language?: string;
}

export interface RfqCustomerPort {
  /**
   * `options` is optional and trailing, so every existing caller and every
   * two-argument implementation stays valid.
   */
  createForCustomer(
    ctx: RfqCustomerContext,
    input: CreateQuoteRequest,
    options?: CreateForCustomerOptions,
  ): Promise<QuoteRequest>;
  listForCustomer(ctx: RfqCustomerContext): Promise<QuoteRequestSummary[]>;
}

// ---------------------------------------------------------------------------
// Events offered to outbound webhooks
// ---------------------------------------------------------------------------
//
// The webhook delivery bridge serialises an event whole, so for these two
// **the event payload is the webhook payload** — a public, versioned contract.
// Each has a strict schema and `quote_requests` pushes exactly these names into
// `webhookEventRegistry`. Adding a field is a reviewed change here; removing or
// renaming one is a new `.v2` event offered beside the old.
//
// Both carry identifiers only — no line, price, note or person. A Quote Request
// belongs to one Organization, and `organizationId` is what the bridge filters
// on: a subscription bound to an Organization receives only that Organization's
// events, and an event without it would reach no bound subscription at all.

const quoteRequestWebhookEventEnvelopeShape = {
  eventId: z.string().min(1),
  occurredAt: isoDateTimeSchema,
};

/** The fixed names of the Quote Request events offered to outbound webhooks. */
export const QUOTE_REQUEST_WEBHOOK_EVENTS = {
  CREATED: 'rfq.created.v1',
  EXPIRED: 'rfq.expired.v1',
} as const;

/**
 * Payload of `rfq.created.v1` — a customer submitted a Quote Request. One an
 * administrator creates is announced as `rfq.created_by_admin.v1`, which is not
 * offered to webhooks.
 */
export const RfqCreatedEventV1Schema = z
  .object({
    ...quoteRequestWebhookEventEnvelopeShape,
    rfqId: uuidSchema,
    /** Always present — what lets a subscription bound to one Organization receive only its own events. */
    organizationId: uuidSchema,
  })
  .strict();
export type RfqCreatedEventV1 = z.infer<typeof RfqCreatedEventV1Schema>;

/** Payload of `rfq.expired.v1` — the expiry sweep moved a Quote Request to `Expired`. */
export const RfqExpiredEventV1Schema = z
  .object({
    ...quoteRequestWebhookEventEnvelopeShape,
    rfqId: uuidSchema,
    /** Always present — what lets a subscription bound to one Organization receive only its own events. */
    organizationId: uuidSchema,
  })
  .strict();
export type RfqExpiredEventV1 = z.infer<typeof RfqExpiredEventV1Schema>;

/** The event types `quote_requests` offers to outbound webhooks, in the order they are offered. */
export const QUOTE_REQUEST_WEBHOOK_EVENT_TYPES = [
  QUOTE_REQUEST_WEBHOOK_EVENTS.CREATED,
  QUOTE_REQUEST_WEBHOOK_EVENTS.EXPIRED,
] as const;

/** The strict schema of each offered event's payload, by event type. */
export const QUOTE_REQUEST_WEBHOOK_EVENT_SCHEMAS = {
  [QUOTE_REQUEST_WEBHOOK_EVENTS.CREATED]: RfqCreatedEventV1Schema,
  [QUOTE_REQUEST_WEBHOOK_EVENTS.EXPIRED]: RfqExpiredEventV1Schema,
} as const;

// ---------------------------------------------------------------------------
// Feature 153 — the quote PDF (`specs/153-quote-request-pdf-template/`)
// ---------------------------------------------------------------------------

/** The document type `quote_requests` registers with the document-template facility. */
export const QUOTE_REQUEST_DOCUMENT_TYPE = 'quote_requests.quote_request';

/** Owner answer Q4 — what one *Send PDF to customer* may carry. */
export const QUOTE_REQUEST_PDF_LIMITS = {
  maxRecipients: 5,
  maxMessageLength: 2000,
  /** 10 MiB — larger PDFs are refused rather than handed to a mail server. */
  maxAttachmentBytes: 10 * 1024 * 1024,
} as const;

const documentLanguageCode = z.string().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/);

/**
 * The data one quote PDF prints, built for the requesting administrator
 * (`data-model.md` §4.1). JSON-serialisable: the editor's sample is the same
 * shape.
 */
export const quoteRequestDocumentDataSchema = z.object({
  generatedAt: isoDateTimeSchema,
  quote: z.object({
    id: z.string(),
    businessId: z.string(),
    status: z.string(),
    revisionNumber: z.number().int().nonnegative(),
    createdAt: isoDateTimeSchema,
    submittedAt: isoDateTimeSchema.nullable(),
    approvedAt: isoDateTimeSchema.nullable(),
    expiresAt: isoDateTimeSchema.nullable(),
    headerNote: z.string().nullable(),
    /** A fraction: `0.23`. */
    taxRate: z.number(),
    currency: z.string(),
  }),
  channel: z.object({ id: z.string(), name: z.string() }).nullable(),
  buyer: z.object({
    organizationName: z.string(),
    legalName: z.string().nullable(),
    taxId: z.string().nullable(),
    address: z
      .object({
        line1: z.string(),
        line2: z.string().nullable(),
        postalCode: z.string(),
        city: z.string(),
        country: z.string(),
      })
      .nullable(),
    customerName: z.string().nullable(),
    customerEmail: z.string().nullable(),
  }),
  salesRep: z.object({ name: z.string(), email: z.string() }).nullable(),
  /** The quote's custom fields whose definition customers may see, with a value. */
  details: z.array(z.object({ label: z.string(), value: z.string() })),
  /** Feature 159 — the groups holding at least one line, in display order. */
  groups: z.array(lineGroupSchema).default([]),
  /** In display order. */
  lines: z.array(
    z.object({
      id: z.string(),
      productId: z.string(),
      productName: z.string(),
      variantLabel: z.string().nullable(),
      sku: z.string().nullable(),
      quantity: z.number(),
      packagingUnitName: z.string().nullable(),
      packagingUnitBaseQuantity: z.number().nullable(),
      agreedUnitPrice: z.number().nullable(),
      proposedUnitPrice: z.number().nullable(),
      referenceUnitPrice: z.number().nullable(),
      referenceCurrency: z.string().nullable(),
      lineCurrency: z.string(),
      lineNote: z.string().nullable(),
      /** Attribute code → display text in the export language. */
      attributes: z.record(z.string(), z.string()),
      /** Feature 159 — the line's group (`groups[].id`), `null` = ungrouped. */
      groupId: z.string().nullable().default(null),
      /** Feature 159 — order within the line's section. */
      position: z.number().int().nonnegative().default(0),
    }),
  ),
});
export type QuoteRequestDocumentData = z.infer<typeof quoteRequestDocumentDataSchema>;
export type QuoteRequestDocumentLine = QuoteRequestDocumentData['lines'][number];

/** `GET /api/v1/admin/quote-requests/:id/document-templates` — the export and send dialogs' choices. */
export const quoteRequestDocumentChoicesSchema = z.object({
  templates: z.array(
    z.object({
      id: uuidSchema,
      name: z.string(),
      salesChannelId: uuidSchema.nullable(),
      languages: z.array(z.string()),
      isDefault: z.boolean(),
    }),
  ),
  rememberedTemplateId: uuidSchema.nullable(),
  /** The remembered id is not among `templates` (deleted or out of reach). */
  rememberedTemplateMissing: z.boolean(),
  /** What an export without a choice uses; `null` = the built-in layout. */
  effectiveDefaultId: uuidSchema.nullable(),
  builtInLanguages: z.array(z.string()),
  /** The default language of the quote's channel (the system default channel when none). */
  suggestedLanguage: z.string(),
  /** Owner answer Q4 — the requesting customer's e-mail, the send dialog's preselected recipient. */
  requesterEmail: z.string().nullable(),
});
export type QuoteRequestDocumentChoices = z.infer<typeof quoteRequestDocumentChoicesSchema>;

/** `PUT /api/v1/admin/quote-requests/:id/document-template`. */
export const setQuoteRequestDocumentTemplateSchema = z.object({
  documentTemplateId: uuidSchema.nullable(),
});
export type SetQuoteRequestDocumentTemplate = z.infer<typeof setQuoteRequestDocumentTemplateSchema>;

/** `GET /api/v1/admin/quote-requests/:id/pdf` query. */
export const quoteRequestPdfQuerySchema = z.object({
  templateId: uuidSchema.optional(),
  language: documentLanguageCode.optional(),
});
export type QuoteRequestPdfQuery = z.infer<typeof quoteRequestPdfQuerySchema>;

/**
 * `POST /api/v1/admin/quote-requests/:id/pdf/send` (owner answer Q4). The
 * recipients are trimmed and de-duplicated case-insensitively — the first
 * spelling kept — before the 1–5 bound is applied.
 */
export const quoteRequestPdfSendRequestSchema = z.object({
  templateId: uuidSchema.optional(),
  language: documentLanguageCode.optional(),
  recipients: z
    .array(z.string().trim().max(254).email())
    .transform((addresses) => {
      const seen = new Set<string>();
      return addresses.filter((address) => {
        const key = address.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    })
    .pipe(z.array(z.string()).min(1).max(QUOTE_REQUEST_PDF_LIMITS.maxRecipients)),
  message: z.string().max(QUOTE_REQUEST_PDF_LIMITS.maxMessageLength).optional(),
});
export type QuoteRequestPdfSendRequest = z.infer<typeof quoteRequestPdfSendRequestSchema>;

export const quoteRequestPdfSendResultSchema = z.object({
  /** Addresses the e-mail was handed to. */
  sent: z.array(z.string()),
  /** Addresses whose delivery failed at the transport. */
  failed: z.array(z.string()),
  templateId: uuidSchema.nullable(),
  templateSource: z.enum(['explicit', 'default', 'built_in', 'canvas']),
  requestedTemplateMissing: z.boolean(),
});
export type QuoteRequestPdfSendResult = z.infer<typeof quoteRequestPdfSendResultSchema>;
