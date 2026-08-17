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

/**
 * Why the invoice e-mail did not go out (issue #103).
 *
 * The dispatcher has answered these seven since #103; they only ever reached a
 * log. They are part of the API shape now because the operator who clicked
 * "issue" is the one person who can act on them (issue #149).
 */
export const invoiceEmailNotSentReasonSchema = z.enum([
  /** No transactional sender is wired in this composition. */
  'no_sender',
  /** The invoice, or the order behind it, could not be loaded. */
  'invoice_not_found',
  /** No recipient address could be resolved for the order. */
  'no_recipient',
  /** The operator switched the `invoice_issued` e-mail off. */
  'deactivated',
  /** No mailer is wired behind the sender. */
  'no_transport',
  /** No `invoice_issued` template exists yet. */
  'no_definition',
  /** The send raised, and the issuance was kept (FR-029). */
  'failed',
]);
export type InvoiceEmailNotSentReason = z.infer<typeof invoiceEmailNotSentReasonSchema>;

/**
 * `POST /admin/invoices/:id/send-email` — the answer to an explicitly requested
 * re-send. The route has carried it since issue #103; it is written down here
 * because both admin surfaces used to announce "sent" over it (issue #149).
 */
export const sendInvoiceEmailResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), reason: invoiceEmailNotSentReasonSchema }),
]);
export type SendInvoiceEmailResult = z.infer<typeof sendInvoiceEmailResultSchema>;

/**
 * What became of the send-on-issue e-mail an issuance triggered (issue #149).
 *
 * Three answers, and the middle one is the point: `not_requested` means the
 * operator switched send-on-issue off for this channel, which is a configured
 * choice and not a delivery that failed. Reading "no e-mail" out of a missing
 * field cannot tell those apart, which is how an issuance whose notification was
 * suppressed came back as a bare 201 saying "issued".
 *
 * A suppressed or failed e-mail never invalidates the issuance (FR-029): the
 * invoice is a legal document that was drawn, numbered and stored, so this
 * rides **alongside** a 201 rather than turning it into an error.
 */
export const issueInvoiceEmailOutcomeSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('sent') }),
  z.object({ status: z.literal('not_requested') }),
  z.object({ status: z.literal('not_sent'), reason: invoiceEmailNotSentReasonSchema }),
]);
export type IssueInvoiceEmailOutcome = z.infer<typeof issueInvoiceEmailOutcomeSchema>;

/**
 * `POST /admin/orders/:orderId/invoices` — the issued document plus what became
 * of its notification. `email` is a sibling of `data`, the way `pagination` is
 * on a collection: it describes the action, not the invoice, and the invoice
 * detail shape stays identical on every surface that reads one.
 */
export const issueInvoiceResponseSchema = z.object({
  data: invoiceDetailSchema,
  email: issueInvoiceEmailOutcomeSchema,
});
export type IssueInvoiceResponse = z.infer<typeof issueInvoiceResponseSchema>;

// ---------------------------------------------------------------------------
// --- ports -----------------------------------------------------------------
//
// The in-process surface `invoices` publishes to the two modules that read it
// (feature 075, Phase P) — `orders` and `ksef`.
// ---------------------------------------------------------------------------

/**
 * An invoice as it crosses a module boundary — a plain shape, never the ORM
 * entity (FR-011). Every money column stays a decimal string: these are VAT
 * documents, and a `number` cannot round-trip one.
 */
export interface InvoiceRecord {
  id: string;
  orderId: string;
  salesChannelId: string | null;
  kind: InvoiceKind;
  number: string;
  issuedAt: Date;
  /** ISO date (no time) — the tax point, which is not the issue timestamp. */
  saleDate: string | null;
  paymentDueDate: string | null;
  paymentMethod: string | null;
  currency: string;
  netTotal: string | null;
  taxTotal: string | null;
  total: string;
  paidTotal: string;
  /** Set on a `correction`: the document this one credits. */
  originalInvoiceId: string | null;
  templateId: string | null;
  ksefReferenceNumber: string | null;
  ksefProcessedAt: Date | null;
  issuedBy: string | null;
  pdfAssetId: string | null;
  status: InvoiceStatus;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Container name: `invoiceReadPort`. Owner: `invoices`.
 *
 * Four inbound sites read the entity: `orders` listing an order's invoices on
 * the order screen and again at cancellation, and `ksef` resolving the invoice
 * behind a submission — twice, once from its entity file, where the read is a
 * `@TransitivelyScoped` tenancy classification rather than a query and needs
 * its own remedy (R-05).
 *
 * The seller and buyer snapshots are deliberately absent. They are the
 * document's own frozen copy of two other modules' rows; no cross-module
 * caller reads them, and publishing them would invite one to.
 */
export interface InvoiceReadPort {
  findById(id: string): Promise<InvoiceRecord | null>;
  findByIds(ids: readonly string[]): Promise<InvoiceRecord[]>;
  /** An order's invoices, newest first. */
  listForOrder(orderId: string): Promise<InvoiceRecord[]>;
  /** Several orders' invoices at once, for a list screen. */
  listForOrders(orderIds: readonly string[]): Promise<InvoiceRecord[]>;
}

/** One line of a bulk PDF — enough to identify the document it renders. */
export interface InvoicePdfLine {
  invoiceNumber: string;
  total: string;
  currency: string;
}

/**
 * Container name: `invoicePdfPort`. Owner: `invoices`.
 *
 * **A port, although the two builders behind it are pure**, and the exception
 * is worth stating because FR-013's test does not settle it. "Does switching
 * the owner off change the answer?" asks whether the *bytes* would differ, and
 * they would not. The question that decides this one is Constitution XVII's:
 * should the platform produce an invoice document for a business that has
 * switched invoicing off? An order screen offering an invoice PDF is a surface
 * the module owns, and a surface a switched-off module owns must disappear.
 *
 * `hashPassword` is the contrast, and it is the right one: it is
 * platform-generic, reachable from five modules and the dev seed, and nobody
 * would call hashing "an `auth` surface". A VAT document is an `invoices`
 * surface.
 *
 * Returns `Uint8Array` rather than Node's `Buffer` so this package stays free
 * of Node types — it is imported by the admin SPA and the storefront too.
 */
export interface InvoicePdfPort {
  renderMinimal(params: { invoiceNumber: string; total: string; currency: string }): Uint8Array;
  renderBulk(invoices: readonly InvoicePdfLine[]): Uint8Array;
}
