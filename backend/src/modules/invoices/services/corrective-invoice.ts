import { randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Invoice } from '../entities/invoice.entity.js';
import { InvoiceLine } from '../entities/invoice-line.entity.js';
import { Order } from '../../orders/entities/order.entity.js';
import type { InvoiceNumberGenerator } from './invoice-number-generator.js';
import type { InvoiceAuditRecorder } from './invoice-service.js';
import type {
  CorrectiveInvoiceInput,
  CorrectiveInvoicePort,
  CorrectiveInvoiceResult,
} from '../../returns/ports/corrective-invoice.port.js';

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Invoices-side implementation of the returns module's `CorrectiveInvoicePort`
 * (feature 046 / 047 US3). Creates an `invoices` row of kind `correction`:
 *   - number drawn from the correction counter (per channel/year) when a
 *     number generator is wired (falls back to a UUID-stamped number otherwise);
 *   - references the order's original VAT invoice;
 *   - snapshots the corrected lines into `invoice_lines`;
 *   - caps the credited total at the original invoice gross (FR-020).
 */
export class CorrectiveInvoiceProvider implements CorrectiveInvoicePort {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly numbers?: InvoiceNumberGenerator,
    private readonly audit?: InvoiceAuditRecorder,
  ) {}

  async createCorrection(input: CorrectiveInvoiceInput): Promise<CorrectiveInvoiceResult> {
    const em = this.emFactory();
    const order = await em.findOne(Order, { id: input.orderId });
    const salesChannelId = order?.salesChannelId ?? null;
    const original = await em.findOne(Invoice, { orderId: input.orderId, kind: 'invoice' });

    // Cap the credited total at the original invoice gross (never credit more
    // than was invoiced).
    const originalGross = original ? Number(original.total) : Number.POSITIVE_INFINITY;
    const requested = round2(input.total);
    const credited = Math.min(requested, originalGross);

    const issuedAt = new Date();
    const invoice = await em.transactional(async (tx) => {
      // Draw from the correction counter only when there is an original invoice
      // (a real numbering series to continue). Corrections for never-invoiced
      // orders fall back to a unique UUID-stamped number.
      let number: string;
      if (this.numbers && salesChannelId && original) {
        number = await this.numbers.next(tx, 'correction', salesChannelId, issuedAt);
      } else {
        number = `KOR-${randomUUID().slice(0, 8).toUpperCase()}`;
      }
      const inv = tx.create(Invoice, {
        orderId: input.orderId,
        salesChannelId,
        kind: 'correction',
        number,
        issuedAt,
        saleDate: issuedAt.toISOString().slice(0, 10),
        currency: input.currency,
        netTotal: credited.toFixed(2),
        taxTotal: '0.00',
        total: credited.toFixed(2),
        paidTotal: '0',
        originalInvoiceId: original?.id ?? null,
        ...(original?.buyerSnapshot ? { buyerSnapshot: original.buyerSnapshot } : {}),
        ...(original?.sellerSnapshot ? { sellerSnapshot: original.sellerSnapshot } : {}),
        issuedBy: 'system',
        status: 'ready',
      });
      await tx.persistAndFlush(inv);

      // Snapshot corrected lines, capping each at the credited remainder.
      let remaining = credited;
      let ordinal = 0;
      for (const l of input.lines) {
        ordinal += 1;
        const amount = round2(Math.min(Math.max(l.amount, 0), remaining));
        remaining = round2(remaining - amount);
        const qty = l.quantity || 1;
        tx.create(InvoiceLine, {
          invoiceId: inv.id,
          ordinal,
          name: l.productName,
          unit: 'szt.',
          quantity: String(qty),
          unitNetPrice: (amount / qty).toFixed(4),
          taxRate: '0.0000',
          netValue: amount.toFixed(2),
          grossValue: amount.toFixed(2),
        });
      }
      await tx.flush();
      return inv;
    });

    if (this.audit) {
      await this.audit
        .record({
          action: 'invoice.corrected',
          objectType: 'invoice',
          objectId: invoice.id,
          stateAfter: {
            number: invoice.number,
            orderId: input.orderId,
            originalInvoiceId: original?.id ?? null,
            credited,
          },
        })
        .catch(() => undefined);
    }

    return { invoiceId: invoice.id, number: invoice.number, status: invoice.status };
  }
}
