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
