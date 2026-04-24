import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common.js';

/**
 * Invoices (FR-080). MVP produces proforma + VAT invoice PDFs. The binary
 * download happens at `GET /orders/:id/invoice`; this file defines only the
 * JSON metadata shape.
 */

export const invoiceKindSchema = z.enum(['proforma', 'invoice', 'correction']);
export type InvoiceKind = z.infer<typeof invoiceKindSchema>;

export const invoiceSchema = z.object({
  id: uuidSchema,
  orderId: uuidSchema,
  kind: invoiceKindSchema,
  number: z.string(),
  issuedAt: isoDateTimeSchema,
  currency: z.string().length(3),
  total: z.number().finite(),
  pdfAssetId: uuidSchema.nullable(),
  status: z.enum(['pending', 'ready', 'cancelled']),
});
export type Invoice = z.infer<typeof invoiceSchema>;
