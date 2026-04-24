import { z } from 'zod';
import { uuidSchema } from './common.js';

/**
 * Tax definitions (FR-080). Each rule matches by country + productType +
 * optional VAT status of the buyer.
 */

export const taxSchema = z.object({
  id: uuidSchema,
  code: z.string(),
  name: z.string(),
  country: z.string().length(2),
  productType: z.string().optional(),
  rate: z.number().finite().nonnegative(),
  appliesToVatStatus: z
    .array(z.enum(['vat_payer', 'vat_exempt', 'reverse_charge']))
    .optional(),
});
export type Tax = z.infer<typeof taxSchema>;

export const createTaxRequestSchema = taxSchema.omit({ id: true });
export type CreateTaxRequest = z.infer<typeof createTaxRequestSchema>;
