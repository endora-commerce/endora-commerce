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

/**
 * The resolver's answer, as a union rather than a record with a `rate` that is
 * sometimes meaningless (issue #124).
 *
 * A **configured** 0% rate is a legitimate answer — zero-rated supplies exist —
 * so `rule` and `default` carry a `rate` that a caller may spend. "No rule
 * matched and no default is configured" is not an answer at all, so the `none`
 * arm carries **no `rate` field**: a caller has to narrow on `source` before it
 * can read a number, and therefore has to decide, in the open, what its own
 * surface does about it.
 *
 * `{ rate: 0, source: 'none' }` was the previous shape and it collapsed exactly
 * that distinction — every consumer read `.rate`, got `0`, and quoted a zero-VAT
 * figure nobody had configured onto documents that had already gone out.
 *
 * A third state, "the `taxes` module is absent", is deliberately **not** in this
 * union: absence is not a value. The port gate throws `MODULE_DISABLED` before a
 * resolution runs, so a caller never has to tell an absent owner from a silent
 * one.
 */
export const resolvedTaxSchema = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('rule'),
    rate: z.number().finite().nonnegative(),
    taxId: uuidSchema,
  }),
  z.object({
    source: z.literal('default'),
    rate: z.number().finite().nonnegative(),
    taxId: uuidSchema,
  }),
  z.object({ source: z.literal('none') }),
]);
export type ResolvedTax = z.infer<typeof resolvedTaxSchema>;
