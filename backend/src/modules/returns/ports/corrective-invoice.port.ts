/**
 * CorrectiveInvoicePort — feature 046 (US5, R6).
 *
 * Requests a corrective invoice ("faktura korygująca") from the invoices domain
 * for a settled return. The implementation creates an `invoices` row of kind
 * `correction`.
 */
export interface CorrectiveInvoiceInput {
  orderId: string;
  lines: Array<{ productName: string; quantity: number; amount: number }>;
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
