import { z } from 'zod';
import { isoDateTimeSchema, moneySchema, uuidSchema } from './common.js';

/**
 * Pricing contracts (T127, T130 / FR-050).
 *
 * Customer-level, customer-group-level, and quantity-tiered pricing, plus
 * per-category percentage / fixed-amount adjustments.
 */

const CURRENCY = z.string().regex(/^[A-Z]{3}$/, 'ISO 4217 currency code');
const POSITIVE_INT = z.number().int().positive();

// --- Customer Group ---------------------------------------------------------

export const customerGroupSchema = z.object({
  id: uuidSchema,
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(160),
  description: z.string().max(1000).nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type CustomerGroup = z.infer<typeof customerGroupSchema>;

export const upsertCustomerGroupRequestSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(160),
  description: z.string().max(1000).nullable().optional(),
});

// --- Price List -------------------------------------------------------------

export const priceListSchema = z.object({
  id: uuidSchema,
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(160),
  currency: CURRENCY,
  isDefault: z.boolean(),
  priority: z.number().int(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type PriceList = z.infer<typeof priceListSchema>;

export const upsertPriceListRequestSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(160),
  currency: CURRENCY,
  isDefault: z.boolean().optional(),
  priority: z.number().int().optional(),
});

// --- Price List Item --------------------------------------------------------
// Discriminated by `mode`. Three flavours:
//   1. fixed_unit       — set the unit price for a product (or variant) outright;
//                         volume tiers come from `minQuantity`.
//   2. percentage_off   — subtract X% from the base price for products in a category.
//   3. amount_off       — subtract a fixed amount from the base price for a category.

export const priceListItemModeSchema = z.enum([
  'fixed_unit',
  'percentage_off',
  'amount_off',
]);
export type PriceListItemMode = z.infer<typeof priceListItemModeSchema>;

export const priceListItemSchema = z.object({
  id: uuidSchema,
  priceListId: uuidSchema,
  mode: priceListItemModeSchema,
  productId: uuidSchema.nullable(),
  variantId: uuidSchema.nullable(),
  categoryId: uuidSchema.nullable(),
  /** For `fixed_unit`: required minimum cart quantity (default 1). Ignored for adjustments. */
  minQuantity: POSITIVE_INT,
  /** Unit price in the parent price list's currency (only for `fixed_unit`). */
  unitPrice: z.number().finite().nonnegative().nullable(),
  /** Percent off (0..100) for `percentage_off`, money for `amount_off`. */
  adjustmentValue: z.number().finite().nonnegative().nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type PriceListItem = z.infer<typeof priceListItemSchema>;

export const createPriceListItemRequestSchema = z
  .object({
    mode: priceListItemModeSchema,
    productId: uuidSchema.nullable().optional(),
    variantId: uuidSchema.nullable().optional(),
    categoryId: uuidSchema.nullable().optional(),
    minQuantity: POSITIVE_INT.optional(),
    unitPrice: z.number().finite().nonnegative().nullable().optional(),
    adjustmentValue: z.number().finite().nonnegative().nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.mode === 'fixed_unit') {
      if (value.productId == null) {
        ctx.addIssue({
          code: 'custom',
          message: 'fixed_unit items require productId',
          path: ['productId'],
        });
      }
      if (value.unitPrice == null) {
        ctx.addIssue({
          code: 'custom',
          message: 'fixed_unit items require unitPrice',
          path: ['unitPrice'],
        });
      }
    } else {
      if (value.categoryId == null) {
        ctx.addIssue({
          code: 'custom',
          message: 'percentage_off / amount_off items require categoryId',
          path: ['categoryId'],
        });
      }
      if (value.adjustmentValue == null) {
        ctx.addIssue({
          code: 'custom',
          message: 'percentage_off / amount_off items require adjustmentValue',
          path: ['adjustmentValue'],
        });
      }
      if (value.mode === 'percentage_off' && value.adjustmentValue != null) {
        if (value.adjustmentValue < 0 || value.adjustmentValue > 100) {
          ctx.addIssue({
            code: 'custom',
            message: 'percentage_off adjustmentValue must be between 0 and 100',
            path: ['adjustmentValue'],
          });
        }
      }
    }
  });

// --- Price List Assignment --------------------------------------------------
// Either `organizationId` (customer-specific list), `customerGroupId` (group
// list), or `isDefault=true` (everyone). Optional `salesChannelId` further
// scopes the assignment.

export const priceListAssignmentSchema = z.object({
  id: uuidSchema,
  priceListId: uuidSchema,
  organizationId: uuidSchema.nullable(),
  customerGroupId: uuidSchema.nullable(),
  salesChannelId: uuidSchema.nullable(),
  isDefault: z.boolean(),
  priority: z.number().int(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type PriceListAssignment = z.infer<typeof priceListAssignmentSchema>;

export const createPriceListAssignmentRequestSchema = z
  .object({
    organizationId: uuidSchema.nullable().optional(),
    customerGroupId: uuidSchema.nullable().optional(),
    salesChannelId: uuidSchema.nullable().optional(),
    isDefault: z.boolean().optional(),
    priority: z.number().int().optional(),
  })
  .superRefine((value, ctx) => {
    const targets = [
      value.organizationId ? 'organizationId' : null,
      value.customerGroupId ? 'customerGroupId' : null,
      value.isDefault ? 'isDefault' : null,
    ].filter((t): t is string => t !== null);
    if (targets.length !== 1) {
      ctx.addIssue({
        code: 'custom',
        message:
          'exactly one of organizationId, customerGroupId, or isDefault=true must be set',
        path: ['organizationId'],
      });
    }
  });

// --- Resolution result ------------------------------------------------------

export const resolvedPriceSchema = z.object({
  unitPrice: moneySchema,
  basePrice: moneySchema,
  source: z.enum(['list', 'base']),
  priceListId: uuidSchema.nullable(),
  appliedItemId: uuidSchema.nullable(),
});
export type ResolvedPrice = z.infer<typeof resolvedPriceSchema>;
