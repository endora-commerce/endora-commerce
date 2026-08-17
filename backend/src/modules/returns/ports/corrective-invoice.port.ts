/**
 * CorrectiveInvoicePort — feature 046 (US5, R6).
 *
 * Requests a corrective invoice ("faktura korygująca") from the invoices domain
 * for a settled return. The implementation creates an `invoices` row of kind
 * `correction`.
 */
export interface CorrectiveInvoiceLine {
  /**
   * The order item this line credits. It is the link back to the line of the
   * original invoice being corrected: issuance snapshots `orderItemId` on every
   * product line, and a return case item carries the same order item, so the
   * corrected line's VAT rate can be mirrored rather than assumed (issue #131).
   */
  orderItemId: string;
  productName: string;
  quantity: number;
  /** Credited amount for this line, gross (as paid, including its tax). */
  amount: number;
}

export interface CorrectiveInvoiceInput {
  orderId: string;
  lines: CorrectiveInvoiceLine[];
  /** Credited total, gross. */
  total: number;
  currency: string;
}

/** A correction was issued: the document that credits the original invoice. */
export interface CorrectiveInvoiceIssued {
  issued: true;
  invoiceId: string;
  number: string;
  status: 'pending' | 'ready' | 'cancelled';
}

/**
 * No correction was due, with the reason (#135).
 *
 * The settlement caller cannot know whether the order was ever invoiced — the
 * invoices module can, and answers here. `order_not_invoiced` is the only
 * reason today: with no original there is no VAT document to correct, so a
 * correction would be a number, a zero rate and an empty seller/buyer snapshot
 * standing in for a document that never existed.
 */
export interface CorrectiveInvoiceNotDue {
  issued: false;
  reason: 'order_not_invoiced';
}

export type CorrectiveInvoiceResult = CorrectiveInvoiceIssued | CorrectiveInvoiceNotDue;

export interface CorrectiveInvoicePort {
  createCorrection(input: CorrectiveInvoiceInput): Promise<CorrectiveInvoiceResult>;
}
