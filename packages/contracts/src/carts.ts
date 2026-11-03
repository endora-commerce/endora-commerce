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

/**
 * `working` (issue #169): a basket an order is placed from on the customer's
 * behalf, beside their active basket. Never listed and never the customer's
 * basket; it ends `completed` against its order or is removed.
 */
export const cartStatusSchema = z.enum(['active', 'abandoned', 'completed', 'rejected', 'working']);
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
  /** Feature 155 — the line would leave its product below a minimum (R8). */
  'below_minimum',
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
  /**
   * The product's name in the response language, `null` when it is not known
   * to the reply: the line-mutation replies (`POST`/`PATCH`/`DELETE
   * /api/v1/cart/items…`) do not resolve product names and answer `null` on
   * every line; `GET /api/v1/cart` resolves it (issue #128).
   */
  productName: z.string().nullable(),
  /**
   * Feature 163 (owner decision S1 = A) — `null` when the product is not
   * available at the basket's (channel, language): the line keeps its name and
   * SKU and reads `unavailable`, and links nowhere, because the product page
   * answers 404 there.
   */
  productSlug: z.string().nullable().optional(),
  /** The product's SKU, kept on an unavailable line too. */
  productSku: z.string().nullable().optional(),
  /**
   * Declared since feature 027 and **not answered by any cart route today**
   * (issue #128): a client must treat it as absent. Optional so the schema
   * describes the wire rather than a field nobody sends.
   */
  productThumbnailUrl: z.string().nullable().optional(),
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
  /** Feature 155 — the product's current pieces minimum (null = none); the storefront's input floor. */
  minOrderQuantity: z.number().int().positive().nullable().optional(),
  /** Feature 155 — set when this line is below a current minimum and not exempt (FR-013, FR-028). */
  belowMinimum: z
    .object({
      kind: z.enum(['pieces', 'packaging_unit']),
      minimum: z.number().int().positive(),
      packagingUnitName: z.string().optional(),
    })
    .nullable()
    .optional(),
});
export type CartViewLine = z.infer<typeof cartViewLineSchema>;

export const cartMiniLineSchema = z.object({
  id: uuidSchema,
  productId: uuidSchema,
  /** Answered on every mini line (issue #128); `null` = the line is not a variant. */
  variantId: uuidSchema.nullable().optional(),
  /**
   * Declared since feature 027 and **not answered by the mini view** (issue
   * #128) — it skips the product lookup on purpose (FR-007). A client must
   * treat both as absent.
   */
  productName: z.string().nullable().optional(),
  productThumbnailUrl: z.string().nullable().optional(),
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
  /** Feature 155 — the minimum a `below_minimum` line missed. */
  minimum: z.number().int().positive().optional(),
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
  /**
   * `null` on the empty basket — the reply for a caller who has no basket yet,
   * whose `id` is `null` too (issue #128). A basket that exists always carries
   * all three.
   */
  createdAt: isoDateTimeSchema.nullable(),
  updatedAt: isoDateTimeSchema.nullable(),
  lastActivityAt: isoDateTimeSchema.nullable(),
});
export type CartFullPayload = z.infer<typeof cartFullPayloadSchema>;

export const cartFullResponseSchema = z.object({ data: cartFullPayloadSchema });
export type CartFullResponse = z.infer<typeof cartFullResponseSchema>;

/**
 * `GET /api/v1/cart?view=mini` — the header's lightweight basket (feature 027,
 * FR-007).
 *
 * What the route answers is `id`, `itemCount`, `items` and `subtotal`, on an
 * empty basket too. `status`, `approvalStatus`, `grandTotal` and `primaryCta`
 * were declared required here and have **never been answered** by the mini
 * view, which skips the coupon and promotion work they need on purpose; they
 * are optional so the schema describes the wire (issue #128). A client that
 * needs them reads the full view.
 */
export const cartMiniPayloadSchema = z.object({
  id: uuidSchema.nullable(),
  status: cartStatusSchema.optional(),
  approvalStatus: cartApprovalStatusSchema.optional(),
  items: z.array(cartMiniLineSchema),
  itemCount: z.number().int().nonnegative(),
  /**
   * The sum of the lines at their stored unit prices — no re-pricing, no
   * discount. Answered on every mini reply; optional only so a value that
   * parsed before it was declared still parses.
   */
  subtotal: moneySchema.optional(),
  grandTotal: moneySchema.optional(),
  primaryCta: cartPrimaryCtaSchema.optional(),
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
  /**
   * The sales channel whose basket is meant (`specs/154-sales-channel-access/`,
   * FR-030). A customer holds one active basket per channel, created, priced
   * and placed on that channel; every producer passes the channel of its own
   * request — or, for an operator placing an order on a customer's behalf, the
   * channel that order names.
   */
  salesChannelId: string;
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
  /**
   * The accepted Quote Request whose agreed lines this basket was seeded with
   * (`CartWritePort.replaceItemsForCustomer`'s `sourceQuoteRequestId`), or
   * `null`. The opposite direction from {@link convertedToQuoteRequestId}: that
   * one names the request a basket *became*, this one the request a basket
   * *came from*.
   *
   * **A claim, not a fact, for whoever reads it.** `carts` records what its
   * caller said and judges nothing about the request; `orders` — the one
   * reader — re-reads the request through `quoteRequestReadPort` at placement
   * before it stamps the order.
   */
  sourceQuoteRequestId: string | null;
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
  /**
   * Feature 155 (FR-028) — the quantity this line was seeded with from an accepted
   * quote request; `null` for every other line. Written only by
   * `CartWritePort.replaceItemsForCustomer` with a `sourceQuoteRequestId` — it is
   * the line's agreed quantity, the one its agreed price holds at.
   */
  quoteSeededQuantity: number | null;
  /**
   * Issue #167 — the accepted Quote Request this line's agreement was seeded from; `null` (or
   * absent) on every line that carries none. Written with {@link quoteSeededQuantity}, and read
   * at order placement, which refuses the line at its agreed price once that quote's validity
   * has ended or it is no longer in force.
   */
  quoteRequestId?: string | null;
  /**
   * Feature 160 (FR-030) — which tier priced `unitPrice` (`base`, `catalogue`,
   * `buyer`, `sale`), or `agreed`; `null` for a line priced before the feature.
   * Order placement copies it onto the order line.
   */
  priceSource?: 'agreed' | 'base' | 'catalogue' | 'buyer' | 'sale' | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Feature 155 (FR-028, owner ruling P2; data-model §2) — whether a basket line is
 * exempt from the catalogue's order minimums: it was seeded from an accepted quote,
 * the basket still carries that quote as its source, and the line's quantity equals
 * the quote's. State-based, so 5 → 12 → 5 is exempt again.
 *
 * The per-line half only: `carts` applies it to the basket's mark at face value;
 * `orders` first decides whether the quote source honours exemptions at all (R19).
 */
export function isQuoteSeededLineExempt(
  cart: Pick<CartRecord, 'sourceQuoteRequestId'>,
  item: Pick<CartItemRecord, 'quantity' | 'quoteSeededQuantity'>,
): boolean {
  return (
    cart.sourceQuoteRequestId !== null &&
    item.quoteSeededQuantity !== null &&
    item.quantity === item.quoteSeededQuantity
  );
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

/** What a seeded basket remembers about where its lines came from. */
export interface CartSeedOptions {
  /** The accepted Quote Request these lines are the agreed lines of. */
  sourceQuoteRequestId?: string | null;
  /**
   * Issue #166 — leave out of the basket every seed line that has no price
   * this customer may order it at now (no price list and no price of its own,
   * or sold on request only), and name them in the answer's `unorderable`.
   * A reorder sets it, so the buyer is told rather than handed a basket
   * placement refuses. Ignored for an agreed seed (`sourceQuoteRequestId`),
   * whose lines are priced by their agreement. Absent, such a line is kept at
   * the price it was seeded with, as before.
   */
  dropUnorderable?: boolean;
}

/** A seed line `dropUnorderable` left out, and why (issue #166). */
export interface CartSeedUnorderableLine {
  productId: string;
  variantId: string | null;
  /** `unpriced`: nothing prices it for this customer; `quote_only`: sold on request only. */
  reason: 'unpriced' | 'quote_only';
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
 * **The escalation is settled and the consumer is written down** (feature 080,
 * T048; D-169). This doc block used to say the port had none, and asked whoever
 * settled the question to retire it or name one here.
 *
 * The question was: `orders` reads the cart inside `em.transactional` and ends
 * by clearing it and marking it `completed`, with
 * `test/integration/orders/place-order-failure-preserves-cart.test.ts`
 * asserting that a failed placement leaves the basket intact — and a read
 * through *this* port runs on the owner's own `EntityManager`, outside that
 * transaction, so it could not serve that site. The answer is that there are
 * **two** questions and they take two ports. The completion, and the read that
 * belongs to it, moved into `carts` as `CartPlacementApplyPort` — declared in
 * that module's own `ports/` directory rather than here, because both of its
 * methods take the caller's `EntityManager` and FR-034 keeps a MikroORM type
 * out of a package `admin` and `storefront` both compile.
 *
 * What is left for this port is the read that never had a transaction:
 * `orders`' storefront **total preview**, which opens none and is its consumer
 * today. That split is D-169's rule rather than a preference — a read handed an
 * `EntityManager` is a write seam re-opened to serve a read — and it is why the
 * two ports exist side by side instead of one widening to cover both.
 *
 * When `carts` is off the read fails closed, which is right: a checkout that
 * cannot see the cart must refuse rather than place an empty order.
 *
 * Whether `carts` has an off state at all is its manifest's `activation` to
 * say, not this line's: a module declaring `nonDeactivatable` never enters one.
 */
export interface CartReadPort {
  findActiveForCustomer(ctx: CartCustomerContext): Promise<CartWithItems | null>;
  findById(cartId: string): Promise<CartWithItems | null>;
}

/**
 * Container name: `cartWritePort`. Owner: `carts`.
 *
 * (It said `cartService` until feature 075's `quick_order` cut resolved it and
 * found the name taken: `carts/backend.ts` registers `cartService` for the
 * `CartService` **class**, which still hands `Cart` and `CartItem` entities
 * across, and `cartWritePort` for this adapter. A consumer copying the wrong
 * name out of this comment gets the class, and only `tsc` stops it.)
 *
 * The write surface `orders`, `quick_order` and `shopping_lists` reach today.
 * `replaceItemsForCustomer` is the one addition: `orders`' reorder and
 * `quote_requests`' quote-to-cart conversion both create a cart with
 * `em.create(Cart, …)` and then hand-build `CartItem` rows — two modules
 * writing another module's two tables, with the clear-then-seed rule spelled
 * out twice and the `lastActivityAt` bookkeeping in neither.
 *
 * **Owner off:** the seam fails closed — resolving this port throws
 * `ModuleDisabledError` and the call answers 503 `MODULE_DISABLED`, so nothing
 * half-executes. Whether `carts` has an off state at all is its manifest's
 * `activation` to say, not this line's: a module declaring
 * `nonDeactivatable` never enters one.
 */
/**
 * Feature 155 (research R8) — one line of a batch add (`CartWritePort.addItems`).
 * The fields of `addItem`'s line.
 */
export interface CartBatchLineInput {
  productId: string;
  variantId?: string;
  /** Pieces, or units when `packagingUnitId` is set — as `addItem`. */
  quantity: number;
  packagingUnitId?: string;
  /** As `addItem`'s: set only by an operator surface that names the channel itself. */
  salesChannelId?: string;
}

/**
 * Feature 155 (research R8) — what became of one batch line, at its input `index`.
 *
 * A `failed` line carries the refusal it met and nothing about the product: a
 * product the caller may not see fails with the unknown id's `404`, never with a
 * name or a minimum (FR-035, threat F1).
 */
export type CartBatchLineOutcome =
  | { index: number; status: 'added' }
  | {
      index: number;
      status: 'below_minimum';
      productId: string;
      /** In `options.language`, the language the response is answered in. */
      productName: string;
      kind: 'pieces' | 'packaging_unit';
      minimum: number;
      packagingUnitName?: string;
    }
  | {
      index: number;
      status: 'failed';
      /** The refusal as `addItem` threw it; `details` only when it carried any. */
      error: { status: number; code: string; message: string; details?: unknown };
    };

/**
 * The cart writes `carts` publishes to other modules.
 *
 * There is deliberately no operation that empties a buyer's basket and closes
 * it without an order. `clearForCustomer` did exactly that — every line
 * deleted, the basket marked `completed` with no `completed_order_id` — and was
 * removed in issue #601: once #169 moved its callers off it, it was only the
 * next module's way back to a finished basket that produced nothing. A module
 * that places an order for a customer writes the lines into a working basket
 * (`addItems` with `workingBasket`) and leaves the active one alone; one that
 * means to re-seed the active basket calls `replaceItemsForCustomer`, which
 * keeps it active.
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
      /**
       * The channel whose assortment decides whether the product may be added.
       * Absent: the request's resolved channel. Set by an operator surface that
       * places an order on a channel it names itself (admin order creation),
       * never by a buyer-facing route.
       */
      salesChannelId?: string;
    },
    /** The language a minimum refusal names the product in (feature 155, D3/D4). */
    options?: { language?: string },
  ): Promise<CartWithItems>;
  /**
   * Feature 155 (R8) — add several lines. (1) Every line is resolved with exactly
   * `addItem`'s preconditions (quantity, visibility, channel, packaging unit in
   * product); a line that fails gets the unknown-id answer and takes no part in
   * the evaluation. (2) The resolved lines are judged with the cart in two passes
   * — unit minimums, then pieces minimums over the survivors; lines below a
   * minimum are not added and are reported. Lines already in the cart are never
   * rejected. (3) The accepted lines are added.
   *
   * `onLineError: 'throw'` — the first resolution failure is thrown before
   * anything is written; a later add failure is thrown as `addItem` would (lines
   * before it stay added). `'report'` — every failure is returned as `failed`.
   *
   * `onBelowMinimum: 'report'` (the default) — a line below a minimum is a
   * `below_minimum` outcome. `'throw'` — any such line refuses the whole batch
   * after step (2) and before anything is written: `422
   * PRODUCT_BELOW_MINIMUM_QUANTITY` / `PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY`,
   * every offending line in `details.lines` keyed by its `index`.
   *
   * `workingBasket` (a customer actor only; issue #169) — the batch is written
   * into a fresh **working** basket of the customer's on the actor's channel,
   * never into the active one, which stays exactly as it was: step (2) judges
   * the batch alone, and the working basket is created only after steps (1) and
   * (2) pass and removed again when step (3) refuses a line, so a refused
   * request writes nothing. The returned cart is that working basket; its id is
   * what `OrderPlacementPort.placeOrder`'s `workingBasketId` places from. It
   * requires `onLineError: 'throw'`; with `'report'` the call is refused before
   * anything is read or written.
   *
   * `keepRepeatedLines` (with `workingBasket` only) — every line stays a line
   * of its own: a repeated `(product, variant, unit)` is not merged into the
   * first, each line is priced at its own quantity, and the basket reads back in
   * the batch's order. Minimums are still judged on a product's total. Feature
   * 159 (research N-31): the admin order creation's one product on lines of
   * several groups.
   *
   * `ModuleDisabledError` is always thrown. At most `CART_MAX_LINES` (200) lines.
   *
   * `language` names a refused product — the language the response is answered
   * in (`request.responseLanguage()`); absent, the record's own fallback chain.
   */
  addItems(
    actor: { customer?: CartCustomerContext; anonymousToken?: string },
    lines: readonly CartBatchLineInput[],
    options: {
      onLineError: 'throw' | 'report';
      onBelowMinimum?: 'report' | 'throw';
      workingBasket?: boolean;
      keepRepeatedLines?: boolean;
      language?: string;
    },
  ): Promise<CartWithItems & { outcomes: CartBatchLineOutcome[] }>;
  /**
   * Clear the customer's active cart and seed it with these lines, creating
   * the cart when there is none. The single-active-cart model admin
   * order-create, reorder and RFQ conversion all assume.
   *
   * `options.sourceQuoteRequestId` names the accepted Quote Request the lines
   * are the agreed lines of. It is **replaced on every call, absent included**:
   * a basket re-seeded from a reorder or an admin-created order is no longer
   * the quote's, so an omitted option clears what an earlier conversion left.
   * The id travels the road the agreed unit prices travel — on the basket, to
   * placement — and is dropped again when the buyer removes the last line.
   */
  replaceItemsForCustomer(
    ctx: CartCustomerContext,
    lines: readonly CartSeedLine[],
    options?: CartSeedOptions,
  ): Promise<CartWithItems & { unorderable?: CartSeedUnorderableLine[] }>;
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
 *
 * **Owner off:** the seam fails closed — resolving this port throws
 * `ModuleDisabledError` and the call answers 503 `MODULE_DISABLED`, so nothing
 * half-executes. Whether `carts` has an off state at all is its manifest's
 * `activation` to say, not this line's: a module declaring
 * `nonDeactivatable` never enters one.
 */
export interface CartQueryPort {
  listForCustomer(customerAccountId: string): Promise<CustomerCartsView>;
}
