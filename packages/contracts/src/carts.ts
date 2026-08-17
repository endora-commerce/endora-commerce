import { z } from 'zod';
import { isoDateTimeSchema, moneySchema, uuidSchema } from './common.js';

/**
 * Cart + CartItem contracts. The Cart can be anonymous (cookie-held) or
 * logged-in; `mergeAnonymousOnLogin` merges the anonymous basket into the
 * authenticated Cart on sign-in (R-09, FR-010).
 *
 * Feature 027 (Carts consolidation) extends this surface additively with:
 *   - the full cart-view payload (status / approval / discount / dropped
 *     lines / re-resolved per-line pricing)
 *   - the mini-cart payload (lightweight header dropdown)
 *   - coupon application / clear request and per-reason failure body
 *   - the three conversion requests (Cart→QR, QR→Cart, ShoppingList→Cart)
 *   - the organization-cart visibility list + detail
 *   - the per-Organization cart-approval policy toggle
 *   - the admin platform-wide carts list / detail / audit / reject
 */

// ────────────────────────────────────────────────────────────────────────
//  Foundation schemas (preserved verbatim; consumed by the legacy routes)
// ────────────────────────────────────────────────────────────────────────

export const cartItemSchema = z.object({
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
  unitPrice: moneySchema,
  lineTotal: moneySchema,
});
export type CartItem = z.infer<typeof cartItemSchema>;

export const cartSchema = z.object({
  id: uuidSchema,
  customerAccountId: uuidSchema.nullable(),
  organizationId: uuidSchema.nullable(),
  anonymousCartToken: z.string().nullable(),
  items: z.array(cartItemSchema),
  subtotal: moneySchema,
  itemCount: z.number().int().nonnegative(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Cart = z.infer<typeof cartSchema>;

export const addCartItemRequestSchema = z.object({
  productId: uuidSchema,
  variantId: uuidSchema.optional(),
  /**
   * Without `packagingUnitId` this is the number of base pieces. With
   * `packagingUnitId` it is the number of packaging units, and the resulting
   * line quantity is `unit.baseQuantity × quantity` (feature 043).
   */
  quantity: z.number().int().positive(),
  /** Feature 043 — order by a packaging unit (e.g. a pallet) of this product. */
  packagingUnitId: uuidSchema.optional(),
});
export type AddCartItemRequest = z.infer<typeof addCartItemRequestSchema>;

// Foundation `updateCartItemRequestSchema` previously required positive
// quantity; feature 027 widens it to allow `0` (which deletes the line)
// per the storefront-cart contract. The old export `updateCartItemRequest`
// is kept as `updateCartItemRequestStrictSchema` for any caller that still
// needs the positive-only check.

export const updateCartItemRequestStrictSchema = z.object({
  quantity: z.number().int().positive(),
});
export type UpdateCartItemRequestStrict = z.infer<typeof updateCartItemRequestStrictSchema>;

export const updateCartItemRequestSchema = z.object({
  quantity: z.number().int().min(0).max(999),
});
export type UpdateCartItemRequest = z.infer<typeof updateCartItemRequestSchema>;

// ────────────────────────────────────────────────────────────────────────
//  Feature 027 — status & approval enums (shared across surfaces)
// ────────────────────────────────────────────────────────────────────────

export const cartStatusSchema = z.enum(['active', 'abandoned', 'completed', 'rejected']);
export type CartStatus = z.infer<typeof cartStatusSchema>;

export const cartApprovalStatusSchema = z.enum([
  'not_required',
  'pending',
  'approved',
  'rejected_by_org_admin',
]);
export type CartApprovalStatus = z.infer<typeof cartApprovalStatusSchema>;

export const cartPrimaryCtaSchema = z.enum([
  'checkout',
  'submit_for_approval',
  'awaiting_approval',
  'blocked_by_organization',
]);
export type CartPrimaryCta = z.infer<typeof cartPrimaryCtaSchema>;

export const couponDropReasonSchema = z.enum([
  'invalid_code',
  'expired',
  'below_min_spend',
  'wrong_channel',
  'wrong_customer_group',
  'wrong_organization',
  'coupon_format_invalid',
]);
export type CouponDropReason = z.infer<typeof couponDropReasonSchema>;

export const cartDroppedLineReasonSchema = z.enum([
  'not_purchasable',
  'out_of_stock',
  'no_price_in_customer_list',
  'removed_by_conversion',
]);
export type CartDroppedLineReason = z.infer<typeof cartDroppedLineReasonSchema>;

export const cartLineUnavailableReasonSchema = z.enum([
  'out_of_stock',
  'not_purchasable',
  'no_price_in_customer_list',
]);
export type CartLineUnavailableReason = z.infer<typeof cartLineUnavailableReasonSchema>;

// ────────────────────────────────────────────────────────────────────────
//  Feature 027 — full / mini cart-view response shapes
// ────────────────────────────────────────────────────────────────────────

const couponCodeRegex = /^[A-Z0-9_-]{1,64}$/;

export const cartViewLineSchema = z.object({
  id: uuidSchema,
  productId: uuidSchema,
  variantId: uuidSchema.nullable(),
  productName: z.string(),
  productSlug: z.string().optional(),
  productThumbnailUrl: z.string().nullable(),
  quantity: z.number().int().positive(),
  unitPrice: moneySchema,
  lineTotal: moneySchema,
  unavailable: z.boolean(),
  unavailableReason: cartLineUnavailableReasonSchema.nullable(),
  /**
   * Feature 043 — set when the line was added as a packaging unit (e.g. a
   * pallet). `displayName` already includes the appended unit name.
   */
  packagingUnitName: z.string().nullable().optional(),
  packagingUnitBaseQuantity: z.number().int().positive().nullable().optional(),
  displayName: z.string().nullable().optional(),
});
export type CartViewLine = z.infer<typeof cartViewLineSchema>;

export const cartMiniLineSchema = z.object({
  id: uuidSchema,
  productId: uuidSchema,
  productName: z.string(),
  productThumbnailUrl: z.string().nullable(),
  quantity: z.number().int().positive(),
  unitPrice: moneySchema,
  lineTotal: moneySchema,
});
export type CartMiniLine = z.infer<typeof cartMiniLineSchema>;

const cartDiscountSchema = z
  .object({
    code: z.string().nullable(),
    amount: z.number().nonnegative(),
    currency: z.string().length(3),
  })
  .nullable();

const cartDroppedLineSchema = z.object({
  productId: uuidSchema,
  productName: z.string(),
  reason: cartDroppedLineReasonSchema,
});

/** Feature 045 — one applied promotion's contribution to the cart discount. */
export const cartAppliedPromotionSchema = z.object({
  promotionId: uuidSchema,
  couponId: uuidSchema.nullable().default(null),
  amount: z.number().nonnegative(),
  currency: z.string().length(3),
});
export type CartAppliedPromotion = z.infer<typeof cartAppliedPromotionSchema>;

const couponDroppedThisReadSchema = z
  .object({
    code: z.string(),
    reason: couponDropReasonSchema,
  })
  .nullable();

export const cartFullPayloadSchema = z.object({
  id: uuidSchema.nullable(),
  customerAccountId: uuidSchema.nullable(),
  organizationId: uuidSchema.nullable(),
  salesChannelId: uuidSchema.nullable(),
  anonymousCartToken: z.string().nullable(),
  status: cartStatusSchema,
  approvalStatus: cartApprovalStatusSchema,
  items: z.array(cartViewLineSchema),
  itemCount: z.number().int().nonnegative(),
  subtotal: moneySchema,
  discount: cartDiscountSchema,
  /** Feature 045 — per-promotion breakdown of the cart discount. */
  appliedPromotions: z.array(cartAppliedPromotionSchema).default([]),
  grandTotal: moneySchema,
  primaryCta: cartPrimaryCtaSchema,
  droppedLines: z.array(cartDroppedLineSchema),
  couponDroppedThisRead: couponDroppedThisReadSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  lastActivityAt: isoDateTimeSchema,
});
export type CartFullPayload = z.infer<typeof cartFullPayloadSchema>;

export const cartFullResponseSchema = z.object({ data: cartFullPayloadSchema });
export type CartFullResponse = z.infer<typeof cartFullResponseSchema>;

export const cartMiniPayloadSchema = z.object({
  id: uuidSchema.nullable(),
  status: cartStatusSchema,
  approvalStatus: cartApprovalStatusSchema,
  items: z.array(cartMiniLineSchema),
  itemCount: z.number().int().nonnegative(),
  grandTotal: moneySchema,
  primaryCta: cartPrimaryCtaSchema,
});
export type CartMiniPayload = z.infer<typeof cartMiniPayloadSchema>;

export const cartMiniResponseSchema = z.object({ data: cartMiniPayloadSchema });
export type CartMiniResponse = z.infer<typeof cartMiniResponseSchema>;

// ────────────────────────────────────────────────────────────────────────
//  Feature 027 — save line to shopping list (US1)
// ────────────────────────────────────────────────────────────────────────

export const saveCartItemToListSchema = z.object({
  shoppingListId: uuidSchema,
});
export type SaveCartItemToList = z.infer<typeof saveCartItemToListSchema>;

// ────────────────────────────────────────────────────────────────────────
//  Feature 027 — up-sells (US1)
// ────────────────────────────────────────────────────────────────────────

export const upsellProductSchema = z.object({
  productId: uuidSchema,
  productName: z.string(),
  productSlug: z.string(),
  productThumbnailUrl: z.string().nullable(),
  unitPrice: moneySchema.nullable(),
  matchCount: z.number().int().positive(),
});
export type UpsellProduct = z.infer<typeof upsellProductSchema>;

export const upsellsResponseSchema = z.object({ data: z.array(upsellProductSchema) });
export type UpsellsResponse = z.infer<typeof upsellsResponseSchema>;

export const cartUpsellsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(24).optional(),
});
export type CartUpsellsQuery = z.infer<typeof cartUpsellsQuerySchema>;

// ────────────────────────────────────────────────────────────────────────
//  Feature 027 — coupon application (US2)
// ────────────────────────────────────────────────────────────────────────

export const applyCartCouponSchema = z.object({
  code: z.string().regex(couponCodeRegex).nullable(),
});
export type ApplyCartCoupon = z.infer<typeof applyCartCouponSchema>;

export const couponFailureBodySchema = z.object({
  error: z.object({
    code: z.literal('CART_COUPON_REJECTED'),
    message: z.string(),
    details: z.object({
      reason: couponDropReasonSchema,
      shortfall: moneySchema.optional(),
    }),
  }),
});
export type CouponFailureBody = z.infer<typeof couponFailureBodySchema>;

// ────────────────────────────────────────────────────────────────────────
//  Feature 027 — conversions (US3)
// ────────────────────────────────────────────────────────────────────────

export const convertCartToQrSchema = z.object({
  note: z.string().max(2000).optional(),
});
export type ConvertCartToQr = z.infer<typeof convertCartToQrSchema>;

export const convertCartToQrResponseSchema = z.object({
  data: z.object({
    quoteRequestId: uuidSchema,
    cartId: uuidSchema,
    quoteRequestSlug: z.string(),
  }),
});
export type ConvertCartToQrResponse = z.infer<typeof convertCartToQrResponseSchema>;

export const cartFromQrResponseSchema = z.object({
  data: z.object({
    cartId: uuidSchema,
    appendedLineCount: z.number().int().nonnegative(),
    droppedLines: z.array(cartDroppedLineSchema),
  }),
});
export type CartFromQrResponse = z.infer<typeof cartFromQrResponseSchema>;

export const cartFromShoppingListResponseSchema = z.object({
  data: z.object({
    cartId: uuidSchema,
    appendedLineCount: z.number().int().nonnegative(),
    droppedLines: z.array(cartDroppedLineSchema),
  }),
});
export type CartFromShoppingListResponse = z.infer<typeof cartFromShoppingListResponseSchema>;

// ────────────────────────────────────────────────────────────────────────
//  Feature 027 — organization-carts (US4 visibility + policy + approval)
// ────────────────────────────────────────────────────────────────────────

export const orgCartSummarySchema = z.object({
  id: uuidSchema,
  ownerCustomerAccountId: uuidSchema,
  ownerDisplayName: z.string(),
  status: cartStatusSchema,
  approvalStatus: cartApprovalStatusSchema,
  itemCount: z.number().int().nonnegative(),
  total: moneySchema,
  lastActivityAt: isoDateTimeSchema,
  submittedForApprovalAt: isoDateTimeSchema.nullable(),
});
export type OrgCartSummary = z.infer<typeof orgCartSummarySchema>;

export const orgCartsListResponseSchema = z.object({
  data: z.array(orgCartSummarySchema),
  meta: z.object({
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    totalCount: z.number().int().nonnegative(),
  }),
});
export type OrgCartsListResponse = z.infer<typeof orgCartsListResponseSchema>;

export const cartAuditFeedEntrySchema = z.object({
  occurredAt: isoDateTimeSchema,
  actorType: z.enum(['customer', 'org_admin', 'platform_admin', 'system', 'sweep']),
  actorDisplayName: z.string().nullable(),
  action: z.string(),
  fromState: z.string().nullable(),
  toState: z.string().nullable(),
  reason: z.string().nullable(),
});
export type CartAuditFeedEntry = z.infer<typeof cartAuditFeedEntrySchema>;

export const orgCartDetailPayloadSchema = cartFullPayloadSchema.extend({
  ownerCustomerAccountId: uuidSchema,
  ownerDisplayName: z.string(),
  auditEntries: z.array(cartAuditFeedEntrySchema),
});
export type OrgCartDetailPayload = z.infer<typeof orgCartDetailPayloadSchema>;

export const orgCartDetailResponseSchema = z.object({ data: orgCartDetailPayloadSchema });
export type OrgCartDetailResponse = z.infer<typeof orgCartDetailResponseSchema>;

export const setCartApprovalPolicySchema = z.object({
  requiresCartApproval: z.boolean(),
});
export type SetCartApprovalPolicy = z.infer<typeof setCartApprovalPolicySchema>;

export const cartApprovalPolicyResponseSchema = z.object({
  data: z.object({
    organizationId: uuidSchema,
    requiresCartApproval: z.boolean(),
    updatedAt: isoDateTimeSchema,
  }),
});
export type CartApprovalPolicyResponse = z.infer<typeof cartApprovalPolicyResponseSchema>;

export const rejectOrgCartSchema = z.object({
  reason: z.string().min(1).max(2000),
});
export type RejectOrgCart = z.infer<typeof rejectOrgCartSchema>;

// ────────────────────────────────────────────────────────────────────────
//  Feature 027 — admin platform-wide carts (US6)
// ────────────────────────────────────────────────────────────────────────

export const adminCartSortSchema = z.enum([
  'last_activity_desc',
  'last_activity_asc',
  'total_desc',
  'total_asc',
  'created_desc',
]);
export type AdminCartSort = z.infer<typeof adminCartSortSchema>;

export const adminCartSummarySchema = z.object({
  id: uuidSchema,
  ownerCustomerAccountId: uuidSchema.nullable(),
  ownerDisplayName: z.string().nullable(),
  organizationId: uuidSchema.nullable(),
  organizationDisplayName: z.string().nullable(),
  salesChannelId: uuidSchema.nullable(),
  salesChannelCode: z.string().nullable(),
  status: cartStatusSchema,
  approvalStatus: cartApprovalStatusSchema,
  itemCount: z.number().int().nonnegative(),
  total: moneySchema,
  appliedPromotionCode: z.string().nullable(),
  lastActivityAt: isoDateTimeSchema,
  createdAt: isoDateTimeSchema,
});
export type AdminCartSummary = z.infer<typeof adminCartSummarySchema>;

export const adminCartsListResponseSchema = z.object({
  data: z.array(adminCartSummarySchema),
  meta: z.object({
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    totalCount: z.number().int().nonnegative(),
  }),
});
export type AdminCartsListResponse = z.infer<typeof adminCartsListResponseSchema>;

export const adminCartsListQuerySchema = z.object({
  status: z.array(cartStatusSchema).optional(),
  approvalStatus: z.array(cartApprovalStatusSchema).optional(),
  organizationId: uuidSchema.optional(),
  customerAccountId: uuidSchema.optional(),
  salesChannelId: uuidSchema.optional(),
  lastActivityFrom: isoDateTimeSchema.optional(),
  lastActivityTo: isoDateTimeSchema.optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(200).optional(),
  sort: adminCartSortSchema.optional(),
});
export type AdminCartsListQuery = z.infer<typeof adminCartsListQuerySchema>;

export const adminCartLineSchema = z.object({
  id: uuidSchema,
  productId: uuidSchema,
  productName: z.string(),
  variantId: uuidSchema.nullable(),
  quantity: z.number().int().positive(),
  unitPrice: moneySchema,
  lineTotal: moneySchema,
});
export type AdminCartLine = z.infer<typeof adminCartLineSchema>;

export const adminCartDetailPayloadSchema = adminCartSummarySchema.extend({
  items: z.array(adminCartLineSchema),
  discount: cartDiscountSchema,
  convertedToQuoteRequestId: uuidSchema.nullable(),
  submittedForApprovalAt: isoDateTimeSchema.nullable(),
  approvedAt: isoDateTimeSchema.nullable(),
  approvedByCustomerAccountId: uuidSchema.nullable(),
  rejectedAt: isoDateTimeSchema.nullable(),
  rejectedByActor: z.string().nullable(),
  rejectedReason: z.string().nullable(),
});
export type AdminCartDetailPayload = z.infer<typeof adminCartDetailPayloadSchema>;

export const adminCartDetailResponseSchema = z.object({ data: adminCartDetailPayloadSchema });
export type AdminCartDetailResponse = z.infer<typeof adminCartDetailResponseSchema>;

export const adminCartAuditEntrySchema = z.object({
  id: uuidSchema,
  occurredAt: isoDateTimeSchema,
  actorType: z.enum(['customer', 'org_admin', 'platform_admin', 'system', 'sweep']),
  actorId: uuidSchema.nullable(),
  actorDisplayName: z.string().nullable(),
  action: z.string(),
  fromState: z.string().nullable(),
  toState: z.string().nullable(),
  reason: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
});
export type AdminCartAuditEntry = z.infer<typeof adminCartAuditEntrySchema>;

export const adminCartAuditResponseSchema = z.object({
  data: z.array(adminCartAuditEntrySchema),
  meta: z.object({
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    totalCount: z.number().int().nonnegative(),
  }),
});
export type AdminCartAuditResponse = z.infer<typeof adminCartAuditResponseSchema>;

export const adminRejectCartSchema = z.object({
  reason: z.string().min(1).max(2000),
});
export type AdminRejectCart = z.infer<typeof adminRejectCartSchema>;

// ---------------------------------------------------------------------------
// --- ports -----------------------------------------------------------------
//
// The in-process surface `carts` publishes to the five modules that read it
// (feature 075, Phase P). Plain TypeScript, not Zod: these describe in-process
// calls, not an API boundary.
// ---------------------------------------------------------------------------

/** Who a cart belongs to. `organizationId` is null for a guest-style account. */
export interface CartCustomerContext {
  customerAccountId: string;
  /**
   * Feature 026 US2 — null for guest-style customer accounts that have no
   * organisation. Carts persist `organization_id` nullable, so either case is
   * valid; a no-org cart falls back to platform-default prices.
   */
  organizationId: string | null;
}

/**
 * A cart as it crosses a module boundary — a plain shape, never the ORM entity
 * (FR-011). `version` travels because it is the optimistic-lock token a caller
 * has to pass back on a versioned write.
 */
export interface CartRecord {
  id: string;
  customerAccountId: string | null;
  organizationId: string | null;
  anonymousCartToken: string | null;
  salesChannelId: string | null;
  status: CartStatus;
  approvalStatus: CartApprovalStatus;
  submittedForApprovalAt: Date | null;
  approvedAt: Date | null;
  approvedByCustomerAccountId: string | null;
  rejectedAt: Date | null;
  rejectedByActor: string | null;
  rejectedReason: string | null;
  appliedPromotionCode: string | null;
  convertedToQuoteRequestId: string | null;
  abandonmentNotifiedAt: Date | null;
  lastActivityAt: Date;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * One cart line. The money columns stay strings — `decimal`, and the checkout
 * that reads them turns them into order lines verbatim.
 */
export interface CartItemRecord {
  id: string;
  cartId: string;
  productId: string;
  variantId: string | null;
  quantity: number;
  unitPrice: string;
  currency: string;
  recomputedUnitPrice: string | null;
  recomputedAt: Date | null;
  recomputedCurrency: string | null;
  packagingUnitId: string | null;
  packagingUnitName: string | null;
  packagingUnitBaseQuantity: number | null;
  createdAt: Date;
  updatedAt: Date;
}

/** A cart with its lines — the unit every consumer actually wants. */
export interface CartWithItems {
  cart: CartRecord;
  items: CartItemRecord[];
}

/** One line to seed a cart with. */
export interface CartSeedLine {
  productId: string;
  variantId?: string | null;
  quantity: number;
  unitPrice: string;
  currency: string;
}

/**
 * Container name: `cartReadPort`. Owner: `carts`.
 *
 * `orders` and `quote_requests` both ask the same question at checkout and at
 * quote conversion: what is this customer's active cart, and what is on it?
 * Six sites spell it as `em.findOne(Cart, { …, status: 'active' })` followed
 * by `em.find(CartItem, { cartId })`, which is two round trips and one place
 * to forget the status filter.
 *
 * When `carts` is off the read fails closed, which is right: a checkout that
 * cannot see the cart must refuse rather than place an empty order.
 */
export interface CartReadPort {
  findActiveForCustomer(ctx: CartCustomerContext): Promise<CartWithItems | null>;
  findById(cartId: string): Promise<CartWithItems | null>;
}

/**
 * Container name: `cartService`. Owner: `carts`.
 *
 * The write surface `orders`, `quick_order` and `shopping_lists` reach today.
 * `replaceItemsForCustomer` is the one addition: `orders`' reorder and
 * `quote_requests`' quote-to-cart conversion both create a cart with
 * `em.create(Cart, …)` and then hand-build `CartItem` rows — two modules
 * writing another module's two tables, with the clear-then-seed rule spelled
 * out twice and the `lastActivityAt` bookkeeping in neither.
 */
export interface CartWritePort {
  getOrCreateForCustomer(ctx: CartCustomerContext): Promise<CartRecord>;
  addItem(
    actor: { customer?: CartCustomerContext; anonymousToken?: string },
    input: {
      productId: string;
      variantId?: string;
      quantity: number;
      packagingUnitId?: string;
    },
  ): Promise<CartWithItems>;
  clearForCustomer(ctx: CartCustomerContext): Promise<void>;
  /**
   * Clear the customer's active cart and seed it with these lines, creating
   * the cart when there is none. The single-active-cart model admin
   * order-create, reorder and RFQ conversion all assume.
   */
  replaceItemsForCustomer(
    ctx: CartCustomerContext,
    lines: readonly CartSeedLine[],
  ): Promise<CartWithItems>;
}

export interface CartItemView {
  productId: string;
  variantId: string | null;
  quantity: number;
  unitPrice: string;
  currency: string;
}

export interface CartView {
  id: string;
  status: string;
  lastActivityAt: string | null;
  items: CartItemView[];
}

export interface CustomerCartsView {
  current: CartView | null;
  abandoned: CartView[];
}

/**
 * Container name: `cartQueryPort`. Owner: `carts`.
 *
 * The customer-detail panels in `customers` (feature 040, US5 / FR-030,
 * FR-031): the account's current cart and its abandoned ones. A reporting
 * read, deliberately separate from {@link CartReadPort}, which is the
 * transactional one.
 */
export interface CartQueryPort {
  listForCustomer(customerAccountId: string): Promise<CustomerCartsView>;
}
