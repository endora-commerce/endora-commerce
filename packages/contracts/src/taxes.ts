import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common.js';

/**
 * Tax contracts (T128, T131 / FR-051).
 *
 * Each rule narrows by zero or more of:
 *   - `country`         (delivery country, ISO 3166-1 alpha-2)
 *   - `productType`     (the catalog Product.type — simple/variant/grouped/virtual)
 *   - `appliesToVatStatuses` (Organization.vatStatus values that match)
 *
 * Resolution picks the most specific matching rule (most narrowed
 * conditions). Ties fall back to the rule with `priority` highest;
 * when no rule matches, the default rule (if any) is used.
 */

const VAT_STATUS = z.enum(['vat_payer', 'vat_exempt', 'reverse_charge']);

export const taxSchema = z.object({
  id: uuidSchema,
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(160),
  rate: z.number().finite().nonnegative(),
  country: z.string().length(2).nullable(),
  productType: z.enum(['simple', 'configurable', 'grouped', 'bundle', 'virtual']).nullable(),
  appliesToVatStatuses: z.array(VAT_STATUS),
  isDefault: z.boolean(),
  priority: z.number().int(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Tax = z.infer<typeof taxSchema>;

export const upsertTaxRequestSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(160),
  rate: z.number().finite().nonnegative(),
  country: z.string().length(2).nullable().optional(),
  productType: z
    .enum(['simple', 'configurable', 'grouped', 'bundle', 'virtual'])
    .nullable()
    .optional(),
  appliesToVatStatuses: z.array(VAT_STATUS).optional(),
  isDefault: z.boolean().optional(),
  priority: z.number().int().optional(),
});

export const taxResolutionInputSchema = z.object({
  country: z.string().length(2),
  productType: z.enum(['simple', 'configurable', 'grouped', 'bundle', 'virtual']),
  vatStatus: VAT_STATUS,
});
export type TaxResolutionInput = z.infer<typeof taxResolutionInputSchema>;

export const resolvedTaxSchema = z.object({
  rate: z.number().finite().nonnegative(),
  taxId: uuidSchema.nullable(),
  source: z.enum(['rule', 'default', 'none']),
});
export type ResolvedTax = z.infer<typeof resolvedTaxSchema>;
