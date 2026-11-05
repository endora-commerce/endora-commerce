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

/**
 * The name `shopping_lists` stores on the default list it creates for every
 * customer (at registration, or on the first default-list read). It is data,
 * written in no language in particular (issue #751).
 */
export const SHOPPING_LIST_AUTO_DEFAULT_NAME = 'Default';

/**
 * Whether `list` is the default list the platform created and nobody renamed —
 * the list a storefront names in the shop language rather than by its stored
 * name (owner ruling on PR #760, issue #751).
 *
 * No column records "never renamed", so the marker is the default flag and the
 * stored name together, matched exactly. A list the customer renamed is theirs;
 * a list named `Default` that is not the default one is a name like any other.
 * The cost of not adding a column: a customer who types exactly `Default` as the
 * default list's name sees it in the shop language — the same word.
 */
export function isAutoDefaultShoppingList(list: { readonly name: string; readonly isDefault: boolean }): boolean {
  return list.isDefault && list.name === SHOPPING_LIST_AUTO_DEFAULT_NAME;
}

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
  reason: z.enum(['product_archived', 'variant_unavailable', 'product_not_found', 'below_minimum']),
  /** Feature 155 — on `below_minimum`: the minimum the line missed. */
  minimum: z.number().int().positive().optional(),
});
export type ConversionSkip = z.infer<typeof conversionSkipSchema>;

/** One line of the carts bridge's `droppedLines`, as a shopping-list append reports it. */
export interface ShoppingListDroppedLine {
  productId: string;
  /** The id: a skip carries no name, and the storefront resolves it. */
  productName: string;
  reason: 'below_minimum' | 'not_purchasable';
  minimum?: number;
}

/**
 * Feature 155 (FR-011, US4 #3) — a list conversion's skipped items as the carts
 * bridge's `droppedLines`, the uniform shape of the three conversions into a
 * cart. A line below a minimum says so, with the minimum it missed; every other
 * skip is `not_purchasable`. Pure — the one mapping both composition roots call,
 * so production and the test harness cannot answer an append differently.
 */
export function toCartDroppedLines(
  skipped: ReadonlyArray<Pick<ConversionSkip, 'productId' | 'minimum'> & { reason: string }>,
): ShoppingListDroppedLine[] {
  return skipped.map((skip) =>
    skip.reason === 'below_minimum'
      ? {
          productId: skip.productId,
          productName: skip.productId,
          reason: 'below_minimum',
          ...(skip.minimum !== undefined ? { minimum: skip.minimum } : {}),
        }
      : { productId: skip.productId, productName: skip.productId, reason: 'not_purchasable' },
  );
}

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
