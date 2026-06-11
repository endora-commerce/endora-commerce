import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common.js';

/**
 * Shopping list contracts (T202 / FR-031..FR-033).
 *
 * A shopping list is a per-customer, named collection of (product, variant?, quantity)
 * rows with optional notes. Two terminal actions:
 *   - convertToCart  — adds the (selected or all) items to the customer's active cart;
 *                      archived products are skipped and reported.
 *   - convertToRfq   — adds the (selected or all) items to the customer's draft RFQ;
 *                      same skip-and-report behaviour.
 *
 * Lists are private to the (customer, organization) pair today; sharing within an
 * organization is intentionally out of scope for the MVP — the entity has no
 * `isShared` column yet to keep the surface narrow.
 */

export const shoppingListItemSchema = z.object({
  id: uuidSchema,
  shoppingListId: uuidSchema,
  productId: uuidSchema,
  variantId: uuidSchema.nullable(),
  quantity: z.number().int().positive(),
  note: z.string().max(2000).nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type ShoppingListItem = z.infer<typeof shoppingListItemSchema>;

export const shoppingListSchema = z.object({
  id: uuidSchema,
  organizationId: z.string(),
  customerAccountId: uuidSchema,
  name: z.string().min(1).max(160),
  /** Whether this is the customer's default shopping list (exactly one per customer). */
  isDefault: z.boolean(),
  items: z.array(shoppingListItemSchema),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type ShoppingList = z.infer<typeof shoppingListSchema>;

/** Lightweight default-list view for the storefront header heart badge. */
export const defaultShoppingListSummarySchema = z.object({
  id: uuidSchema,
  name: z.string(),
  itemCount: z.number().int().nonnegative(),
});
export type DefaultShoppingListSummary = z.infer<typeof defaultShoppingListSummarySchema>;

// --- Requests --------------------------------------------------------------

export const createShoppingListRequestSchema = z.object({
  name: z.string().min(1).max(160),
});
export type CreateShoppingListRequest = z.infer<typeof createShoppingListRequestSchema>;

export const renameShoppingListRequestSchema = z
  .object({
    name: z.string().min(1).max(160),
  })
  .strict();
export type RenameShoppingListRequest = z.infer<typeof renameShoppingListRequestSchema>;

export const addShoppingListItemRequestSchema = z.object({
  productId: uuidSchema,
  variantId: uuidSchema.optional(),
  quantity: z.number().int().positive(),
  note: z.string().max(2000).optional(),
});
export type AddShoppingListItemRequest = z.infer<typeof addShoppingListItemRequestSchema>;

export const updateShoppingListItemRequestSchema = z
  .object({
    quantity: z.number().int().positive().optional(),
    note: z.string().max(2000).nullable().optional(),
  })
  .strict();
export type UpdateShoppingListItemRequest = z.infer<typeof updateShoppingListItemRequestSchema>;

/**
 * The convert request optionally narrows by item id; an empty (or missing)
 * `itemIds` array means "convert every item on the list".
 */
export const convertShoppingListRequestSchema = z
  .object({
    itemIds: z.array(uuidSchema).optional(),
  })
  .strict();
export type ConvertShoppingListRequest = z.infer<typeof convertShoppingListRequestSchema>;

// --- Responses -------------------------------------------------------------

/** Per-item skip note returned when conversion encounters an archived product. */
export const conversionSkipSchema = z.object({
  itemId: uuidSchema,
  productId: uuidSchema,
  reason: z.enum(['product_archived', 'variant_unavailable', 'product_not_found']),
});
export type ConversionSkip = z.infer<typeof conversionSkipSchema>;

export const convertToCartResponseSchema = z.object({
  shoppingListId: uuidSchema,
  added: z.number().int().nonnegative(),
  skipped: z.array(conversionSkipSchema),
});
export type ConvertToCartResponse = z.infer<typeof convertToCartResponseSchema>;

export const convertToRfqResponseSchema = z.object({
  shoppingListId: uuidSchema,
  rfqId: uuidSchema,
  added: z.number().int().nonnegative(),
  skipped: z.array(conversionSkipSchema),
});
export type ConvertToRfqResponse = z.infer<typeof convertToRfqResponseSchema>;
