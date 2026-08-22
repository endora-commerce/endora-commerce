/**
 * CorrectiveInvoicePort — feature 046 (US5, R6).
 *
 * Requests a corrective invoice ("faktura korygująca") from the invoices domain
 * for a settled return. The implementation creates an `invoices` row of kind
 * `correction`.
 *
 * All six declarations moved to `@endora-commerce/contracts` in feature 075's Phase P,
 * keeping their direction: `returns` still states the shape and `invoices`
 * still satisfies it. Re-exported here for the length of Phase P, which cuts
 * no consumer.
 */
export type {
  CorrectiveInvoiceLine,
  CorrectiveInvoiceInput,
  CorrectiveInvoiceIssued,
  CorrectiveInvoiceNotDue,
  CorrectiveInvoiceResult,
  CorrectiveInvoicePort,
} from '@endora-commerce/contracts';
