import { z } from 'zod';
import { uuidSchema } from './common.js';
import { nextActionSchema } from './orders.js';

/**
 * Quick-order contracts (feature 039). The quick-order page lets buyers
 * build a Cart or a Quote Request from a CSV / Excel file (`sku,quantity`
 * plus optional variant-attribute columns), search the catalog by SKU /
 * name / `quick_searchable` attribute, reorder a past order, manage their
 * default ordering preferences, and place a one-click order.
 *
 * The importer is lenient on whitespace + quoting; the import response is a
 * partition of the rows into recognised + rejected, with line numbers
 * preserved so the UI can highlight problem rows.
 */

// --- Shared ----------------------------------------------------------------

/**
 * Admin / sales-rep "act on behalf of" context. When present, the resulting
 * Cart / Quote Request is owned by this customer + organization and priced
 * under that organization's price list (FR-008).
 */
export const quickOrderOnBehalfSchema = z.object({
  customerAccountId: uuidSchema,
  organizationId: uuidSchema,
});
export type QuickOrderOnBehalf = z.infer<typeof quickOrderOnBehalfSchema>;

/** An uploaded file (CSV or .xlsx), sent as base64 so the API owns parsing. */
export const quickOrderUploadFileSchema = z.object({
  filename: z.string().min(1).max(255),
  contentBase64: z.string().min(1).max(20_000_000),
});
export type QuickOrderUploadFile = z.infer<typeof quickOrderUploadFileSchema>;

export const quickOrderRejectionReasonSchema = z.enum([
  'sku_missing',
  'quantity_invalid',
  'product_not_found',
  'product_archived',
  'malformed_row',
  'variant_not_resolved',
  'variant_ambiguous',
  'row_limit_exceeded',
  /** Feature 155 — the product's total across the file is below its pieces minimum (P1). */
  'below_minimum',
]);
export type QuickOrderRejectionReason = z.infer<typeof quickOrderRejectionReasonSchema>;

// --- Import (CSV / Excel → preview) ---------------------------------------

/**
 * Either `csv` (legacy back-compat path) or `file` (CSV or .xlsx upload).
 * `onBehalfOf` is honoured only on the admin endpoint.
 */
export const quickOrderImportRequestSchema = z
  .object({
    csv: z.string().min(1).max(2_000_000).optional(),
    file: quickOrderUploadFileSchema.optional(),
    onBehalfOf: quickOrderOnBehalfSchema.optional(),
  })
  .refine((v) => Boolean(v.csv) || Boolean(v.file), {
    message: 'Either csv or file must be provided.',
  });
export type QuickOrderImportRequest = z.infer<typeof quickOrderImportRequestSchema>;

export const recognizedQuickOrderItemSchema = z.object({
  line: z.number().int().positive(),
  sku: z.string().min(1).max(255),
  productId: uuidSchema,
  variantId: uuidSchema.nullable(),
  /** Resolved variant SKU when a variant was matched from attribute columns. */
  resolvedVariantSku: z.string().max(255).nullable().optional(),
  quantity: z.number().int().positive(),
  /** Other source lines merged into this one (duplicate SKU, summed qty). */
  mergedFromLines: z.array(z.number().int().positive()).optional(),
  /**
   * Feature 155 — operator's import only: the product's file total is below its pieces
   * minimum. The row stays recognised; the build judges it.
   */
  warning: z
    .object({
      reason: z.literal('below_minimum'),
      minimum: z.number().int().positive(),
      productTotal: z.number().int().nonnegative(),
    })
    .optional(),
});
export type RecognizedQuickOrderItem = z.infer<typeof recognizedQuickOrderItemSchema>;

export const rejectedQuickOrderItemSchema = z.object({
  line: z.number().int().positive(),
  raw: z.string(),
  reason: quickOrderRejectionReasonSchema,
  /** Feature 155 — on `below_minimum`: the product's pieces minimum. */
  minimum: z.number().int().positive().optional(),
  /** Feature 155 — on `below_minimum`: the file total the verdict used. */
  productTotal: z.number().int().nonnegative().optional(),
});
export type RejectedQuickOrderItem = z.infer<typeof rejectedQuickOrderItemSchema>;

export const quickOrderImportSummarySchema = z.object({
  recognizedCount: z.number().int().nonnegative(),
  rejectedCount: z.number().int().nonnegative(),
  mergedCount: z.number().int().nonnegative(),
  truncated: z.boolean(),
  /** Feature 155 — operator's import only: recognised rows carrying a `warning`. */
  warningCount: z.number().int().nonnegative().optional(),
});
export type QuickOrderImportSummary = z.infer<typeof quickOrderImportSummarySchema>;

export const quickOrderImportResponseSchema = z.object({
  recognized: z.array(recognizedQuickOrderItemSchema),
  rejected: z.array(rejectedQuickOrderItemSchema),
  summary: quickOrderImportSummarySchema,
});
export type QuickOrderImportResponse = z.infer<typeof quickOrderImportResponseSchema>;

// --- Build (confirmed import → Cart or Quote Request) ----------------------

export const quickOrderTargetSchema = z.enum(['cart', 'quote_request']);
export type QuickOrderTarget = z.infer<typeof quickOrderTargetSchema>;

export const quickOrderBuildLineSchema = z.object({
  productId: uuidSchema,
  variantId: uuidSchema.nullable().optional(),
  quantity: z.number().int().positive(),
});
export type QuickOrderBuildLine = z.infer<typeof quickOrderBuildLineSchema>;

/**
 * Feature 155 (FR-038, research R20) — the most items a build accepts, either target.
 * Enforced by `QuickOrderBuildService.build` as its first step (`422 VALIDATION_FAILED`,
 * `details: { code: 'too_many_items', maximum }`), deliberately not by a schema `.max()`,
 * which would answer 400.
 */
export const QUICK_ORDER_BUILD_MAX_ITEMS = 200;

export const quickOrderBuildRequestSchema = z.object({
  target: quickOrderTargetSchema,
  items: z.array(quickOrderBuildLineSchema).min(1),
  onBehalfOf: quickOrderOnBehalfSchema.optional(),
});
export type QuickOrderBuildRequest = z.infer<typeof quickOrderBuildRequestSchema>;

export const quickOrderBuildResponseSchema = z.object({
  target: quickOrderTargetSchema,
  cartId: uuidSchema.optional(),
  checkoutUrl: z.string().optional(),
  quoteRequestId: uuidSchema.optional(),
  /** Customer-facing business Quote Request ID (shown in confirmations). */
  quoteRequestBusinessId: z.string().optional(),
  /**
   * Feature 155 — target `cart`: the lines not added because they would leave their
   * product below a minimum (R8). Always present for target `cart`; absent otherwise.
   */
  rejected: z
    .array(
      z.object({
        productId: uuidSchema,
        variantId: uuidSchema.nullable(),
        quantity: z.number().int().positive(),
        productName: z.string(),
        reason: z.literal('below_minimum'),
        kind: z.enum(['pieces', 'packaging_unit']),
        minimum: z.number().int().positive(),
        /** Feature 155 — on a `packaging_unit` refusal: the unit's name, so the report can say which. */
        packagingUnitName: z.string().optional(),
      }),
    )
    .optional(),
});
export type QuickOrderBuildResponse = z.infer<typeof quickOrderBuildResponseSchema>;

// --- Quick search ----------------------------------------------------------

/** Type-ahead search for SKU / name / quick_searchable attributes. */
export const quickOrderSearchQuerySchema = z.object({
  q: z.string().min(1).max(120),
  limit: z.coerce.number().int().positive().max(50).default(20),
});
export type QuickOrderSearchQuery = z.infer<typeof quickOrderSearchQuerySchema>;

export const quickOrderSearchMatchSchema = z.enum(['sku', 'name', 'attribute']);
export type QuickOrderSearchMatch = z.infer<typeof quickOrderSearchMatchSchema>;

export const quickOrderSearchResultSchema = z.object({
  productId: uuidSchema,
  sku: z.string(),
  name: z.string(),
  slug: z.string(),
  status: z.enum(['active', 'inactive']),
  matchedOn: z.array(quickOrderSearchMatchSchema).optional(),
});
export type QuickOrderSearchResult = z.infer<typeof quickOrderSearchResultSchema>;

// --- Default ordering preferences -----------------------------------------

export const quickOrderPreferenceScopeSchema = z.enum(['organization', 'customer']);
export type QuickOrderPreferenceScope = z.infer<typeof quickOrderPreferenceScopeSchema>;

/**
 * Upsert a scope's defaults. Each field: omitted = leave unchanged;
 * explicit `null` = clear. Authorization is enforced per FR-018.
 */
export const quickOrderPreferenceUpsertSchema = z.object({
  scope: quickOrderPreferenceScopeSchema,
  scopeId: uuidSchema,
  defaultPaymentMethodId: uuidSchema.nullable().optional(),
  defaultDeliveryMethodId: uuidSchema.nullable().optional(),
  defaultBillingAddressId: uuidSchema.nullable().optional(),
  defaultShippingAddressId: uuidSchema.nullable().optional(),
});
export type QuickOrderPreferenceUpsert = z.infer<typeof quickOrderPreferenceUpsertSchema>;

/** Raw stored row for a scope (null fields = unset). */
export const quickOrderPreferenceSchema = z.object({
  scope: quickOrderPreferenceScopeSchema,
  scopeId: uuidSchema,
  defaultPaymentMethodId: uuidSchema.nullable(),
  defaultDeliveryMethodId: uuidSchema.nullable(),
  defaultBillingAddressId: uuidSchema.nullable(),
  defaultShippingAddressId: uuidSchema.nullable(),
});
export type QuickOrderPreference = z.infer<typeof quickOrderPreferenceSchema>;

const preferenceSourceSchema = z.enum(['customer', 'organization']).nullable();

/** Effective defaults for a customer after inheritance + eligibility check. */
export const quickOrderResolvedDefaultsSchema = z.object({
  paymentMethodId: uuidSchema.nullable(),
  deliveryMethodId: uuidSchema.nullable(),
  billingAddressId: uuidSchema.nullable(),
  shippingAddressId: uuidSchema.nullable(),
  source: z.object({
    payment: preferenceSourceSchema,
    delivery: preferenceSourceSchema,
    billing: preferenceSourceSchema,
    shipping: preferenceSourceSchema,
  }),
});
export type QuickOrderResolvedDefaults = z.infer<typeof quickOrderResolvedDefaultsSchema>;

// --- One-click buy ---------------------------------------------------------

/**
 * Why one-click buy is not offered. `permission_required` and
 * `cart_approval_required` (`specs/170-organization-roles/`, FR-050, R-6) are
 * the member's role — no `quick_order.one_click`, or no
 * `carts.order_without_approval` — and are judged first, in that order, before
 * the setting and the defaults.
 */
export const quickOrderOneClickEligibilitySchema = z.object({
  enabled: z.boolean(),
  reason: z
    .enum([
      'permission_required',
      'cart_approval_required',
      'setting_disabled',
      'missing_defaults',
      'ineligible_default',
    ])
    .nullable()
    .optional(),
});
export type QuickOrderOneClickEligibility = z.infer<typeof quickOrderOneClickEligibilitySchema>;

export const quickOrderOneClickRequestSchema = z.object({
  productId: uuidSchema,
  variantId: uuidSchema.nullable().optional(),
  quantity: z.number().int().positive().optional(),
  idempotencyKey: z.string().max(200).optional(),
});
export type QuickOrderOneClickRequest = z.infer<typeof quickOrderOneClickRequestSchema>;

export const quickOrderOneClickResponseSchema = z.object({
  order: z.object({
    id: uuidSchema,
    businessId: z.string(),
    status: z.string(),
    total: z.number().finite().nonnegative(),
    currency: z.string().length(3),
  }),
  nextAction: nextActionSchema.nullable(),
});
export type QuickOrderOneClickResponse = z.infer<typeof quickOrderOneClickResponseSchema>;

// ---------------------------------------------------------------------------
// --- ports -----------------------------------------------------------------
//
// The in-process surface `quick_order` publishes (feature 075, Phase P). One
// cross-module consumer: `customers` renders and edits a buyer's one-click
// defaults from its own customer-detail screen, so the surface and the table
// sit in different modules by design.
// ---------------------------------------------------------------------------

/** Who is writing a preference, for the audit entry. */
export interface PreferenceAuditContext {
  actorAdminUserId?: string | null;
  customerAccountId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

/**
 * Who is writing the preference.
 *
 * A discriminated union, not a bag of optional ids, and that is the point: a
 * buyer editing their own defaults, an Organization administrator editing a member's, a
 * salesperson editing an assigned organisation's and a platform admin editing
 * anybody's are four different authorisations, and each carries exactly the
 * one identifier its rule needs. A shape with four optional fields has twelve
 * states the rules cannot answer for.
 *
 * The authorisation itself stays on this module's side of the port.
 */
export type PreferenceActor =
  | { kind: 'customer'; customerAccountId: string }
  /**
   * A member holding the Organization's *Administrator* role — a buyer, not
   * the operator's `platform_admin`. Managing others' defaults is a reserved
   * capability, not a permission (`specs/170-organization-roles/` FR-012),
   * asked of `organizationPermissionPort.isAdministrator`.
   */
  | { kind: 'administrator'; organizationId: string }
  | { kind: 'salesperson'; assignedOrganizationIds: string[] }
  | { kind: 'platform_admin' };

/**
 * Container name: `defaultPreferencePort`. Owner: `quick_order`.
 *
 * `resolveForCustomer` answers with the defaults **already resolved** —
 * falling back through the buyer's saved addresses and the platform's methods
 * — rather than the stored row, because the fallback chain is this module's
 * and a caller reproducing it would reproduce it differently.
 *
 * **Owner off:** the seam fails closed — resolving this port throws
 * `ModuleDisabledError` and the call answers 503 `MODULE_DISABLED`, so nothing
 * half-executes. Whether `quick_order` has an off state at all is its manifest's
 * `activation` to say, not this line's: a module declaring
 * `nonDeactivatable` never enters one.
 */
export interface DefaultPreferencePort {
  resolveForCustomer(customerAccountId: string): Promise<QuickOrderResolvedDefaults>;
  upsert(
    actor: PreferenceActor,
    input: QuickOrderPreferenceUpsert,
    audit: PreferenceAuditContext,
  ): Promise<QuickOrderPreference>;
}
