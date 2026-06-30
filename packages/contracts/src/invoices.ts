import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common.js';

/**
 * Invoices (FR-080 + feature 047-invoices-module). Produces proforma, VAT
 * invoice, and corrective (credit-note) PDFs against orders. The binary
 * download happens at `GET /orders/:id/invoices/:invoiceId/pdf` (customer) and
 * `GET /admin/invoices/:id/pdf` (admin); this file defines the JSON metadata,
 * the seller/company settings shape, the line/VAT-summary snapshots, and the
 * WYSIWYG template metadata.
 */

export const invoiceKindSchema = z.enum(['proforma', 'invoice', 'correction']);
export type InvoiceKind = z.infer<typeof invoiceKindSchema>;

export const invoiceStatusSchema = z.enum(['pending', 'ready', 'cancelled']);
export type InvoiceStatus = z.infer<typeof invoiceStatusSchema>;

/** Whether the invoice email carries the PDF or a storefront download link. */
export const invoiceDeliveryModeSchema = z.enum(['attachment', 'link']);
export type InvoiceDeliveryMode = z.infer<typeof invoiceDeliveryModeSchema>;

/**
 * Seller (own company) data printed on every invoice. Stored as a JSON setting
 * (`invoices.seller.company_data`); the VAT/NIP lives in a separate
 * `invoices.seller.tax_id` setting but is surfaced together here at render time.
 */
export const sellerCompanyDataSchema = z.object({
  legalName: z.string().max(255),
  addressLine1: z.string().max(255),
  addressLine2: z.string().max(255).optional().default(''),
  postalCode: z.string().max(20),
  city: z.string().max(120),
  country: z.string().max(2).describe('ISO-3166-1 alpha-2 country code'),
  taxId: z.string().max(32).optional().default(''),
  bankName: z.string().max(160).optional().default(''),
  bankAccount: z.string().max(64).optional().default(''),
  swift: z.string().max(32).optional().default(''),
  email: z.string().max(320).optional().default(''),
  phone: z.string().max(32).optional().default(''),
});
export type SellerCompanyData = z.infer<typeof sellerCompanyDataSchema>;

/** Buyer (recipient) snapshot captured at issuance. */
export const invoiceBuyerSchema = z.object({
  name: z.string().max(255),
  taxId: z.string().max(32).optional().default(''),
  addressLine1: z.string().max(255).optional().default(''),
  addressLine2: z.string().max(255).optional().default(''),
  postalCode: z.string().max(20).optional().default(''),
  city: z.string().max(120).optional().default(''),
  country: z.string().max(2).optional().default(''),
});
export type InvoiceBuyer = z.infer<typeof invoiceBuyerSchema>;

/** One immutable invoice line, snapshotted from the order at issuance. */
export const invoiceLineSchema = z.object({
  ordinal: z.number().int().positive(),
  name: z.string().max(512),
  unit: z.string().max(32),
  quantity: z.number().finite(),
  unitNetPrice: z.number().finite(),
  taxRate: z.number().finite().describe('Fractional VAT rate, e.g. 0.23 for 23%'),
  netValue: z.number().finite(),
  grossValue: z.number().finite(),
});
export type InvoiceLine = z.infer<typeof invoiceLineSchema>;

/** Aggregation per VAT rate; reconciles with the invoice totals. */
export const vatSummaryRowSchema = z.object({
  taxRate: z.number().finite(),
  netTotal: z.number().finite(),
  vatAmount: z.number().finite(),
  grossTotal: z.number().finite(),
});
export type VatSummaryRow = z.infer<typeof vatSummaryRowSchema>;

export const invoiceSchema = z.object({
  id: uuidSchema,
  orderId: uuidSchema,
  salesChannelId: uuidSchema.nullable(),
  kind: invoiceKindSchema,
  number: z.string(),
  status: invoiceStatusSchema,
  currency: z.string().length(3),
  issuedAt: isoDateTimeSchema,
  saleDate: z.string().nullable(),
  paymentDueDate: z.string().nullable(),
  paymentMethod: z.string().nullable(),
  netTotal: z.number().finite(),
  taxTotal: z.number().finite(),
  grossTotal: z.number().finite(),
  paidTotal: z.number().finite(),
  amountDue: z.number().finite(),
  /** Legacy alias of grossTotal kept for back-compat with the original schema. */
  total: z.number().finite(),
  originalInvoiceId: uuidSchema.nullable(),
  templateId: uuidSchema.nullable(),
  pdfAssetId: uuidSchema.nullable(),
  ksefReferenceNumber: z.string().nullable(),
  ksefProcessedAt: isoDateTimeSchema.nullable(),
});
export type Invoice = z.infer<typeof invoiceSchema>;

export const invoiceDetailSchema = invoiceSchema.extend({
  /** Human-readable order business id (e.g. `ORD-…`); null if the order is gone. */
  orderBusinessId: z.string().nullable(),
  lines: z.array(invoiceLineSchema),
  vatSummary: z.array(vatSummaryRowSchema),
  seller: sellerCompanyDataSchema,
  buyer: invoiceBuyerSchema,
});
export type InvoiceDetail = z.infer<typeof invoiceDetailSchema>;

/** WYSIWYG (Puck) invoice PDF template metadata. */
export const invoiceTemplateSchema = z.object({
  id: uuidSchema,
  code: z.string().max(180),
  name: z.string().max(200),
  salesChannelId: uuidSchema.nullable(),
  languages: z.array(z.string()),
  active: z.boolean(),
  isSystem: z.boolean(),
  version: z.number().int(),
});
export type InvoiceTemplate = z.infer<typeof invoiceTemplateSchema>;

/** Body for issuing an invoice/proforma against an order. */
export const issueInvoiceRequestSchema = z.object({
  kind: z.enum(['invoice', 'proforma']).default('invoice'),
  saleDate: z.string().optional(),
  paymentDueDate: z.string().optional(),
});
export type IssueInvoiceRequest = z.infer<typeof issueInvoiceRequestSchema>;

/** Body for (re)sending the invoice email. */
export const sendInvoiceEmailRequestSchema = z.object({
  mode: invoiceDeliveryModeSchema.optional(),
});
export type SendInvoiceEmailRequest = z.infer<typeof sendInvoiceEmailRequestSchema>;
