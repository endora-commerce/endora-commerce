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
  paymentStatus: paymentStatusSchema,
  deliveryAddress: addressSnapshotSchema,
  billingAddress: addressSnapshotSchema,
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
  deliveryTotal: z.number().finite().nonnegative(),
  total: z.number().finite().nonnegative(),
  currency: z.string().length(3),
  placedAt: isoDateTimeSchema,
  customerNote: z.string().nullable(),
  nextAction: nextActionSchema.nullable(),
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
});
export type PlaceOrderRequest = z.infer<typeof placeOrderRequestSchema>;

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

export const orderStatusDefSchema = z.object({
  code: orderStatusCodeSchema,
  name: multilingualStringSchema,
  isInitial: z.boolean(),
  isTerminal: z.boolean(),
  isSystem: z.boolean(),
  weight: z.number().int(),
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
  isTerminal: z.boolean().optional(),
  weight: z.number().int().optional(),
});
export type CreateOrderStatusRequest = z.infer<typeof createOrderStatusRequestSchema>;

export const updateOrderStatusRequestSchema = z.object({
  name: multilingualStringSchema.optional(),
  isTerminal: z.boolean().optional(),
  weight: z.number().int().optional(),
});
export type UpdateOrderStatusRequest = z.infer<typeof updateOrderStatusRequestSchema>;

export const setOrderTransitionsRequestSchema = z.object({
  add: z.array(z.object({ fromStatusCode: orderStatusCodeSchema, toStatusCode: orderStatusCodeSchema })).optional(),
  remove: z.array(z.object({ fromStatusCode: orderStatusCodeSchema, toStatusCode: orderStatusCodeSchema })).optional(),
});
export type SetOrderTransitionsRequest = z.infer<typeof setOrderTransitionsRequestSchema>;

// --- Admin orders list / search / bulk / export ----------------------------

export const adminOrdersListQuerySchema = z.object({
  status: orderStatusCodeSchema.optional(),
  salesChannelId: uuidSchema.optional(),
  organizationId: uuidSchema.optional(),
  q: z.string().max(200).optional(),
  placedFrom: isoDateTimeSchema.optional(),
  placedTo: isoDateTimeSchema.optional(),
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
});
export type AdminOrderRow = z.infer<typeof adminOrderRowSchema>;

export const adminOrdersListResponseSchema = z.object({
  data: z.array(adminOrderRowSchema),
  pagination: z.object({
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    total: z.number().int().nonnegative(),
  }),
  counts: z.record(z.string(), z.number().int().nonnegative()).optional(),
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
});
export type OrderSavedView = z.infer<typeof orderSavedViewSchema>;

export const createOrderSavedViewRequestSchema = z.object({
  name: z.string().min(1).max(160),
  shared: z.boolean(),
  filters: z.record(z.string(), z.unknown()),
  sort: orderSavedViewSortSchema,
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

export const adminCreateOrderRequestSchema = z.object({
  customerAccountId: uuidSchema,
  salesChannelId: uuidSchema,
  items: z.array(adminCreateOrderItemSchema).min(1),
  deliveryMethodId: uuidSchema,
  paymentMethodId: uuidSchema,
  deliveryAddress: addressSnapshotSchema,
  billingAddress: addressSnapshotSchema,
  customerNote: z.string().max(4000).optional(),
  comment: z
    .object({
      body: z.string().min(1).max(8000),
      isCustomerVisible: z.boolean(),
      notifyCustomer: z.boolean(),
    })
    .optional(),
});
export type AdminCreateOrderRequest = z.infer<typeof adminCreateOrderRequestSchema>;

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
