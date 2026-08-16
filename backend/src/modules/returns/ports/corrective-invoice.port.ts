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

export interface CorrectiveInvoiceResult {
  invoiceId: string;
  number: string;
  status: 'pending' | 'ready' | 'cancelled';
}

export interface CorrectiveInvoicePort {
  createCorrection(input: CorrectiveInvoiceInput): Promise<CorrectiveInvoiceResult>;
}
