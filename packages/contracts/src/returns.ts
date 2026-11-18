import { z } from 'zod';
import { calendarDateSchema, isoDateTimeSchema, uuidSchema } from './common.js';
import { twoDecimalAmount } from './money-input.js';
import { lineQuantitySchema, REQUEST_LINE_ITEMS_MAX } from './line-bounds.js';

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
/**
 * `settled_outside` (`specs/180-off-platform-complaints/` FR-B33a, research R-19): a
 * case without a platform order settled the way the purchase was made — no money moves
 * through the platform, and an operator note says how.
 */
export const resolutionTypeSchema = z.enum(['refund', 'credit', 'replacement', 'repair', 'settled_outside']);
export type ResolutionType = z.infer<typeof resolutionTypeSchema>;

/**
 * The resolutions that settle a consumer withdrawal otherwise than by a refund
 * (issue #905, design D1). A consumer who withdraws is reimbursed by the same
 * means of payment unless they expressly agree otherwise (Directive 2011/83
 * art. 13(1)), so each needs the consumer's consent on record first.
 */
export const alternativeResolutionSchema = z.enum(['credit', 'replacement', 'repair']);
export type AlternativeResolution = z.infer<typeof alternativeResolutionSchema>;

/**
 * Who put the consent on record. `operator_recorded` is the only source today:
 * the consumer agrees by e-mail or telephone and an operator records it with
 * the evidence. `consumer_storefront` is reserved for a consumer's own click on
 * the storefront, should that be required later.
 */
export const alternativeConsentSourceSchema = z.enum(['operator_recorded', 'consumer_storefront']);
export type AlternativeConsentSource = z.infer<typeof alternativeConsentSourceSchema>;

/**
 * The consumer's consent to settle a withdrawal as `resolution` (issue #905,
 * design D1). `note` (the evidence) and `byAdminUserId` are the operator's:
 * the buyer's view of a case leaves both out.
 */
export const alternativeResolutionConsentSchema = z.object({
  resolution: alternativeResolutionSchema,
  /** When the consumer gave the consent, as the operator recorded it. */
  at: isoDateTimeSchema,
  note: z.string().optional(),
  byAdminUserId: uuidSchema.nullable().optional(),
  source: alternativeConsentSourceSchema,
});
export type AlternativeResolutionConsent = z.infer<typeof alternativeResolutionConsentSchema>;

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
  /**
   * `specs/180-off-platform-complaints/` FR-A30: a transition into this status
   * e-mails the filing customer (`return_status_entered`). Ignored for
   * `authorized` and `rejected`, which send their dedicated e-mail — the write
   * refuses `true` on those two (`dedicated_email_status`). Filing a case is not
   * an entry into the initial status (D-2), so it never sends this e-mail.
   */
  notifyCustomerOnEntry: z.boolean(),
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
  notifyCustomerOnEntry: z.boolean().optional(),
});

export const returnStatusUpdateSchema = z.object({
  name: z.record(z.string().min(2), z.string()).optional(),
  defaultName: z.string().min(1).max(120).optional(),
  isTerminal: z.boolean().optional(),
  weight: z.number().int().optional(),
  color: z.string().max(16).optional(),
  notifyCustomerOnEntry: z.boolean().optional(),
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
  /** `null` on a line of a case without a platform order (180 FR-B12). */
  orderItemId: uuidSchema.nullable(),
  /** `null` for a free-text model (180 FR-B12). */
  productId: uuidSchema.nullable(),
  productName: z.string(),
  quantity: z.number().int().positive(),
  reasonId: uuidSchema.nullable(),
  description: z.string().nullable(),
  inspectionOutcome: inspectionOutcomeSchema.nullable(),
  defaultRefundAmount: z.number().finite(),
  approvedRefundAmount: z.number().finite(),
  /**
   * Feature 155 (owner ruling R1) — whether the order line was returnable when
   * it was bought, as recorded at placement (`OrderReturnContextLine`); `null`
   * for a line placed before the record existed (treated as returnable) or one
   * the order no longer lists. A complaint line recorded `false` starts with an
   * approved refund of 0 and is marked in the admin case view. Optional on the
   * wire, so an older producer still parses.
   */
  returnableAtPurchase: z.boolean().nullable().optional(),
  /** 180 FR-B12 — the serial number the customer gave, on a complaint line. */
  serialNumber: z.string().nullable(),
});
export type ReturnCaseItemDto = z.infer<typeof returnCaseItemSchema>;

export const returnCaseCommentSchema = z.object({
  id: uuidSchema,
  /** `guest` — posted through a guest's tracking link (`specs/181-guest-complaints/` FR-042). */
  authorKind: z.enum(['admin', 'customer', 'guest']),
  body: z.string(),
  isCustomerVisible: z.boolean(),
  /**
   * `specs/180-off-platform-complaints/` FR-A20: the operator asked for the
   * comment to be e-mailed. Admin view only — the buyer's view leaves it out —
   * and it says "requested", not "sent": delivery is asynchronous (FR-A50).
   */
  notifyCustomer: z.boolean().optional(),
  createdAt: isoDateTimeSchema,
});
export type ReturnCaseCommentDto = z.infer<typeof returnCaseCommentSchema>;

export const returnCaseSummarySchema = z.object({
  id: uuidSchema,
  rmaNumber: z.string().nullable(),
  kind: returnKindSchema,
  /** `null` = a case without a platform order (180 R5, FR-B34). */
  orderId: uuidSchema.nullable(),
  statusCode: returnStatusCodeSchema,
  statusLabel: z.string(),
  totalRefundAmount: z.number().finite(),
  currency: z.string().length(3),
  submittedAt: isoDateTimeSchema,
  /**
   * Who filed the case (`specs/170-organization-roles/` FR-053, research R-41
   * item 6). A buyer whose role holds `returns.view_organization` lists the
   * Organization's cases, so the summary names its filer — as the order summary
   * carries `placedByCustomerAccountId` — and the storefront can tell a
   * colleague's case, whose follow-up actions stay the filer's, from the
   * caller's own. Additive: the detail always carried it, and the operator's
   * row (`adminReturnRowSchema`) inherits it through `.extend`.
   *
   * `null` = a **guest case** (`specs/181-guest-complaints/` research R-2): filed by
   * a person without an account, with no organization either. Admin consumers
   * must handle it.
   */
  customerAccountId: uuidSchema.nullable(),
  /**
   * `specs/180-off-platform-complaints/` FR-A44 (D-4, research R-20): the case's
   * readable reference — its RMA number once assigned, until then `#` plus the
   * first eight hex characters of its id, upper-cased. Computed on read, never
   * stored; a display aid, not a key (the link carries the id).
   */
  reference: z.string(),
  /** 180 FR-B34 — derived: the case has no platform order. Never written. */
  offPlatform: z.boolean(),
  /** 180 D-3 — the first line's product name; the reader composes "+N more" from `lineCount`. */
  productLabel: z.string(),
  lineCount: z.number().int().nonnegative(),
  /** 180 D-3 — the purchase date of a case without an order; `null` on order cases. */
  purchaseDate: calendarDateSchema.nullable(),
  /** 181 — derived: the case has no customer account (a guest filed it). Never written. */
  guest: z.boolean(),
});
export type ReturnCaseSummary = z.infer<typeof returnCaseSummarySchema>;

/** 180 FR-B16 — the ship-back address as submitted. */
export const returnAddressSnapshotSchema = z.object({
  name: z.string().trim().min(1).max(200),
  company: z.string().trim().max(200).optional(),
  street: z.string().trim().min(1).max(255),
  postalCode: z.string().trim().min(1).max(20),
  city: z.string().trim().min(1).max(120),
  countryCode: z.string().regex(/^[A-Z]{2}$/, 'ISO 3166-1 alpha-2'),
  phone: z.string().trim().max(40).optional(),
});
export type ReturnAddressSnapshot = z.infer<typeof returnAddressSnapshotSchema>;

/** 180 FR-B16 — the contact data as submitted. */
export const returnContactSchema = z.object({
  name: z.string(),
  email: z.string(),
  phone: z.string().nullable(),
});
export type ReturnContact = z.infer<typeof returnContactSchema>;

export const returnClauseModeSchema = z.enum(['must_accept', 'inform_only']);
export type ReturnClauseMode = z.infer<typeof returnClauseModeSchema>;

/**
 * 180 FR-B31 — a clause as the submission showed it, stored with the case: every
 * clause shown (both modes), in the submission language, with the link as shown.
 */
export const shownClauseSchema = z.object({
  clauseId: uuidSchema,
  revision: z.number().int(),
  mode: returnClauseModeSchema,
  language: z.string(),
  label: z.string(),
  text: z.string(),
  linkUrl: z.string().url().nullable(),
});
export type ShownClause = z.infer<typeof shownClauseSchema>;

/** 180 FR-B20 — what an attachment is. */
export const returnAttachmentTypeSchema = z.enum(['photo', 'proof_of_purchase', 'other']);
export type ReturnAttachmentType = z.infer<typeof returnAttachmentTypeSchema>;

/**
 * An attachment of a case (180 FR-B20, FR-B23; research R-12). Its bytes are served by
 * the case's own guarded file routes; it is never a media-library asset.
 */
export const returnAttachmentSchema = z.object({
  id: uuidSchema,
  returnCaseId: uuidSchema,
  /** The line the file shows (a photo of that product's defect); `null` for the whole case. */
  returnCaseItemId: uuidSchema.nullable(),
  type: returnAttachmentTypeSchema,
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  createdAt: isoDateTimeSchema,
  /** 181 (admin-api.md A2) — a guest added the file, before filing or through the tracking link. */
  uploadedByGuest: z.boolean(),
});
export type ReturnAttachmentDto = z.infer<typeof returnAttachmentSchema>;

/** `POST /api/v1/returns/uploads` — a pending upload, claimed by the create request (180 §C2). */
export const returnUploadSchema = z.object({
  uploadId: uuidSchema,
  type: returnAttachmentTypeSchema,
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  expiresAt: isoDateTimeSchema,
});
export type ReturnUploadDto = z.infer<typeof returnUploadSchema>;

/** The non-file fields of a multipart upload (180 §C2, §C4). */
export const returnAttachmentUploadFieldsSchema = z.object({
  type: returnAttachmentTypeSchema,
  returnCaseItemId: uuidSchema.optional(),
});

/** The limits an upload is judged by (180 FR-B20). */
export const RETURN_ATTACHMENT_LIMITS = {
  maxFileBytes: 10 * 1024 * 1024,
  maxSubmissionBytes: 30 * 1024 * 1024,
  maxFilesPerCase: 10,
  acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
} as const;

/**
 * Who authorized a case (`specs/180-off-platform-complaints/` FR-A40 – FR-A43).
 * `adminUserId` null: authorized before the authorizer was recorded and the
 * audit log names nobody (*unknown*). `name` null with an id: the id resolves to
 * no administrator any more (*former administrator*). The name is resolved at
 * read, never stored.
 */
export const returnCaseAuthorizerSchema = z.object({
  adminUserId: uuidSchema.nullable(),
  name: z.string().nullable(),
});
export type ReturnCaseAuthorizer = z.infer<typeof returnCaseAuthorizerSchema>;

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
  /** `null` = a guest case (181). */
  customerAccountId: uuidSchema.nullable(),
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
  /**
   * Issue #876 — the order's delivery cost and payment surcharge this case
   * refunds: a consumer's withdrawal from the whole sale refunds both
   * (Directive 2011/83 art. 13(1)) on the case that completes it. The approved
   * amounts — provisional until the case is settled — and `0` on every other
   * case. Optional on the wire, so an older producer still parses.
   */
  chargeRefunds: z.object({ delivery: z.number().finite(), surcharge: z.number().finite() }).optional(),
  /**
   * Whether the case is a consumer's withdrawal from a distance contract (issue
   * #905, design §2): a `return` by a personal Organization, filed while the
   * withdrawal function was available for the order. Fixed when the case is
   * filed. `null` for a case filed before the classification existed.
   */
  consumerWithdrawal: z.boolean().nullable(),
  /** The consumer's consent to a resolution other than a refund, when one is on record (design D1). */
  alternativeResolutionConsent: alternativeResolutionConsentSchema.nullable(),
  /** When the case entered `authorized`; null while it has not. */
  authorizedAt: isoDateTimeSchema.nullable(),
  /**
   * `specs/180-off-platform-complaints/` FR-A41: who authorized it. Null while the
   * case is not authorized — and on the buyer's view, which names no operator.
   */
  authorizedBy: returnCaseAuthorizerSchema.nullable(),
  // --- 180 phase B (contracts/admin-api.md §B2) ---
  /** The purchase as the customer stated it; `null` on order cases. */
  purchase: z.object({ proofNumber: z.string().nullable(), date: calendarDateSchema }).nullable(),
  /** `null` on order cases and after erasure (FR-B43). */
  contact: returnContactSchema.nullable(),
  returnAddress: returnAddressSnapshotSchema.nullable(),
  attachments: z.array(returnAttachmentSchema),
  acceptedClauses: z.array(shownClauseSchema),
  clausesAcceptedAt: isoDateTimeSchema.nullable(),
  /** The note of a `settled_outside` settlement — admin view only (`null` on the buyer's). */
  resolutionNote: z.string().nullable(),
  /** When the filer's personal data was erased (D-8) — admin view only. */
  personalDataErasedAt: isoDateTimeSchema.nullable(),
  // --- 181 guest complaints (contracts/admin-api.md A2); `null` on customer cases ---
  /** When the guest's contact address was verified (FR-063). */
  contactVerifiedAt: isoDateTimeSchema.nullable(),
  /** Computed: `closedAt` + 90 days. `null` while the case is open, or once erased. */
  trackingLinkValidUntil: isoDateTimeSchema.nullable(),
  /** Computed: `closedAt` + the clamped retention. `null` while open or once erased. */
  guestDataErasureDueAt: isoDateTimeSchema.nullable(),
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
  /**
   * Feature 155 — may this line be included in a `return` case? (complaints are never
   * restricted). From the value recorded at placement; a line placed before the feature
   * is returnable (FR-025).
   */
  returnable: z.boolean(),
  notReturnableReason: z.enum(['product_not_returnable']).optional(),
});

export const returnableResponseSchema = z.object({
  /**
   * `false` = no `return`-kind case can be opened. With `reason: 'no_returnable_lines'`
   * (feature 155) a `complaint` is still accepted.
   */
  eligible: z.boolean(),
  reason: z
    .enum(['order_not_completing', 'window_passed', 'fully_returned', 'no_returnable_lines'])
    .optional(),
  freeReturnEligible: z.boolean(),
  lines: z.array(returnableLineSchema),
});
export type ReturnableResponse = z.infer<typeof returnableResponseSchema>;

/** The refusal of a no-order line naming both or neither a product and a model (180 FR-B12). */
export const PRODUCT_OR_MODEL_REQUIRED = 'product_or_model_required';

const clauseReferenceSchema = z.object({ id: uuidSchema, revision: z.number().int().positive() });

/** What both branches of the create request may carry (180 §C3). */
const createReturnCaseCommon = {
  /**
   * Pending uploads of the caller, claimed in the case's transaction (research R-12).
   * `line` ties a file to one line of this request — its index in `lines` — so a photo
   * shows the defect of that product; without it the file belongs to the whole case.
   */
  attachments: z
    .array(z.object({ uploadId: uuidSchema, line: z.number().int().min(0).max(REQUEST_LINE_ITEMS_MAX - 1).optional() }))
    .max(RETURN_ATTACHMENT_LIMITS.maxFilesPerCase)
    .optional(),
  /** Every clause the form rendered (research R-14). */
  shownClauses: z.array(clauseReferenceSchema).optional(),
  /** The `must_accept` clauses ticked. */
  acceptedClauses: z.array(clauseReferenceSchema).optional(),
  comment: z.string().max(2000).optional(),
  /** Idempotency key of the post (research R-18). */
  submissionKey: uuidSchema.optional(),
};

const orderReturnLineSchema = z.strictObject({
  orderItemId: uuidSchema,
  quantity: lineQuantitySchema,
  reasonId: uuidSchema,
  description: z.string().max(2000).optional(),
  serialNumber: z.string().trim().max(100).optional(),
});

const offPlatformReturnLineSchema = z
  .strictObject({
    productId: uuidSchema.optional(),
    modelName: z.string().trim().min(1).max(255).optional(),
    quantity: lineQuantitySchema,
    reasonId: uuidSchema,
    description: z.string().trim().min(1).max(2000),
    serialNumber: z.string().trim().max(100).optional(),
  })
  .refine((l) => Boolean(l.productId) !== Boolean(l.modelName), {
    message: PRODUCT_OR_MODEL_REQUIRED,
    params: { code: PRODUCT_OR_MODEL_REQUIRED },
  });

/** A case against a platform order (unchanged but for the fields of 180 §C3). */
export const createOrderReturnCaseRequestSchema = z.strictObject({
  orderId: uuidSchema,
  kind: returnKindSchema,
  lines: z.array(orderReturnLineSchema).min(1).max(REQUEST_LINE_ITEMS_MAX),
  ...createReturnCaseCommon,
});

/** A complaint without a platform order (180 FR-B10 – FR-B16). */
export const createOffPlatformComplaintRequestSchema = z.strictObject({
  orderId: z.null(),
  kind: z.literal('complaint'),
  lines: z.array(offPlatformReturnLineSchema).min(1).max(REQUEST_LINE_ITEMS_MAX),
  purchase: z.strictObject({ proofNumber: z.string().trim().max(100).optional(), date: calendarDateSchema }),
  contact: z.strictObject({
    name: z.string().trim().min(1).max(200),
    email: z.string().trim().email().max(254),
    phone: z.string().trim().max(40).optional(),
  }),
  returnAddress: returnAddressSnapshotSchema,
  ...createReturnCaseCommon,
});

/**
 * `POST /api/v1/returns` (180 §C3). `attachmentAssetIds` is **removed**: no customer
 * could create an asset, and it linked any asset id unchecked (research F5, R-12). It is
 * refused as an unknown key, so a caller still sending it learns it at once.
 */
export const createReturnCaseRequestSchema = z.union([
  createOrderReturnCaseRequestSchema,
  createOffPlatformComplaintRequestSchema,
]);
export type CreateReturnCaseRequest = z.infer<typeof createReturnCaseRequestSchema>;
export type CreateOrderReturnCaseRequest = z.infer<typeof createOrderReturnCaseRequestSchema>;
export type CreateOffPlatformComplaintRequest = z.infer<typeof createOffPlatformComplaintRequestSchema>;

export const customerAddCommentRequestSchema = z.object({ body: z.string().min(1).max(2000) });

/** A clause as the form renders it, in the request language (180 §C1). */
export const returnFormClauseSchema = z.object({
  id: uuidSchema,
  revision: z.number().int(),
  mode: returnClauseModeSchema,
  label: z.string(),
  text: z.string(),
  linkUrl: z.string().url().nullable(),
});
export type ReturnFormClause = z.infer<typeof returnFormClauseSchema>;

/** `GET /api/v1/returns/form-config` (180 §C1, research R-21). */
export const returnFormConfigSchema = z.object({
  offPlatformComplaintsEnabled: z.boolean(),
  proofOfPurchaseRequired: z.boolean(),
  /** D-11 — the confirmation e-mail (`return_submitted`) is active. */
  confirmationEmailEnabled: z.boolean(),
  /** D-12 — the shop's day in `returns.time_zone`. */
  today: calendarDateSchema,
  clauses: z.array(returnFormClauseSchema),
  attachmentLimits: z.object({
    maxFileBytes: z.number().int(),
    maxSubmissionBytes: z.number().int(),
    maxFilesPerCase: z.number().int(),
    acceptedMimeTypes: z.array(z.string()),
  }),
});
export type ReturnFormConfig = z.infer<typeof returnFormConfigSchema>;

export const returnFormConfigQuerySchema = z.object({
  kind: returnKindSchema.optional(),
  orderId: uuidSchema.optional(),
});

// ---------------------------------------------------------------------------
// Clauses (180 US7, contracts/admin-api.md §B5)
// ---------------------------------------------------------------------------

const localizedClauseText = (max: number) => z.record(z.string().min(2), z.string().trim().min(1).max(max));
const localizedHttpsUrl = z.record(
  z.string().min(2),
  z.string().url().max(2000).refine((u) => u.startsWith('https://'), { message: 'https_required' }),
);

export const returnClauseAppliesToSchema = z.enum(['return', 'complaint', 'both']);

export const returnCaseClauseSchema = z.object({
  id: uuidSchema,
  label: localizedClauseText(120),
  text: localizedClauseText(5000),
  linkUrl: localizedHttpsUrl.nullable(),
  appliesTo: returnClauseAppliesToSchema,
  mode: returnClauseModeSchema,
  salesChannelId: uuidSchema.nullable(),
  weight: z.number().int(),
  isActive: z.boolean(),
  revision: z.number().int().positive(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type ReturnCaseClauseDto = z.infer<typeof returnCaseClauseSchema>;

export const createReturnCaseClauseRequestSchema = returnCaseClauseSchema
  .pick({ label: true, text: true, linkUrl: true, appliesTo: true, mode: true, salesChannelId: true, weight: true, isActive: true })
  .partial({ linkUrl: true, appliesTo: true, mode: true, salesChannelId: true, weight: true, isActive: true });
export type CreateReturnCaseClauseRequest = z.infer<typeof createReturnCaseClauseRequestSchema>;

export const updateReturnCaseClauseRequestSchema = createReturnCaseClauseRequestSchema.partial();
export type UpdateReturnCaseClauseRequest = z.infer<typeof updateReturnCaseClauseRequestSchema>;

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
// Guest complaints (`specs/181-guest-complaints/` contracts/guest-api.md G1 – G10)
// ---------------------------------------------------------------------------

/** The storefront cookie that carries a guest session (research R-4). */
export const RETURNS_GUEST_SESSION_COOKIE = 'b2b_returns_guest';
/** The request header that carries a tracking token, never the URL (research R-5). */
export const RETURNS_TRACKING_TOKEN_HEADER = 'x-returns-tracking-token';
/** How long a verification link stays usable (FR-022). */
export const GUEST_VERIFICATION_LINK_VALID_MINUTES = 60;

/** G1 `GET /api/v1/returns/guest/availability` — off-platform ∧ guest complaints on the channel. */
export const guestAvailabilitySchema = z.object({ enabled: z.boolean() });
export type GuestAvailability = z.infer<typeof guestAvailabilitySchema>;

/** G2 `POST /api/v1/returns/guest/verifications`. `hp` is the honeypot (research R-8). */
export const guestVerificationRequestSchema = z.strictObject({
  email: z.string().trim().email().max(254),
  hp: z.string().max(200).optional(),
  /** The storefront's copy language; the e-mail uses the channel's. */
  language: z.string().trim().min(2).max(16).optional(),
});
export type GuestVerificationRequest = z.infer<typeof guestVerificationRequestSchema>;

/** G2's one answer, whatever happened to the address (FR-021). */
export const guestVerificationAcceptedSchema = z.object({ linkValidMinutes: z.number().int().positive() });
export type GuestVerificationAccepted = z.infer<typeof guestVerificationAcceptedSchema>;

/** G3 `POST /api/v1/returns/guest/sessions` — redeem a verification link. */
export const guestSessionRedeemRequestSchema = z.strictObject({ token: z.string().min(1).max(512) });
export type GuestSessionRedeemRequest = z.infer<typeof guestSessionRedeemRequestSchema>;

/** G3's answer: the storefront sets {@link RETURNS_GUEST_SESSION_COOKIE} from `sessionToken`. */
export const guestSessionSchema = z.object({
  sessionToken: z.string(),
  email: z.string(),
  expiresAt: isoDateTimeSchema,
});
export type GuestSession = z.infer<typeof guestSessionSchema>;

/** G5 `GET /api/v1/returns/guest/form-config` — 180's C1 for a complaint without an order. */
export const guestFormConfigSchema = returnFormConfigSchema.extend({
  /**
   * The active reasons a complaint may give, as `GET /api/v1/returns/reasons?kind=complaint`
   * answers a customer — that route needs a customer session, and the guest form has none
   * (181 batch 4; additive to G5, accepted by the lead on 2026-11-16).
   */
  reasons: z.array(returnReasonSchema),
  verifiedEmail: z.string(),
  sessionExpiresAt: isoDateTimeSchema,
  /** The guest confirmation cannot be switched off (FR-045). */
  confirmationEmailEnabled: z.literal(true),
});
export type GuestFormConfig = z.infer<typeof guestFormConfigSchema>;

/**
 * G7 `POST /api/v1/returns/guest/cases`. Strict at every level: a body naming an
 * account, an organization, an order or a channel is refused (FR-034), and the contact
 * carries no e-mail — it is the session's verified address (FR-031).
 */
export const createGuestComplaintRequestSchema = z.strictObject({
  kind: z.literal('complaint'),
  lines: z.array(offPlatformReturnLineSchema).min(1).max(REQUEST_LINE_ITEMS_MAX),
  purchase: z.strictObject({ proofNumber: z.string().trim().max(100).optional(), date: calendarDateSchema }),
  contact: z.strictObject({
    name: z.string().trim().min(1).max(200),
    phone: z.string().trim().max(40).optional(),
  }),
  returnAddress: returnAddressSnapshotSchema,
  ...createReturnCaseCommon,
  hp: z.string().max(200).optional(),
});
export type CreateGuestComplaintRequest = z.infer<typeof createGuestComplaintRequestSchema>;

/** G7's answer. The token is shown once on the success page (FR-036). */
export const guestCaseFiledSchema = z.object({
  reference: z.string(),
  trackingToken: z.string(),
  /** Where the confirmation went. */
  email: z.string(),
});
export type GuestCaseFiled = z.infer<typeof guestCaseFiledSchema>;

/** `details.limit` of `RETURN_GUEST_LIMIT_REACHED`. */
export const guestLimitSchema = z.enum(['cases_per_session', 'cases_per_address', 'comments_per_case']);
export type GuestLimit = z.infer<typeof guestLimitSchema>;

/** G8 `GET /api/v1/returns/track` — the tracking page. Customer-visible content only (FR-041). */
export const guestCaseViewSchema = z.object({
  reference: z.string(),
  kind: z.literal('complaint'),
  /** The label in the request language. */
  status: z.object({ code: z.string(), label: z.string() }),
  /** The page is read-only when true (FR-042). */
  isClosed: z.boolean(),
  submittedAt: isoDateTimeSchema,
  lines: z.array(
    z.object({
      productName: z.string(),
      quantity: z.number().int(),
      reasonLabel: z.string(),
      description: z.string(),
      serialNumber: z.string().nullable(),
    }),
  ),
  purchase: z.object({ proofNumber: z.string().nullable(), date: calendarDateSchema }),
  contact: z.object({ name: z.string(), email: z.string(), phone: z.string().nullable() }),
  returnAddress: returnAddressSnapshotSchema,
  rmaNumber: z.string().nullable(),
  comments: z.array(
    z.object({ id: uuidSchema, authorKind: z.enum(['shop', 'you']), body: z.string(), createdAt: isoDateTimeSchema }),
  ),
  attachments: z.array(
    z.object({
      id: uuidSchema,
      type: returnAttachmentTypeSchema,
      filename: z.string(),
      sizeBytes: z.number().int(),
      lineIndex: z.number().int().nullable(),
    }),
  ),
  /** `null` while the case is open. */
  linkValidUntil: isoDateTimeSchema.nullable(),
  /**
   * Why the shop rejected the complaint, as the account case page shows it — customer-visible
   * text, not a staff note (owner ruling O-1, 2026-11-16; FR-041). `null` when there is none.
   */
  rejectionReason: z.string().nullable(),
});
export type GuestCaseView = z.infer<typeof guestCaseViewSchema>;

/** G9 `POST /api/v1/returns/track/comments`. */
export const guestCommentRequestSchema = z.strictObject({ body: z.string().min(1).max(2000) });
export type GuestCommentRequest = z.infer<typeof guestCommentRequestSchema>;

/** G10 `POST /api/v1/returns/track/attachments` — the multipart form's non-file fields. */
export const guestTrackingAttachmentFieldsSchema = z.object({
  type: returnAttachmentTypeSchema,
  lineIndex: z.coerce.number().int().min(0).max(REQUEST_LINE_ITEMS_MAX - 1).optional(),
});

/** A3 `POST /api/v1/admin/returns/:id/guest/tracking-link` — the answer. */
export const adminReissueTrackingLinkResultSchema = z.object({ trackingVersion: z.number().int().positive() });
export type AdminReissueTrackingLinkResult = z.infer<typeof adminReissueTrackingLinkResultSchema>;

/** A5 `POST /api/v1/admin/returns/:id/guest/erase` — an explicit, irreversible confirmation. */
export const adminEraseGuestDataRequestSchema = z.strictObject({ confirm: z.literal(true) });
export const adminEraseGuestDataResultSchema = z.object({ personalDataErasedAt: isoDateTimeSchema });
export type AdminEraseGuestDataResult = z.infer<typeof adminEraseGuestDataResultSchema>;

// ---------------------------------------------------------------------------
// Events (180 settings-emails-events.md §3)
// ---------------------------------------------------------------------------

/** Emitted by Command `return_case.create`, dispatched after commit. Ids only. */
export const RETURN_CASE_CREATED_EVENT = 'return_case.created.v1';

export const ReturnCaseCreatedEventV1Schema = z.strictObject({
  eventId: uuidSchema,
  occurredAt: isoDateTimeSchema,
  returnCaseId: uuidSchema,
  /** `null` exactly when `guest` (181, settings-emails-events.md §3). */
  organizationId: uuidSchema.nullable(),
  salesChannelId: uuidSchema,
  kind: returnKindSchema,
  offPlatform: z.boolean(),
  /** 181 — the case was filed by a guest without an account. */
  guest: z.boolean(),
});
export type ReturnCaseCreatedEventV1 = z.infer<typeof ReturnCaseCreatedEventV1Schema>;

// ---------------------------------------------------------------------------
// Admin requests (US2 / US3)
// ---------------------------------------------------------------------------

export const adminTransitionRequestSchema = z.object({
  to: returnStatusCodeSchema,
  reason: z.string().max(2000).optional(),
});

export const adminRejectRequestSchema = z.object({ reason: z.string().min(1).max(2000) });

/**
 * The refusal of `notifyCustomer` on an internal comment
 * (`specs/180-off-platform-complaints/` FR-A21): the issue's message and the
 * `details.code` of the route's 422 `VALIDATION_FAILED`.
 */
export const NOTIFY_REQUIRES_CUSTOMER_VISIBLE = 'notify_requires_customer_visible';

export const adminAddCommentRequestSchema = z
  .object({
    body: z.string().min(1).max(2000),
    isCustomerVisible: z.boolean(),
    notifyCustomer: z.boolean(),
  })
  .refine((b) => !(b.notifyCustomer && !b.isCustomerVisible), {
    path: ['notifyCustomer'],
    message: NOTIFY_REQUIRES_CUSTOMER_VISIBLE,
    params: { code: NOTIFY_REQUIRES_CUSTOMER_VISIBLE },
  });
export type AdminAddCommentRequest = z.infer<typeof adminAddCommentRequestSchema>;

export const adminReturnRowSchema = returnCaseSummarySchema.extend({
  customerName: z.string().nullable(),
  organizationName: z.string().nullable(),
  /**
   * `specs/180-off-platform-complaints/` FR-A41: the *Authorized by* column,
   * resolved per page in one batched lookup. Not sortable
   * ({@link adminReturnsSortSchema} is unchanged).
   */
  authorizedBy: returnCaseAuthorizerSchema.nullable(),
});
export type AdminReturnRow = z.infer<typeof adminReturnRowSchema>;

// ---------------------------------------------------------------------------
// Settlement (US5)
// ---------------------------------------------------------------------------

/** One order charge a settlement may refund (issue #876): the most that may be approved, and the amount prefilled. */
export const settlementChargeSchema = z.object({
  cap: z.number().finite(),
  approved: z.number().finite(),
});
export type SettlementCharge = z.infer<typeof settlementChargeSchema>;

export const settlementPrefillSchema = z.object({
  currency: z.string().length(3),
  /**
   * Every resolution, always: a client that predates the consent gate keeps
   * working, and the settlement's `422` is the boundary
   * (`RETURN_ALTERNATIVE_RESOLUTION_CONSENT_REQUIRED`).
   */
  resolutionOptions: z.array(resolutionTypeSchema),
  /** The resolution the form starts on (issue #905): `refund`. */
  defaultResolution: resolutionTypeSchema,
  /**
   * The resolutions this case cannot settle as until the consumer's consent is
   * recorded (issue #905, design D1): on a consumer withdrawal, every one but a
   * refund and the one consented to; empty on any other case.
   */
  consentRequiredFor: z.array(resolutionTypeSchema),
  /**
   * The order's own payment method, which a refund proposes (Directive 2011/83
   * art. 13(1), "the same means of payment"). `null` when the order cannot be
   * read.
   */
  defaultRefundPaymentMethodId: uuidSchema.nullable(),
  items: z.array(
    z.object({
      returnCaseItemId: uuidSchema,
      productName: z.string(),
      quantity: z.number().int().positive(),
      defaultRefundAmount: z.number().finite(),
      approvedRefundAmount: z.number().finite(),
    }),
  ),
  /**
   * Issue #876 — the order's charges the case may refund: present only on a
   * consumer's withdrawal that completes the order, and each charge only when
   * its cap is above 0. `cap` is what was paid for it less what earlier cases
   * refunded — the most the operator may approve; `approved` is what settles
   * if the field is omitted: the cap within the withdrawal window (the
   * statutory 14 days or the channel's longer free-return window), `0`
   * outside it. On a settled case `cap` equals `approved`, and a charge settled
   * at 0 is left out; the cap at settlement is recorded in the
   * `return.settled` audit entry.
   */
  charges: z
    .object({
      delivery: settlementChargeSchema.optional(),
      surcharge: settlementChargeSchema.optional(),
    })
    .optional(),
});
export type SettlementPrefill = z.infer<typeof settlementPrefillSchema>;

export const settlementRequestSchema = z.object({
  resolutionType: resolutionTypeSchema,
  lines: z
    .array(
      z.object({
        returnCaseItemId: uuidSchema,
        approvedRefundAmount: twoDecimalAmount(z.number().finite().nonnegative()),
      }),
    )
    // A case line named twice is refused before anything moves (issue #417,
    // review of PR #423): the refund would sum both entries and the correction
    // keep one, refusing only after the gateway had refunded.
    .superRefine((lines, ctx) => {
      const seen = new Set<string>();
      lines.forEach((line, index) => {
        if (seen.has(line.returnCaseItemId)) {
          ctx.addIssue({ code: 'custom', path: [index, 'returnCaseItemId'], message: 'duplicate_line' });
        }
        seen.add(line.returnCaseItemId);
      });
    })
    .default([]),
  refundPaymentMethodId: uuidSchema.optional(),
  createCorrectiveInvoice: z.boolean().optional(),
  /**
   * Issue #876 — what the case refunds of the order's delivery cost and of its
   * payment surcharge (ruling Q2 on PR #965):
   * - omitted: the default recomputed under the order's lock (the full amount
   *   within the withdrawal window, 0 outside it);
   * - present: settled exactly as sent, 0 included, when it is at most the cap
   *   (art. 13(2): a premium delivery reduced to the standard one);
   * - above the cap: refused `422 refund_exceeds_paid`, with nothing written.
   * Only a consumer's withdrawal that completes the order, settled with a
   * refund or a credit, has a cap above 0. This deliberately differs from the
   * line rule, where an amount equal to a default means the default approved.
   */
  deliveryRefundAmount: twoDecimalAmount(z.number().finite().nonnegative()).optional(),
  surchargeRefundAmount: twoDecimalAmount(z.number().finite().nonnegative()).optional(),
  /** 180 FR-B33a — how a `settled_outside` case was settled; required for that resolution. */
  resolutionNote: z.string().trim().min(1).max(2000).optional(),
});
export type SettlementRequest = z.infer<typeof settlementRequestSchema>;

/**
 * `POST /api/v1/admin/returns/:id/alternative-consent` (issue #905, design D1):
 * the operator records that the consumer agreed to `resolution`, when, and the
 * evidence. The moment may not be in the future, nor before the case was filed.
 */
export const recordAlternativeConsentRequestSchema = z.object({
  resolution: alternativeResolutionSchema,
  consentGivenAt: isoDateTimeSchema,
  /** Where the consent is documented, e.g. "Customer's e-mail of 10 Nov 2026, ticket #123". */
  note: z.string().trim().min(1).max(2000),
});
export type RecordAlternativeConsentRequest = z.infer<typeof recordAlternativeConsentRequestSchema>;

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
  returnCost: twoDecimalAmount(z.number().finite().nonnegative()),
  currency: z.string().length(3),
  isActive: z.boolean().optional(),
});

export const returnDeliveryMethodUpdateSchema = z.object({
  returnCost: twoDecimalAmount(z.number().finite().nonnegative()).optional(),
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
  /**
   * 180 FR-B35, widened by 181 (admin-api.md A1) — absent = all; `platform` = with an
   * order; `off_platform` = every case without a platform order (180's meaning, so its
   * saved views keep it); `off_platform_customer` = without an order, filed by a
   * customer; `guest` = filed by a guest without an account.
   */
  origin: z.enum(['platform', 'off_platform', 'off_platform_customer', 'guest']).optional(),
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

/**
 * `GET /api/v1/admin/returns/notification-health` (`specs/180-off-platform-complaints/`
 * D-7, research R-22): where the new-case e-mail goes to nobody. `global` — the
 * global `returns.new_case_recipients` holds no valid address; `salesChannelIds`
 * — the channels whose effective value (the channel's, else the global) holds none.
 */
export const returnNotificationHealthSchema = z.object({
  recipientsMissing: z.object({
    global: z.boolean(),
    salesChannelIds: z.array(uuidSchema),
  }),
});
export type ReturnNotificationHealth = z.infer<typeof returnNotificationHealthSchema>;

export const bulkTransitionResultSchema = z.object({
  moved: z.array(uuidSchema),
  skipped: z.array(z.object({ id: uuidSchema, reason: z.string() })),
});
export type BulkTransitionResult = z.infer<typeof bulkTransitionResultSchema>;

// Saved list views on the return list (#312) use the shared shapes in
// `saved-list-views.ts`: `createReturnSavedViewRequestSchema`,
// `updateReturnSavedViewRequestSchema` and `savedListViewSchema`.

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

/**
 * One money-moving resolution a settled return case recorded for an order
 * (issue #428): a refund (`resolutionType: 'refund'`) or a credit-limit top-up
 * (`'credit'`), its two-place amount, and whether it was issued.
 */
export interface OrderReturnRefund {
  resolutionType: 'refund' | 'credit';
  /** A two-place decimal string, as stored. */
  amount: string;
  settlementState: 'issued' | 'pending_manual' | 'failed';
}

/**
 * How much of one order line came back (issue #435): the quantity, summed over
 * the order's settled `return`-kind cases resolved with a refund or a credit —
 * whether or not the money has been paid out. A replacement, a repair and a
 * complaint are not counted: the goods were not given up for money.
 */
export interface OrderReturnedQuantity {
  orderItemId: string;
  /** A whole number of units, greater than 0. */
  quantity: number;
  /**
   * The part of the order-level discount those cases carried back for the
   * line, as recorded at settlement — each case line's whole default discount:
   * the goods left, and their share of the discount with them, whatever was
   * refunded for them (issue #854) — summed, as a two-place decimal string
   * (`'0.00'` without a discount). An invoice issued afterwards takes it off
   * its discount line, so the line carries only the kept goods' share.
   */
  discount: string;
  /**
   * What those cases withheld for the line (issue #854, owner ruling of
   * 2026-11-07: the amount withheld on a return is part of the goods' price, at
   * the goods' VAT rate) — per case line, its stored default refund less what
   * was approved, never below 0; summed, as a two-place gross decimal string. The default is already net of
   * the line's discount share, so this carries no discount. An invoice issued
   * afterwards charges it at the line's VAT rate. Absent or `'0.00'` when
   * nothing was withheld.
   */
  retained?: string;
}

/**
 * The key of the transaction-scoped advisory lock (`pg_advisory_xact_lock(hashtext(key))`)
 * that serialises the writes about one order's returns. Owner: `returns`.
 *
 * `returns` takes it to create a case and to settle one; `invoices` takes it to
 * issue an invoice (review of PR #865, F3), so an invoice is never issued from
 * a case a settlement has moved money for but not yet recorded as resolved —
 * it waits, and then lists only the kept lines.
 */
export function returnCaseOrderLockKey(orderId: string): string {
  return `return_cases:${orderId}`;
}

/**
 * Container name: `returnRefundReadPort`. Owner: `returns`.
 *
 * What the order's settled return cases refunded, so a reader that states what
 * was paid for an order — the invoice — can count a refund that never passed
 * through `payments`: a manual bank transfer for an order paid offline, or a
 * credit-limit top-up. A gateway order's refunds also appear here, and the
 * reader is the one that knows `payments` reports those (issue #428).
 *
 * **Owner off:** the seam fails closed — resolving this port throws
 * `ModuleDisabledError`. A reader that may degrade decides presence first.
 */
export interface ReturnRefundReadPort {
  listForOrder(orderId: string): Promise<OrderReturnRefund[]>;
  /**
   * The quantity of each order line that came back, one entry per line with
   * any (issue #435), so an invoice issued after a return — when there is no
   * invoice to correct yet — lists only what the buyer kept.
   */
  listReturnedQuantities(orderId: string): Promise<OrderReturnedQuantity[]>;
  /**
   * What the order's settled `return` cases refunded of its delivery cost and
   * of its payment surcharge (issue #876), over the same cases as
   * {@link listReturnedQuantities}, so an invoice issued afterwards charges
   * only what is left of each.
   */
  listRefundedCharges(orderId: string): Promise<OrderRefundedCharges>;
}

/** What settled returns refunded of an order's charges (issue #876): two-place decimal strings, `0.00` for none. */
export interface OrderRefundedCharges {
  delivery: string;
  surcharge: string;
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

/**
 * Container name: `creditTopupPort`. Owner: `credit_limits`.
 *
 * **Owner off:** the seam fails closed — resolving this port throws
 * `ModuleDisabledError` and the call answers 503 `MODULE_DISABLED`, so nothing
 * half-executes. Whether `credit_limits` has an off state at all is its manifest's
 * `activation` to say, not this line's: a module declaring
 * `nonDeactivatable` never enters one.
 */
export interface CreditTopupPort {
  creditFromReturn(input: CreditTopupInput): Promise<CreditTopupResult>;
}

export interface OrderReturnContextLine {
  orderItemId: string;
  productId: string;
  name: string;
  purchasedQty: number;
  /** The line's stored gross over its quantity, at four places — informational. */
  paidUnitAmount: number;
  /**
   * The line's gross as the order stored it (`lineTotal`), never recomputed
   * (issue #417): what an order placed before 0.108.0 charged for the line, and
   * the line's own rounding of its gross for one placed after.
   */
  paidLineAmount: number;
  /** The line's net unit price, as stored (a two-place decimal string). */
  unitNetPrice: string;
  /** The line's VAT rate as a fraction, as stored (`0.2300`). */
  taxRate: string;
  /**
   * Feature 155 (FR-016a) — the product's returnable flag recorded when the order was placed.
   * `null`: the order was placed before the flag was recorded. `orders` reports the fact; the
   * policy for `null` (returnable, FR-025) is `returns`'.
   */
  returnableAtPurchase: boolean | null;
}

export interface OrderReturnContext {
  salesChannelId: string;
  customerAccountId: string;
  organizationId: string | null;
  currency: string;
  /** When the order entered its fulfilment-completing status; null if it has not. */
  completingStatusEnteredAt: Date | null;
  /**
   * When the order was placed (`specs/177-tax-id-scope/`, FR-040): an
   * organization converted from personal to company keeps a consumer's
   * withdrawal right for an order placed before its `convertedToCompanyAt`.
   */
  placedAt: Date;
  /**
   * The payment method the order was paid with (issue #905): a consumer's
   * withdrawal is refunded by the same means of payment unless they agree
   * otherwise, so the settlement proposes it.
   */
  paymentMethodId: string | null;
  /**
   * The VAT method the order was placed under (issue #417): `per_rate` — VAT
   * per rate on the sum of the nets — from 0.108.0; `null` before, when the
   * stored totals followed the rule of their day. Decides how a return groups
   * what was paid.
   */
  vatMethod: 'per_rate' | null;
  /**
   * What the order charged for its products, as stored: subtotal + tax total −
   * discount total (two places). The discount is taken off the gross without tax
   * of its own; delivery and the payment surcharge are not products.
   */
  productsPaidTotal: string;
  /** The order-level discount, as stored (two places) — the part of it a return carries is credited back as a discount. */
  discountTotal: string;
  /**
   * Issue #876 — the order's delivery cost, as stored (two places): a
   * consumer's withdrawal from the whole sale refunds it.
   */
  deliveryTotal: string;
  /** Issue #876 — the payment surcharge captured at placement, as stored (two places; `0.00` without one). */
  paymentSurcharge: string;
  lines: OrderReturnContextLine[];
}

/**
 * Container name: `orderReturnContextPort`. Owner: `orders`.
 *
 * The order facts a return needs — paid-per-line amounts, the
 * fulfilment-completing timestamp, channel, customer, organisation — without
 * `returns` reading the orders tables (Principle I).
 *
 * **Owner off:** the seam fails closed — resolving this port throws
 * `ModuleDisabledError` and the call answers 503 `MODULE_DISABLED`, so nothing
 * half-executes. Whether `orders` has an off state at all is its manifest's
 * `activation` to say, not this line's: a module declaring
 * `nonDeactivatable` never enters one.
 */
export interface OrderReturnContextPort {
  getReturnContext(orderId: string): Promise<OrderReturnContext | null>;
}

/**
 * What a corrective-invoice line documents (issue #885). `returned_goods`: the
 * units came back and are credited. `price_reduction`: a complaint settled with
 * money (art. 106j ust. 1 pkt 2 of the Polish VAT Act), so the buyer keeps the
 * goods and only their price is reduced.
 */
export const CORRECTION_LINE_BASES = ['returned_goods', 'price_reduction'] as const;
export type CorrectionLineBasis = (typeof CORRECTION_LINE_BASES)[number];

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
  /**
   * The part of the order-level discount `amount` carries (issue #417). The
   * invoice charged the goods in full and the discount on a 0 % line, so the
   * correction credits the goods at `amount + discount` and the discount back on
   * a 0 % line; it still totals `amount`. Absent: no discount.
   */
  discount?: number;
  /**
   * What the line documents (issue #885). `returned_goods` (the default when
   * absent): `quantity` units came back and are credited. `price_reduction`: a
   * complaint settled with money, art. 106j ust. 1 pkt 2. The buyer keeps the
   * goods, the line is credited at `amount` as gross at the line's rate, with no
   * discount (one is refused), and `quantity` (the units complained about) is not
   * credited. The document stores quantity 0.
   */
  basis?: CorrectionLineBasis;
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
  /**
   * The case's RMA number, for the label of a price-reduction line (issue #885).
   * Absent: the label names no case.
   */
  caseReference?: string;
  /**
   * Issue #876 — the order's charges this correction credits, gross: a
   * consumer's withdrawal from the whole sale refunds the delivery and the
   * payment surcharge. Each is credited at the rate of the invoice line that
   * charged it, and never above what that line still charges. `total`
   * includes them. Absent or 0: a return correction credits goods only.
   */
  charges?: { delivery?: number; surcharge?: number };
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

/**
 * Container name: `correctiveInvoicePort`. Owner: `invoices`.
 *
 * **Owner off:** the seam fails closed — resolving this port throws
 * `ModuleDisabledError` and the call answers 503 `MODULE_DISABLED`, so nothing
 * half-executes. Whether `invoices` has an off state at all is its manifest's
 * `activation` to say, not this line's: a module declaring
 * `nonDeactivatable` never enters one.
 */
export interface CorrectiveInvoicePort {
  createCorrection(input: CorrectiveInvoiceInput): Promise<CorrectiveInvoiceResult>;
  /**
   * Refuse, writing nothing, what `createCorrection` would refuse for the same
   * input (issue #417): a settlement asks before it moves any money, so a
   * correction that cannot be made never follows a refund that was made.
   */
  validateCorrection(input: CorrectiveInvoiceInput): Promise<void>;
}
