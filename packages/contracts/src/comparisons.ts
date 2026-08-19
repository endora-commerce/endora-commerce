import { z } from 'zod';
import { uuidSchema, moneySchema, multilingualStringSchema } from './common.js';
import { attributeValueTypeSchema } from './catalog.js';

// @b2b/contracts — Compare module contracts (feature 007).
//
// Per Constitution V, this file is the source of truth for every Zod schema
// crossing the comparisons HTTP boundary; TS types are inferred via z.infer.
//
// US1 schemas (this file): owner-facing CRUD payloads and the
// `ComparisonOwnerView` response. US2 (recipient view), US4 (PDF export),
// and US5 (admin overview) extend this file in their respective phases.

// ---------------------------------------------------------------------------
// Constants used by storefront + admin clients.
// ---------------------------------------------------------------------------

export const COMPARE_DISPLAY_MODES = ['all', 'common', 'differences'] as const;
export const COMPARE_MAX_PRODUCTS_LOWER_BOUND = 1;
export const COMPARE_MAX_PRODUCTS_UPPER_BOUND = 16;

// ---------------------------------------------------------------------------
// Display mode and per-attribute row class.
// ---------------------------------------------------------------------------

export const comparisonDisplayModeSchema = z.enum(COMPARE_DISPLAY_MODES);
export type ComparisonDisplayMode = z.infer<typeof comparisonDisplayModeSchema>;

/**
 * Server-computed classification per attribute row, per research.md R-6:
 *   - `'common'`     — every product carries the same value (set-equal for
 *                      multi-value, ===-equal for scalars).
 *   - `'different'`  — at least one product disagrees, OR at least one
 *                      product has no value at all.
 */
export const comparisonRowClassSchema = z.enum(['common', 'different']);
export type ComparisonRowClass = z.infer<typeof comparisonRowClassSchema>;

// ---------------------------------------------------------------------------
// Per-product card (always-on row of the comparison page / PDF).
// ---------------------------------------------------------------------------

export const comparisonProductSummarySchema = z.object({
  id: uuidSchema,
  sku: z.string(),
  name: multilingualStringSchema,
  slug: z.string(),
  type: z.enum(['simple', 'configurable', 'grouped', 'bundle', 'virtual']),
  /**
   * Resolved base image (asset URL); null when the product has no
   * `gallery_item_labels.label='base_image'` row or its asset cannot be
   * resolved. The PDF renderer renders a placeholder when null.
   */
  primaryAssetUrl: z.string().url().nullable(),
  /**
   * Price in the viewer's sales-channel currency. Null when the product
   * has no resolvable price for the channel (e.g. shared-link recipient
   * on a channel where the product is not listed).
   */
  price: moneySchema.nullable(),
  /**
   * False when the product is not currently sellable in the viewer's
   * channel — archived, channel-restricted, or otherwise refused. The
   * column still renders, but the *Add to cart* control is disabled.
   */
  available: z.boolean(),
  addedAt: z.string().datetime(),
});
export type ComparisonProductSummary = z.infer<typeof comparisonProductSummarySchema>;

// ---------------------------------------------------------------------------
// Body row of the comparison table (one per `comparable` attribute).
// ---------------------------------------------------------------------------

export const comparisonAttributeRowSchema = z.object({
  key: z.string(),
  label: multilingualStringSchema,
  valueType: attributeValueTypeSchema,
  /**
   * One entry per product in the same column-order as `products`. Strings
   * are pre-formatted by the server for display; multi-value attributes
   * are joined with `', '`. `null` represents "no value" — the storefront
   * renders it as `—` (per spec edge case "Missing values"). Per R-6,
   * any `null` causes the row to be classified as `'different'`.
   */
  values: z.array(z.string().nullable()),
  rowClass: comparisonRowClassSchema,
});
export type ComparisonAttributeRow = z.infer<typeof comparisonAttributeRowSchema>;

/**
 * Whose prices the columns carry.
 *
 * The viewer's identity decides the figures, always: `organization` means they
 * were resolved against the reader's own price lists, `channel` that they are
 * the sales channel's public ones. A share token decides *which products* are
 * in a comparison and never *which prices* are shown, so sender and recipient
 * legitimately see different numbers on one link — and a reader who cannot tell
 * which they are looking at cannot act on either.
 */
export const comparisonPricedForSchema = z.enum(['organization', 'channel']);
export type ComparisonPricedFor = z.infer<typeof comparisonPricedForSchema>;

// ---------------------------------------------------------------------------
// Full owner-facing read response.
// ---------------------------------------------------------------------------

export const comparisonOwnerViewSchema = z.object({
  id: uuidSchema,
  shareToken: z.string().min(8).max(32),
  displayMode: comparisonDisplayModeSchema,
  /** Resolved `compare.max_products` for the owner's sales channel. */
  maxProducts: z.number().int().positive(),
  products: z.array(comparisonProductSummarySchema),
  comparableAttributes: z.array(comparisonAttributeRowSchema),
  /** Whose prices the `products[].price` figures are. */
  pricedFor: comparisonPricedForSchema,
  /**
   * How many products the comparison holds that this viewer may not see.
   * Zero for almost every read; non-zero for a recipient the owner's
   * restricted products are not disclosed to, and for an owner whose own
   * product was restricted after they added it. The count is what lets a
   * shorter table say so instead of being silently shorter.
   */
  hiddenProductCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ComparisonOwnerView = z.infer<typeof comparisonOwnerViewSchema>;

export const comparisonOwnerResponseSchema = z.object({
  data: comparisonOwnerViewSchema,
});
export type ComparisonOwnerResponse = z.infer<typeof comparisonOwnerResponseSchema>;

// ---------------------------------------------------------------------------
// Mutation inputs.
// ---------------------------------------------------------------------------

export const comparisonAddProductInputSchema = z.object({
  productId: uuidSchema,
});
export type ComparisonAddProductInput = z.infer<typeof comparisonAddProductInputSchema>;

export const comparisonSetDisplayModeInputSchema = z.object({
  displayMode: comparisonDisplayModeSchema,
});
export type ComparisonSetDisplayModeInput = z.infer<typeof comparisonSetDisplayModeInputSchema>;

// ---------------------------------------------------------------------------
// US2 — recipient (share-token) view.
// ---------------------------------------------------------------------------

/**
 * Recipient-side projection. Same column shape as the owner view minus
 * `maxProducts` (the recipient cannot mutate the comparison, so the cap
 * is irrelevant) plus `meta.viewerIsOwner` so the storefront knows
 * whether to render owner-only affordances (Add to cart, Remove,
 * Delete, Copy share link).
 */
export const comparisonSharedViewSchema = z.object({
  id: uuidSchema,
  shareToken: z.string().min(8).max(32),
  displayMode: comparisonDisplayModeSchema,
  products: z.array(comparisonProductSummarySchema),
  comparableAttributes: z.array(comparisonAttributeRowSchema),
  /**
   * Whose prices these are — the recipient's own, or the channel's. The
   * sender's are never among the answers: the token carries the products, not
   * a pricing identity.
   */
  pricedFor: comparisonPricedForSchema,
  /**
   * How many of the sender's products this recipient may not see. The token
   * grants access to the comparison, never to what is in it, so a recipient's
   * table is the sender's minus whatever the sender's organisation alone is
   * entitled to — and it says how much is missing rather than being quietly
   * shorter.
   */
  hiddenProductCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ComparisonSharedView = z.infer<typeof comparisonSharedViewSchema>;

export const comparisonSharedResponseSchema = z.object({
  data: comparisonSharedViewSchema,
  meta: z.object({
    viewerIsOwner: z.boolean(),
  }),
});
export type ComparisonSharedResponse = z.infer<typeof comparisonSharedResponseSchema>;

// ---------------------------------------------------------------------------
// US5 — admin overview (read-only).
// ---------------------------------------------------------------------------

export const comparisonAdminOwnerSchema = z.object({
  kind: z.enum(['customer', 'anonymous']),
  customerAccountId: uuidSchema.nullable(),
  /** Human-readable identifier for the list (email or display name). */
  email: z.string().nullable(),
  /** The opaque cookie token; null for authenticated owners. */
  anonymousToken: z.string().nullable(),
});
export type ComparisonAdminOwner = z.infer<typeof comparisonAdminOwnerSchema>;

export const comparisonAdminSalesChannelSchema = z.object({
  id: uuidSchema,
  code: z.string(),
});

export const comparisonAdminListItemSchema = z.object({
  id: uuidSchema,
  shareToken: z.string(),
  owner: comparisonAdminOwnerSchema,
  salesChannel: comparisonAdminSalesChannelSchema,
  displayMode: comparisonDisplayModeSchema,
  productCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ComparisonAdminListItem = z.infer<typeof comparisonAdminListItemSchema>;

export const comparisonAdminListQuerySchema = z.object({
  salesChannelId: uuidSchema.optional(),
  customerAccountId: uuidSchema.optional(),
  ownerType: z.enum(['customer', 'anonymous']).optional(),
  createdAfter: z.string().datetime().optional(),
  createdBefore: z.string().datetime().optional(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
});
export type ComparisonAdminListQuery = z.infer<typeof comparisonAdminListQuerySchema>;

export const comparisonAdminListResponseSchema = z.object({
  data: z.array(comparisonAdminListItemSchema),
  meta: z.object({
    limit: z.number().int().positive(),
    nextCursor: z.string().nullable(),
  }),
});
export type ComparisonAdminListResponse = z.infer<typeof comparisonAdminListResponseSchema>;

/**
 * Admin detail — same shape the storefront owner sees, plus the admin
 * metadata block (owner identity, sales channel, raw shareToken). The
 * detail endpoint renders prices in the comparison's RECORDED channel
 * (the creator's), not the admin's preferred channel — so a support
 * investigation matches what the customer reported.
 */
export const comparisonAdminDetailSchema = z.object({
  id: uuidSchema,
  shareToken: z.string(),
  owner: comparisonAdminOwnerSchema,
  salesChannel: comparisonAdminSalesChannelSchema,
  displayMode: comparisonDisplayModeSchema,
  products: z.array(comparisonProductSummarySchema),
  comparableAttributes: z.array(comparisonAttributeRowSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ComparisonAdminDetail = z.infer<typeof comparisonAdminDetailSchema>;
