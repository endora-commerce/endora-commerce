import { z } from 'zod';
import {
  addressSnapshotSchema,
  isoDateTimeSchema,
  multilingualStringSchema,
  paymentStatusSchema,
  uuidSchema,
} from './common.js';

/**
 * Orders module contracts — Source of truth per Principle V.
 * See specs/001-b2b-platform-foundation/contracts/orders.contract.md.
 */

/**
 * Configurable order status code (feature 038). Was a fixed enum
 * (`orderStatusSchema`); with the data-driven lifecycle the authoritative
 * status is a code validated in-service against the configured `order_statuses`
 * set.
 */
export const orderStatusCodeSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/, 'status code must be snake_case')
  .max(64);

// --- Resource types --------------------------------------------------------

export const orderItemSchema = z.object({
  id: uuidSchema,
  productId: uuidSchema,
  productSnapshot: z.object({
    sku: z.string(),
    name: z.string(),
    primaryAssetUrl: z.string().url().nullable(),
  }),
  variantId: uuidSchema.nullable(),
  variantSnapshot: z
    .object({
      sku: z.string(),
      label: z.string(),
    })
    .nullable(),
  quantity: z.number().int().positive(),
  unitPrice: z.number().finite().nonnegative(),
  taxRate: z.number().finite().nonnegative(),
  lineTotal: z.number().finite().nonnegative(),
});
export type OrderItem = z.infer<typeof orderItemSchema>;

export const nextActionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('redirect_to_gateway'),
    url: z.string().url(),
    expiresAt: isoDateTimeSchema,
  }),
  z.object({
    kind: z.literal('awaiting_transfer'),
    accountDetails: z.object({
      accountNumber: z.string(),
      accountHolder: z.string(),
      bankName: z.string(),
      amount: z.number().finite(),
      currency: z.string().length(3),
      reference: z.string(),
    }),
  }),
  z.object({
    kind: z.literal('none'),
  }),
]);
export type NextAction = z.infer<typeof nextActionSchema>;

export const orderSchema = z.object({
  id: uuidSchema,
  /**
   * Customer-facing business Order ID (feature 036). Distinct from the
   * database `id` (UUID): `${prefix}${sequence}${suffix}`, where prefix/suffix
   * come from the `orders.business_id.*` settings. This is the identifier
   * shown to the Customer; `id` stays internal.
   */
  businessId: z.string(),
  organizationId: uuidSchema,
  placedByCustomerAccountId: uuidSchema,
  placedOnBehalfByAdminUserId: uuidSchema.nullable(),
  salesChannelId: uuidSchema,
  status: orderStatusCodeSchema,
  /** Localized status labels; resolve statusName[language] → statusDefaultName → status. */
  statusName: multilingualStringSchema.optional(),
  statusDefaultName: z.string().optional(),
  paymentStatus: paymentStatusSchema,
  deliveryAddress: addressSnapshotSchema,
  billingAddress: addressSnapshotSchema,
  deliveryPoint: z
    .object({
      provider: z.string(),
      pointId: z.string(),
      label: z.string().nullable().optional(),
      address: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  deliveryMethod: z.object({
    id: uuidSchema,
    code: z.string(),
    name: z.string(),
    cost: z.number().finite().nonnegative(),
  }),
  paymentMethod: z.object({
    id: uuidSchema,
    code: z.string(),
    name: z.string(),
    kind: z.enum(['bank_transfer', 'pickup', 'credit_limit', 'gateway']),
  }),
  sourceQuoteRequestId: uuidSchema.nullable(),
  items: z.array(orderItemSchema),
  subtotal: z.number().finite().nonnegative(),
  taxTotal: z.number().finite().nonnegative(),
  discountTotal: z.number().finite().nonnegative(),
  /** Feature 045 (US2) — per-promotion discount breakdown. */
  appliedPromotions: z
    .array(
      z.object({
        promotionId: uuidSchema,
        couponId: uuidSchema.nullable(),
        amount: z.number().finite().nonnegative(),
        currency: z.string().length(3),
      }),
    )
    .default([]),
  deliveryTotal: z.number().finite().nonnegative(),
  total: z.number().finite().nonnegative(),
  currency: z.string().length(3),
  placedAt: isoDateTimeSchema,
  customerNote: z.string().nullable(),
  nextAction: nextActionSchema.nullable(),
  /**
   * Whether the buyer reading this order may cancel it (feature 085, FR-018).
   *
   * A **capability computed by the platform**, not a fact about the order: it
   * combines the money axis, the configured status graph and the payment
   * method's configured failure status, and it is scoped to the account asking
   * — an Organization colleague may read a peer's order and never cancel it.
   * The storefront renders its control on this value alone and re-derives
   * nothing, because two of the three inputs are configuration the storefront
   * does not have and must not be given.
   *
   * Present on the buyer-facing order reads (`GET /api/v1/orders`,
   * `GET /api/v1/orders/:id` and the placement reply). Absent on the admin
   * reads, where an administrator's power to cancel carries no payment-state
   * condition at all (FR-017), so a per-order capability there would describe a
   * narrowing that does not exist.
   */
  customerCancellable: z.boolean().optional(),
});
export type Order = z.infer<typeof orderSchema>;

// --- Requests --------------------------------------------------------------

export const placeOrderRequestSchema = z.object({
  deliveryAddressId: uuidSchema,
  billingAddressId: uuidSchema,
  deliveryMethodId: uuidSchema,
  paymentMethodId: uuidSchema,
  salesChannelId: uuidSchema.optional(),
  promotionCode: z.string().optional(),
  customerNote: z.string().max(4000).optional(),
  idempotencyKey: z.string().optional(),
  /**
   * Optional billing-company override. When provided (non-empty), it
   * replaces the Organization name on the order's billing snapshot; otherwise
   * the snapshot defaults to the Organization's legal/display name.
   */
  billingCompanyName: z.string().max(255).optional(),
  /**
   * Optional billing tax-id (NIP) override. When provided (non-empty), it
   * replaces the Organization tax-id on the order's billing snapshot;
   * otherwise the snapshot defaults to the Organization's tax-id.
   */
  billingTaxId: z.string().max(32).optional(),
  /**
   * Optional pickup-point metadata selected at checkout. Provider-agnostic,
   * so any carrier adapter can read one normalized snapshot from the order.
   */
  deliveryPoint: z
    .object({
      provider: z.string().min(1),
      pointId: z.string().min(1),
      label: z.string().max(255).optional(),
      address: z.string().max(500).optional(),
    })
    .optional(),
});
export type PlaceOrderRequest = z.infer<typeof placeOrderRequestSchema>;

/**
 * Read-only order-total preview for the active cart with a chosen delivery +
 * payment method (feature 049). Computes the exact total server-side — including
 * per-product VAT, delivery cost, payment surcharge, and promotion discount —
 * so the storefront never re-derives pricing on the client. `billingAddressId`
 * refines the tax country to match placement; omit ⇒ the organization's country.
 */
export const orderPreviewTotalRequestSchema = z.object({
  deliveryMethodId: uuidSchema,
  paymentMethodId: uuidSchema,
  billingAddressId: uuidSchema.optional(),
});
export type OrderPreviewTotalRequest = z.infer<typeof orderPreviewTotalRequestSchema>;

export const orderPreviewTotalResponseSchema = z.object({
  subtotal: z.number(),
  taxTotal: z.number(),
  deliveryTotal: z.number(),
  paymentSurcharge: z.number(),
  discountTotal: z.number(),
  total: z.number(),
  currency: z.string(),
});
export type OrderPreviewTotalResponse = z.infer<typeof orderPreviewTotalResponseSchema>;

export const adminOrderStatusTransitionSchema = z.object({
  to: orderStatusCodeSchema,
  reason: z.string().optional(),
});

export const adminOrderPaymentStatusTransitionSchema = z.object({
  to: z.enum(['paid', 'refunded']),
  reason: z.string().optional(),
  invoiceId: uuidSchema.optional(),
});

export const adminOrderRefundRequestSchema = z.object({
  amount: z.number().finite().positive().optional(),
});

export const adminOrderShippedRequestSchema = z.object({
  trackingNumber: z.string(),
  carrierCode: z.string(),
  shippedAt: isoDateTimeSchema,
});

// ===========================================================================
// Feature 038 — Orders module (configurable lifecycle + admin operations)
// ===========================================================================

// --- Status configuration --------------------------------------------------

/**
 * Status badge colour — an arbitrary `#rrggbb` hex value. The admin colour
 * picker offers a curated preset palette plus a free custom colour. The default
 * is a neutral slate, matching the legacy uncoloured look.
 */
export const ORDER_STATUS_DEFAULT_COLOR = '#64748b';
/** Curated preset palette surfaced by the admin colour picker. */
export const ORDER_STATUS_COLOR_PRESETS = [
  '#64748b', // slate (neutral)
  '#3b82f6', // blue
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // purple
] as const;
export const orderStatusColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Colour must be a #rrggbb hex value');
export type OrderStatusColor = z.infer<typeof orderStatusColorSchema>;

export const orderStatusDefSchema = z.object({
  code: orderStatusCodeSchema,
  name: multilingualStringSchema,
  /** Language-independent fallback used when the active language is missing from `name`. */
  defaultName: z.string(),
  isInitial: z.boolean(),
  isTerminal: z.boolean(),
  isSystem: z.boolean(),
  weight: z.number().int(),
  /** Badge colour for this status (defaults to `neutral`). */
  color: orderStatusColorSchema,
  /** # of orders currently in this status — drives the delete-guard UI. */
  inUseCount: z.number().int().nonnegative(),
});
export type OrderStatusDefDto = z.infer<typeof orderStatusDefSchema>;

export const orderStatusTransitionDtoSchema = z.object({
  fromStatusCode: orderStatusCodeSchema,
  toStatusCode: orderStatusCodeSchema,
  isSystem: z.boolean(),
});
export type OrderStatusTransitionDto = z.infer<typeof orderStatusTransitionDtoSchema>;

export const orderStatusGraphResponseSchema = z.object({
  statuses: z.array(orderStatusDefSchema),
  transitions: z.array(orderStatusTransitionDtoSchema),
});
export type OrderStatusGraphResponse = z.infer<typeof orderStatusGraphResponseSchema>;

export const createOrderStatusRequestSchema = z.object({
  code: orderStatusCodeSchema,
  name: multilingualStringSchema,
  defaultName: z.string().min(1),
  isTerminal: z.boolean().optional(),
  weight: z.number().int().optional(),
  color: orderStatusColorSchema.optional(),
});
export type CreateOrderStatusRequest = z.infer<typeof createOrderStatusRequestSchema>;

export const updateOrderStatusRequestSchema = z.object({
  name: multilingualStringSchema.optional(),
  defaultName: z.string().min(1).optional(),
  isTerminal: z.boolean().optional(),
  weight: z.number().int().optional(),
  color: orderStatusColorSchema.optional(),
});
export type UpdateOrderStatusRequest = z.infer<typeof updateOrderStatusRequestSchema>;

export const setOrderTransitionsRequestSchema = z.object({
  add: z.array(z.object({ fromStatusCode: orderStatusCodeSchema, toStatusCode: orderStatusCodeSchema })).optional(),
  remove: z.array(z.object({ fromStatusCode: orderStatusCodeSchema, toStatusCode: orderStatusCodeSchema })).optional(),
});
export type SetOrderTransitionsRequest = z.infer<typeof setOrderTransitionsRequestSchema>;

// --- Admin orders list / search / bulk / export ----------------------------

/**
 * Query-string list params arrive as a single value (`?k=a`) or repeated
 * (`?k=a&k=b`). Normalise both to a `T[]` so the multiselect filters always
 * see an array. Empty / absent ⇒ `undefined`.
 */
function multiQueryParam<T extends z.ZodTypeAny>(schema: T) {
  return z
    .union([schema, z.array(schema)])
    .optional()
    .transform((v): z.output<T>[] | undefined =>
      v === undefined ? undefined : Array.isArray(v) ? v : [v],
    );
}

export const adminOrdersListQuerySchema = z.object({
  // Multi-select filters (accept repeated query params).
  status: multiQueryParam(orderStatusCodeSchema),
  /**
   * The money axis (feature 085, FR-021).
   *
   * The list could filter on eight things and none of them was payment status,
   * so "which orders have a failed payment?" was a question the orders screen
   * could not answer — and after this feature a platform administrator is the
   * only actor who can rescue a held order whose buyer cannot.
   *
   * Validated against `paymentStatusSchema` rather than a free string: unlike
   * the lifecycle status, the money axis is a fixed vocabulary and not an
   * operator-configurable table.
   */
  paymentStatus: multiQueryParam(paymentStatusSchema),
  salesChannelId: multiQueryParam(uuidSchema),
  paymentMethodId: multiQueryParam(uuidSchema),
  deliveryMethodId: multiQueryParam(uuidSchema),
  organizationId: uuidSchema.optional(),
  q: z.string().max(200).optional(),
  // Dedicated org / customer name filters (free-text, AND-combined with `q`).
  orgName: z.string().max(200).optional(),
  customerName: z.string().max(200).optional(),
  placedFrom: isoDateTimeSchema.optional(),
  placedTo: isoDateTimeSchema.optional(),
  // Order-total range (inclusive).
  totalMin: z.coerce.number().nonnegative().optional(),
  totalMax: z.coerce.number().nonnegative().optional(),
  sort: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(25),
});
export type AdminOrdersListQuery = z.infer<typeof adminOrdersListQuerySchema>;

export const adminOrderRowSchema = z.object({
  id: uuidSchema,
  businessId: z.string(),
  customerName: z.string().nullable(),
  organizationId: uuidSchema,
  organizationName: z.string().nullable(),
  status: orderStatusCodeSchema,
  statusName: multilingualStringSchema,
  paymentStatus: paymentStatusSchema,
  total: z.number().finite().nonnegative(),
  currency: z.string().length(3),
  placedAt: isoDateTimeSchema,
  createdAt: isoDateTimeSchema,
  salesChannelId: uuidSchema,
  salesChannelName: z.string().nullable(),
  deliveryMethodName: z.string().nullable(),
  paymentMethodName: z.string().nullable(),
  shipToName: z.string().nullable(),
  billToName: z.string().nullable(),
});
export type AdminOrderRow = z.infer<typeof adminOrderRowSchema>;

export const adminOrdersListResponseSchema = z.object({
  data: z.array(adminOrderRowSchema),
  pagination: z.object({
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    total: z.number().int().nonnegative(),
  }),
  /** Per **lifecycle status** counts, keyed by status code. */
  counts: z.record(z.string(), z.number().int().nonnegative()).optional(),
  /**
   * Per **payment status** counts, keyed by payment status (feature 085,
   * FR-021).
   *
   * A second map rather than more keys in `counts`, because one map cannot
   * carry both axes: `paid` is a shipped *order* status code **and** a payment
   * status, so a merged map would silently add two different populations
   * together under one key — and an operator may name a custom order status
   * anything, including `failed` or `refunded`.
   *
   * Each axis's counts are computed over every other filter but its own, which
   * is what makes an option's number mean "this is what selecting it would
   * yield". That is the semantics `counts` already had for the status
   * multi-select; this map extends it symmetrically, and with no payment-status
   * filter applied `counts` is exactly what it was before.
   */
  paymentStatusCounts: z.record(z.string(), z.number().int().nonnegative()).optional(),
});
export type AdminOrdersListResponse = z.infer<typeof adminOrdersListResponseSchema>;

export const bulkOrderStatusRequestSchema = z.object({
  orderIds: z.array(uuidSchema).min(1),
  toStatusCode: orderStatusCodeSchema,
  reason: z.string().max(2000).optional(),
});
export type BulkOrderStatusRequest = z.infer<typeof bulkOrderStatusRequestSchema>;

export const bulkOrderStatusResponseSchema = z.object({
  changed: z.array(uuidSchema),
  skipped: z.array(
    z.object({
      orderId: uuidSchema,
      reason: z.enum(['invalid_transition', 'terminal', 'not_found']),
    }),
  ),
});
export type BulkOrderStatusResponse = z.infer<typeof bulkOrderStatusResponseSchema>;

export const bulkPrintInvoicesRequestSchema = z.object({
  orderIds: z.array(uuidSchema).min(1),
});
export type BulkPrintInvoicesRequest = z.infer<typeof bulkPrintInvoicesRequestSchema>;

// --- Saved list views ------------------------------------------------------

export const orderSavedViewSortSchema = z.object({
  field: z.string(),
  dir: z.enum(['asc', 'desc']),
});

export const orderSavedViewSchema = z.object({
  id: uuidSchema,
  name: z.string().min(1).max(160),
  shared: z.boolean(),
  ownerAdminUserId: uuidSchema,
  filters: z.record(z.string(), z.unknown()),
  sort: orderSavedViewSortSchema,
  /** Column-picker selection. `null` ⇒ fall back to the default-visible set. */
  visibleColumns: z.array(z.string()).nullable().optional(),
});
export type OrderSavedView = z.infer<typeof orderSavedViewSchema>;

export const createOrderSavedViewRequestSchema = z.object({
  name: z.string().min(1).max(160),
  shared: z.boolean(),
  filters: z.record(z.string(), z.unknown()),
  sort: orderSavedViewSortSchema,
  visibleColumns: z.array(z.string()).nullable().optional(),
});
export type CreateOrderSavedViewRequest = z.infer<typeof createOrderSavedViewRequestSchema>;

export const updateOrderSavedViewRequestSchema = createOrderSavedViewRequestSchema.partial();
export type UpdateOrderSavedViewRequest = z.infer<typeof updateOrderSavedViewRequestSchema>;

// --- Admin create order on behalf of a customer ----------------------------

export const adminCreateOrderItemSchema = z.object({
  productId: uuidSchema,
  variantId: uuidSchema.optional(),
  quantity: z.number().int().positive(),
});

/**
 * A brand-new address typed inline on the admin create-order form, instead of
 * picking an existing one from the customer's organization address book. The
 * address is always snapshotted onto the order; `saveToAddressBook` controls
 * whether it is also persisted to the org book for reuse (false = one-time).
 */
export const adminCreateOrderInlineAddressSchema = z.object({
  recipientName: z.string().min(1).max(160),
  street: z.string().min(1).max(255),
  city: z.string().min(1).max(120),
  postalCode: z.string().min(1).max(20),
  country: z.string().length(2),
  phone: z.string().max(32).optional(),
  saveToAddressBook: z.boolean(),
});
export type AdminCreateOrderInlineAddress = z.infer<typeof adminCreateOrderInlineAddressSchema>;

export const adminCreateOrderRequestSchema = z
  .object({
    customerAccountId: uuidSchema,
    salesChannelId: uuidSchema,
    items: z.array(adminCreateOrderItemSchema).min(1),
    deliveryMethodId: uuidSchema,
    paymentMethodId: uuidSchema,
    /**
     * Per address side, supply EITHER an existing org address id OR an inline
     * new address — exactly one of each pair (enforced below). The id path is
     * the original US3 behavior; the inline path is the create-new-address flow.
     */
    deliveryAddressId: uuidSchema.optional(),
    billingAddressId: uuidSchema.optional(),
    deliveryAddress: adminCreateOrderInlineAddressSchema.optional(),
    billingAddress: adminCreateOrderInlineAddressSchema.optional(),
    customerNote: z.string().max(4000).optional(),
    comment: z
      .object({
        body: z.string().min(1).max(8000),
        isCustomerVisible: z.boolean(),
        notifyCustomer: z.boolean(),
      })
      .optional(),
  })
  .superRefine((val, ctx) => {
    if ((val.deliveryAddressId == null) === (val.deliveryAddress == null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['deliveryAddressId'],
        message: 'Provide exactly one of deliveryAddressId or deliveryAddress.',
      });
    }
    if ((val.billingAddressId == null) === (val.billingAddress == null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['billingAddressId'],
        message: 'Provide exactly one of billingAddressId or billingAddress.',
      });
    }
  });
export type AdminCreateOrderRequest = z.infer<typeof adminCreateOrderRequestSchema>;

// --- External order intake (feature 062, contracts/orders-api-key-intake.md) ---

/**
 * Inline address for the external order-intake body — the admin-create
 * pattern: per side, the caller supplies EITHER an existing org address id OR
 * an inline address. `saveToAddressBook` defaults to a one-time address (the
 * org book stays clean; the order keeps its own snapshot).
 */
export const apiInlineAddressSchema = z.object({
  recipientName: z.string().min(1).max(160),
  street: z.string().min(1).max(255),
  city: z.string().min(1).max(120),
  postalCode: z.string().min(1).max(20),
  country: z.string().length(2),
  phone: z.string().max(32).optional(),
  saveToAddressBook: z.boolean().default(false),
});
export type ApiInlineAddress = z.infer<typeof apiInlineAddressSchema>;

/**
 * `POST /api/v1/external/orders` body (bound API keys only). Line items are
 * addressed by SKU + quantity; the response reuses the existing serialized
 * order envelope — no bespoke partner DTO.
 */
export const apiPlaceOrderRequestSchema = z
  .object({
    lines: z
      .array(
        z.object({
          sku: z.string().min(1),
          quantity: z.number().int().min(1),
        }),
      )
      .min(1),
    deliveryMethodId: uuidSchema,
    paymentMethodId: uuidSchema,
    deliveryAddressId: uuidSchema.optional(),
    billingAddressId: uuidSchema.optional(),
    deliveryAddress: apiInlineAddressSchema.optional(),
    billingAddress: apiInlineAddressSchema.optional(),
    /** Partner's own order number → persisted as the order `customerNote`. */
    customerReference: z.string().max(160).optional(),
  })
  .superRefine((val, ctx) => {
    if ((val.deliveryAddressId == null) === (val.deliveryAddress == null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['deliveryAddressId'],
        message: 'Provide exactly one of deliveryAddressId or deliveryAddress.',
      });
    }
    if ((val.billingAddressId == null) === (val.billingAddress == null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['billingAddressId'],
        message: 'Provide exactly one of billingAddressId or billingAddress.',
      });
    }
  });
export type ApiPlaceOrderRequest = z.infer<typeof apiPlaceOrderRequestSchema>;

// --- Admin order pricing preview (live summary on the create form) ---------

export const adminOrderPreviewRequestSchema = z.object({
  customerAccountId: uuidSchema,
  salesChannelId: uuidSchema,
  items: z.array(adminCreateOrderItemSchema).min(1),
  deliveryMethodId: uuidSchema.optional(),
  paymentMethodId: uuidSchema.optional(),
});
export type AdminOrderPreviewRequest = z.infer<typeof adminOrderPreviewRequestSchema>;

export const adminOrderPreviewLineSchema = z.object({
  productId: uuidSchema,
  variantId: z.string().nullable().optional(),
  quantity: z.number().int().positive(),
  unitPrice: z.string(),
  currency: z.string(),
  lineTotal: z.number(),
  unavailable: z.boolean().optional(),
});

export const adminOrderPreviewResponseSchema = z.object({
  lines: z.array(adminOrderPreviewLineSchema),
  summary: z.object({
    subtotal: z.number(),
    taxTotal: z.number(),
    deliveryTotal: z.number(),
    paymentSurcharge: z.number(),
    discountTotal: z.number(),
    total: z.number(),
    currency: z.string(),
  }),
  messages: z.array(z.object({ productId: uuidSchema, code: z.string() })),
});
export type AdminOrderPreviewResponse = z.infer<typeof adminOrderPreviewResponseSchema>;

// --- Comments --------------------------------------------------------------

export const orderCommentSchema = z.object({
  id: uuidSchema,
  orderId: uuidSchema,
  authorAdminUserId: uuidSchema.nullable(),
  authorCustomerAccountId: uuidSchema.nullable(),
  body: z.string(),
  isCustomerVisible: z.boolean(),
  notifyCustomer: z.boolean(),
  createdAt: isoDateTimeSchema,
});
export type OrderComment = z.infer<typeof orderCommentSchema>;

export const adminAddOrderCommentRequestSchema = z.object({
  body: z.string().min(1).max(8000),
  isCustomerVisible: z.boolean(),
  notifyCustomer: z.boolean(),
});
export type AdminAddOrderCommentRequest = z.infer<typeof adminAddOrderCommentRequestSchema>;

export const customerAddOrderCommentRequestSchema = z.object({
  body: z.string().min(1).max(8000),
});
export type CustomerAddOrderCommentRequest = z.infer<typeof customerAddOrderCommentRequestSchema>;

// --- Reorder & clone-to-quote ----------------------------------------------

export const reorderUnavailableItemSchema = z.object({
  productId: uuidSchema,
  variantId: uuidSchema.nullable().optional(),
  reason: z.enum(['discontinued', 'out_of_catalog_scope', 'out_of_stock', 'no_price']),
});

export const customerReorderResponseSchema = z.object({
  cartId: uuidSchema,
  checkoutUrl: z.string(),
  unavailableItems: z.array(reorderUnavailableItemSchema),
});
export type CustomerReorderResponse = z.infer<typeof customerReorderResponseSchema>;

export const adminReorderResponseSchema = z.object({
  newOrderId: uuidSchema.optional(),
  cartId: uuidSchema.optional(),
  unavailableItems: z.array(reorderUnavailableItemSchema),
});
export type AdminReorderResponse = z.infer<typeof adminReorderResponseSchema>;

export const cloneOrderToQuoteResponseSchema = z.object({
  quoteRequestId: uuidSchema,
});
export type CloneOrderToQuoteResponse = z.infer<typeof cloneOrderToQuoteResponseSchema>;

// ---------------------------------------------------------------------------
// --- ports -----------------------------------------------------------------
//
// The in-process surface `orders` publishes to the eleven modules that read it
// (feature 075, Phase P). Plain TypeScript, not Zod: these describe in-process
// calls, not an API boundary.
// ---------------------------------------------------------------------------

/**
 * The two lifecycle statuses that are **not** admin-configurable, materialised
 * with universal edges at seed time (feature 038, data-model.md §2), plus the
 * initial one.
 *
 * Published as **constants, not a port** (FR-013): switching `orders` off does
 * not change the spelling of `'on_hold'`, and a gated port answering 503 to
 * "what is the on-hold status code" would be a bug. `payments` compares against
 * the first of them when a gateway reports a partial capture.
 */
export const ORDER_STATUS_ON_HOLD = 'on_hold';
export const ORDER_STATUS_CANCELLED = 'cancelled';
export const ORDER_STATUS_INITIAL = 'new';

/**
 * The money axis of an order.
 *
 * `failed` is set by the settlement ingress when a gateway declines a payment
 * (feature 085, FR-001). The wire vocabulary — `paymentStatusSchema` in
 * `common.ts` — has carried the value since feature 034, so nothing on the wire
 * changes here; what changed is that the platform can now produce it. It is
 * **system-written only**: `adminOrderPaymentStatusTransitionSchema` accepts
 * `paid` and `refunded` and nothing else, so an operator can see a failed
 * payment but never set one.
 */
export type OrderPaymentStatus =
  | 'awaiting_payment'
  | 'paid'
  | 'failed'
  | 'deferred'
  | 'refunded';

export interface OrderAddressSnapshot {
  recipientName: string;
  street: string;
  city: string;
  postalCode: string;
  country: string;
  phone?: string | null;
  /** Billing only — company name and tax id captured at placement. */
  companyName?: string | null;
  taxId?: string | null;
}

export interface OrderDeliveryMethodSnapshot {
  code: string;
  name: string;
  cost: number;
}

export interface OrderDeliveryPointSnapshot {
  provider: string;
  pointId: string;
  label?: string | null;
  address?: string | null;
}

export interface OrderPaymentMethodSnapshot {
  code: string;
  name: string;
  kind: 'bank_transfer' | 'pickup' | 'credit_limit' | 'gateway';
  /** Feature 034 — adapter registry key the order was placed with. */
  adapter?: string;
  /** Feature 034 — flat payment surcharge captured at placement. */
  additionalPrice?: number;
}

/**
 * An order as it crosses a module boundary — a plain shape, never the ORM
 * entity (FR-011).
 *
 * The money columns keep their `string` form. They are `decimal(14,2)` and the
 * entity carries them as strings for exactly one reason: a `number` cannot
 * round-trip a monetary value, and the four payment gateways that read this
 * record all forward the figure to a provider.
 *
 * `status` is a `string` rather than a union because the lifecycle is
 * admin-configurable (feature 038 FR-001/FR-006) — the set of statuses is a
 * table, not an enum, and a consumer that narrowed it would break the first
 * time an operator added one.
 */
export interface OrderRecord {
  id: string;
  businessId: string;
  organizationId: string;
  placedByCustomerAccountId: string;
  placedOnBehalfByAdminUserId: string | null;
  salesChannelId: string;
  status: string;
  paymentStatus: OrderPaymentStatus;
  deliveryAddress: OrderAddressSnapshot;
  billingAddress: OrderAddressSnapshot;
  deliveryPointSnapshot?: OrderDeliveryPointSnapshot | null;
  deliveryMethodId: string;
  deliveryMethodSnapshot: OrderDeliveryMethodSnapshot;
  paymentMethodId: string;
  paymentMethodSnapshot: OrderPaymentMethodSnapshot;
  sourceQuoteRequestId: string | null;
  subtotal: string;
  taxTotal: string;
  discountTotal: string;
  deliveryTotal: string;
  total: string;
  currency: string;
  promotionCode: string | null;
  customerNote: string | null;
  placedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  customFieldValues: Record<string, unknown>;
}

/** One line of an order, as `invoices` reads it. */
export interface OrderItemRecord {
  id: string;
  orderId: string;
  productId: string;
  productSnapshot: { sku: string; name: string; slug?: string | null };
  variantId: string | null;
  variantSnapshot: { sku: string; label: string } | null;
  packagingUnitSnapshot: { name: string; baseQuantity: number } | null;
  quantity: number;
  unitPrice: string;
  taxRate: string;
  lineTotal: string;
  createdAt: Date;
}

/**
 * Container name: `orderReadPort`. Owner: `orders`.
 *
 * Thirty-three of the 42 inbound sites are `em.findOne(Order, { id })` — four
 * payment gateways, `invoices`, `shipments`, `quote_requests` and the export
 * adapter each spelling the same lookup. That is what this port is.
 *
 * When `orders` is off every method fails closed, and that is the answer a
 * gateway callback should get: acknowledging a payment against an order the
 * platform will not read is worse than making the provider retry.
 *
 * Whether `orders` has an off state at all is its manifest's `activation` to
 * say, not this line's: a module declaring `nonDeactivatable` never enters one.
 */
export interface OrderReadPort {
  findById(id: string): Promise<OrderRecord | null>;
  findByIds(ids: readonly string[]): Promise<OrderRecord[]>;
  /** Every order, newest first — for the bulk export adapter. */
  listAll(): Promise<OrderRecord[]>;
  /** The order's lines, in insertion order. */
  listItems(orderId: string): Promise<OrderItemRecord[]>;
  /**
   * Ids of orders whose business id contains `fragment`, case-insensitively,
   * capped at `limit`. An empty `fragment` returns no ids.
   *
   * Published after Phase P, for `invoices`' `filter[orderNumber]`. It is not
   * {@link OrderListPort.list}'s `q`, which also matches the buying
   * organisation and the placing customer — an invoice list filtered by "order
   * number" that quietly matched a company name would be a different filter
   * wearing the same label. It is not `findByIds` either: the caller has a
   * fragment, not ids.
   *
   * `limit` is the caller's, applied by the owner, so the narrowing happens
   * once. `invoices` used to `em.find(Order, { businessId: { $ilike } }, {
   * limit: 500 })` and then narrow again against its own page size, which
   * silently dropped matches beyond the 500th.
   */
  findIdsByBusinessIdLike(fragment: string, limit: number): Promise<string[]>;
  /**
   * The distinct sales channels one customer has ordered on, most recently
   * ordered-on first. A customer with no orders answers `[]`.
   *
   * Published for feature 080's T048 (D-169), for the `customers` detail
   * header. It is a **read**, so it is a method here and not an
   * `EntityManager`-taking apply port: handing a read a transaction handle
   * re-opens a write seam to serve it.
   *
   * It is deliberately not {@link OrderListPort.list} with a
   * `placedByCustomerAccountId`. That read is paginated, so the channels it
   * yields are the channels on one page, and a detail header that silently
   * narrowed with the page size would be a different fact under the same
   * label. `customers` used to answer it with `em.find(Order, {
   * placedByCustomerAccountId }, { fields: ['salesChannelId'] })` inside its
   * own module, which was unpaginated and correct and read this module's table
   * whether this module was there or not.
   *
   * The ids come back **already distinct**: the deduplication is the owner's,
   * because it is what makes the ordering meaningful — the answer is one entry
   * per channel keyed on that customer's latest order there.
   */
  salesChannelIdsForCustomer(customerAccountId: string): Promise<string[]>;
}

/** The admin order list's filter set. Page and page size are required. */
export interface OrderListQuery {
  status?: string[] | undefined;
  /** The money axis (feature 085, FR-021). */
  paymentStatus?: string[] | undefined;
  salesChannelId?: string[] | undefined;
  paymentMethodId?: string[] | undefined;
  deliveryMethodId?: string[] | undefined;
  organizationId?: string | undefined;
  /**
   * Feature 040 — restrict to a single customer's own orders. Used by the
   * customer self-service history and the admin customer-detail orders panel.
   * Aggregates across sales channels when `salesChannelId` is omitted.
   */
  placedByCustomerAccountId?: string | undefined;
  q?: string | undefined;
  /** Dedicated org / customer name filters, AND-combined with the global `q`. */
  orgName?: string | undefined;
  customerName?: string | undefined;
  placedFrom?: string | undefined;
  placedTo?: string | undefined;
  totalMin?: number | undefined;
  totalMax?: number | undefined;
  sort?: string | undefined;
  page: number;
  pageSize: number;
}

/** Restricts a list to the organisations the caller may see. */
export interface OrderListScope {
  allowedOrganizationIds: string[];
}

/**
 * One row of the admin order list.
 *
 * Deliberately **not** `AdminOrderRow` from this file's HTTP section, though
 * the fields line up: that shape narrows `paymentStatus` and `status` to the
 * unions the API documents, and the list is served straight off a
 * configurable-status table (feature 038 FR-001/FR-006). Reusing the narrowed
 * type would be a lie a consumer could act on the first time an operator adds
 * a status.
 */
export interface OrderListRow {
  id: string;
  businessId: string;
  customerName: string | null;
  organizationId: string;
  organizationName: string | null;
  status: string;
  statusName: Record<string, string>;
  paymentStatus: string;
  total: number;
  currency: string;
  placedAt: string;
  createdAt: string;
  salesChannelId: string;
  salesChannelName: string | null;
  deliveryMethodName: string | null;
  paymentMethodName: string | null;
  shipToName: string | null;
  billToName: string | null;
}

export interface OrderListResult {
  rows: OrderListRow[];
  total: number;
  /** Per lifecycle status, over every filter except the status filter. */
  counts: Record<string, number>;
  /**
   * Per payment status, over every filter except the payment-status filter
   * (feature 085). Two maps and not one: `paid` is both a shipped order status
   * code and a payment status, so a single map would merge two populations.
   */
  paymentStatusCounts: Record<string, number>;
}

/**
 * Container name: `orderListPort`. Owner: `orders`.
 *
 * `customers` serves both the self-service order history and the admin
 * customer-detail orders panel from this one list. It reaches it today as
 * `Pick<OrderListService, 'list'>` — a type operator in front of a
 * cross-module import of the class, which is the violation with punctuation on
 * (FR-011). This is the shape that replaces it.
 *
 * **Owner off:** the seam fails closed — resolving this port throws
 * `ModuleDisabledError` and the call answers 503 `MODULE_DISABLED`, so nothing
 * half-executes. Whether `orders` has an off state at all is its manifest's
 * `activation` to say, not this line's: a module declaring
 * `nonDeactivatable` never enters one.
 */
export interface OrderListPort {
  list(query: OrderListQuery, scope?: OrderListScope): Promise<OrderListResult>;
}

/** Who the buyer is, for a placement made on their behalf or by them. */
export interface OrderCustomerContext {
  customerAccountId: string;
  organizationId: string;
  /**
   * When the request is from an admin user impersonating this customer, carry
   * the admin's id so the order is stamped with it (FR-042 / R-12).
   */
  impersonatorAdminUserId?: string | null;
}

/**
 * What a placement answers with: the order row **plus** the payment
 * next-action computed during that placement.
 *
 * `nextAction` is not on {@link OrderRecord} and must not be: it is a virtual
 * column (`persist: false`, `order.entity.ts`) that exists only in the reply to
 * the call that created the order, so a *read* of an order can never carry a
 * meaningful one. It is on this record because the one thing a caller does with
 * a freshly placed order is route the buyer — to the gateway, to the transfer
 * details, or to the success page.
 *
 * Corrected in feature 075's `quick_order` cut: the port below published
 * `OrderRecord`, and `quick_order`'s one-click response renders `nextAction`.
 * Cutting onto the port as published would have dropped the redirect from the
 * one-click reply — a product change wearing a refactor, on the path
 * MR !582 / issue #64 had just brought under test.
 */
export interface PlacedOrderRecord extends OrderRecord {
  nextAction: NextAction | null;
}

/**
 * Container name: `orderPlacementPort`. Owner: `orders`.
 *
 * `quick_order`'s one-click buy is the only consumer: it seeds the cart and
 * then places. It already reaches the service through a lazy accessor that can
 * answer `null`, which is how it expresses "ordering is unavailable"; the port
 * expresses the same thing as a 503 at the seam, which is stronger — a `null`
 * accessor is indistinguishable from a wiring mistake.
 *
 * **Owner off:** the seam fails closed — resolving this port throws
 * `ModuleDisabledError` and the call answers 503 `MODULE_DISABLED`, so nothing
 * half-executes. Whether `orders` has an off state at all is its manifest's
 * `activation` to say, not this line's: a module declaring
 * `nonDeactivatable` never enters one.
 */
export interface OrderPlacementPort {
  placeOrder(ctx: OrderCustomerContext, req: PlaceOrderRequest): Promise<PlacedOrderRecord>;
}

export interface OrderStatusActor {
  kind: 'admin' | 'customer' | 'system';
  adminUserId?: string;
  customerAccountId?: string;
  source?: 'payment' | 'shipment' | 'reorder' | 'checkout';
}

/** What a caller announcing a committed status change has to say. */
export interface OrderStatusChange {
  orderId: string;
  organizationId: string;
  salesChannelId: string;
  from: string;
  to: string;
  actor: OrderStatusActor;
  reason?: string | null;
  /**
   * Feature 062 — human-readable order number for webhook receivers
   * (contracts/order-webhooks.md §5). Optional: system-driven callers
   * (payments, shipments) may not have it in scope.
   */
  businessId?: string | null;
}

/**
 * Container name: `orderStatusAnnouncePort`. Owner: `orders`.
 *
 * `payments` and `shipments` move an order's status inside their own
 * transaction and then have to announce it, which they do today by importing
 * `orders`' event builder and handing it their own `EventBus`. The templated
 * event names (`order.status.from_x_to_y.after`, `order.status.to_y.after`)
 * are `orders`' vocabulary and must be built in one place — they are not known
 * at compile time, because the status set is admin-configurable.
 *
 * A no-op when `from === to`, as the builder already is.
 *
 * **Owner off:** the seam fails closed — resolving this port throws
 * `ModuleDisabledError` and the call answers 503 `MODULE_DISABLED`, so nothing
 * half-executes. Whether `orders` has an off state at all is its manifest's
 * `activation` to say, not this line's: a module declaring
 * `nonDeactivatable` never enters one.
 */
export interface OrderStatusAnnouncePort {
  announceStatusChanged(change: OrderStatusChange): void;
}

/** Why a requested transition did not happen. */
export type OrderTransitionRefusal =
  /** No order with that id. */
  | 'not_found'
  /** `to` is not a configured status code. */
  | 'unknown_status'
  /** The configured lifecycle has no edge, or the source status is terminal. */
  | 'not_permitted'
  /** A registered before-guard vetoed it. */
  | 'vetoed';

/**
 * What became of a requested transition.
 *
 * `already_there` is separated from the refusals because it is not one: the
 * order is where the caller wanted it, nothing moved, and nothing was
 * recorded. It is the normal outcome of a second declined payment attempt on
 * an order already held.
 */
export type OrderTransitionOutcome =
  | { applied: true; from: string; to: string }
  | { applied: false; reason: 'already_there'; from: string }
  | { applied: false; reason: OrderTransitionRefusal; from: string | null; detail: string };

/**
 * Container name: `orderTransitionPort`. Owner: `orders`.
 *
 * The write twin of `orderStatusAnnouncePort`: that one publishes the
 * *announcement* half of a status change, this one performs the change. Three
 * sites in `payments` and `shipments` write `order.status` directly, and in
 * doing so skip graph validation, the veto guards, the audit entry and the
 * side-effects that release stock allocations and free a credit-limit
 * reservation. This port is the seam that lets them stop (feature 085).
 *
 * It is not `orderTransitionServiceAccessor`, which hands out the
 * `OrderTransitionService` class: a published port's type argument must be a
 * contract type, and that accessor also answers `null` until the plugin body
 * has run.
 *
 * **Call this after your own commit, never inside your transaction.** The
 * implementation obtains its own EntityManager, so a caller running inside
 * `em.transactional` would have the order written on a *different* pooled
 * connection that commits independently — the caller's rollback cannot reach
 * it, which is the shape `check:transaction-context` refuses (issue #200).
 * Both settlement handlers therefore write their payment or shipment row,
 * commit, and only then call this. The failure mode of that ordering lands on
 * the safe side: a crash in between leaves the payment recorded and the
 * lifecycle unmoved, which the buyer can retry, where the opposite ordering
 * would hold an order against a payment nobody recorded.
 *
 * **Refusals are outcomes, not exceptions**, because both settlement callers
 * are answering a payment service provider: a thrown refusal becomes a non-2xx
 * callback response, which every PSP retries indefinitely. The refusal has to
 * be visible to the caller and invisible to the provider.
 *
 * **Owner off:** the seam fails closed — resolving this port throws
 * `ModuleDisabledError` and the call answers 503 `MODULE_DISABLED`, so nothing
 * half-executes. A consumer must not wrap the call in a bare `catch`, which
 * would turn that into fail-open. Whether `orders` has an off state at all is
 * its manifest's `activation` to say, not this line's: a module declaring
 * `nonDeactivatable` never enters one.
 */
export interface OrderTransitionPort {
  /**
   * Move an order to status `to`, applying the configured lifecycle: graph
   * validation, the before-guards, the audit entry and the status's
   * side-effects. The caller invokes none of those and needs to know about
   * none of them.
   */
  applyStatus(input: {
    orderId: string;
    to: string;
    actor: OrderStatusActor;
    reason?: string | null;
  }): Promise<OrderTransitionOutcome>;

  /**
   * Whether an order's current status is terminal, per the configured graph.
   *
   * A caller that has to refuse acting on a finished order asks this rather
   * than comparing against the string `'cancelled'`: the status set is
   * operator-configurable and a deployment may add terminal statuses of its
   * own. `null` when there is no such order, so the caller answers 404 in its
   * own words instead of guessing.
   */
  isTerminal(orderId: string): Promise<boolean | null>;
}

/**
 * The answer to a buyer-side claim on an order's GA4 `purchase` conversion
 * (issue #277).
 *
 * `counted: true` means this caller is the one that may report the conversion;
 * every later caller, on any device, gets `false`. The storefront asks before
 * it fires, so the tag runs once per order and never again — which is what
 * stops a buyer who reopens their order from being counted twice, and what
 * lets the two surfaces that may count an order (`/checkout/success` and
 * `/orders/:id`) share one answer instead of guessing about each other.
 */
export const purchaseConversionClaimResponseSchema = z.object({
  counted: z.boolean(),
});

export type PurchaseConversionClaimResponse = z.infer<
  typeof purchaseConversionClaimResponseSchema
>;
