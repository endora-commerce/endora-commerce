import { randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Invoice } from '../entities/invoice.entity.js';
import type {
  CorrectiveInvoiceInput,
  CorrectiveInvoicePort,
  CorrectiveInvoiceResult,
} from '../../returns/ports/corrective-invoice.port.js';

/**
 * Invoices-side implementation of the returns module's `CorrectiveInvoicePort`
 * (feature 046, R6). Creates an `invoices` row of kind `correction` in
 * `pending` status. PDF rendering reuses the existing invoice PDF builder and is
 * produced lazily on download, mirroring the other invoice kinds.
 */
export class CorrectiveInvoiceProvider implements CorrectiveInvoicePort {
  constructor(private readonly emFactory: () => EntityManager) {}

  async createCorrection(input: CorrectiveInvoiceInput): Promise<CorrectiveInvoiceResult> {
    const em = this.emFactory();
    const invoice = em.create(Invoice, {
      orderId: input.orderId,
      kind: 'correction',
      number: `COR-${randomUUID().slice(0, 8).toUpperCase()}`,
      currency: input.currency,
      total: input.total.toFixed(2),
      status: 'pending',
    });
    await em.persistAndFlush(invoice);
    return { invoiceId: invoice.id, number: invoice.number, status: invoice.status };
  }
}
