import { randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { Invoice } from '../entities/invoice.entity.js';
import { InvoiceLine } from '../entities/invoice-line.entity.js';
import { Order } from '../../orders/entities/order.entity.js';
import type { InvoiceNumberGenerator } from './invoice-number-generator.js';
import type { InvoiceAuditRecorder, InvoiceDomainEventEmitter } from './invoice-service.js';
import type {
  CorrectiveInvoiceInput,
  CorrectiveInvoicePort,
  CorrectiveInvoiceResult,
} from '../../returns/ports/corrective-invoice.port.js';

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * The VAT rate a corrective line carries: the rate of the original line it
 * corrects (product ruling 2026-08-16), never the rate in force on the
 * correction date and never a constant.
 *
 * Without an original invoice there is no line to mirror. That is the
 * never-invoiced order the numbering fallback also recognises: the document is
 * not a correction of any VAT invoice, so it stays at zero. With an original,
 * a line naming an order item that original never invoiced is refused —
 * inventing a rate for an added position is worse than refusing it.
 */
function rateFor(
  original: Invoice | null,
  rateByOrderItem: ReadonlyMap<string, number>,
  orderItemId: string,
): number {
  if (!original) return 0;
  const rate = rateByOrderItem.get(orderItemId);
  if (rate === undefined) {
    throw new HttpError(
      422,
      ERROR_CODES.VALIDATION_FAILED,
      'The corrected line has no counterpart on the original invoice, so its VAT rate is unknown.',
      { code: 'no_corrected_line', orderItemId, originalInvoiceId: original.id },
    );
  }
  return rate;
}

/**
 * Invoices-side implementation of the returns module's `CorrectiveInvoicePort`
 * (feature 046 / 047 US3). Creates an `invoices` row of kind `correction`:
 *   - number drawn from the correction counter (per channel/year) when a
 *     number generator is wired (falls back to a UUID-stamped number otherwise);
 *   - references the order's original VAT invoice;
 *   - snapshots the corrected lines into `invoice_lines`, each carrying the VAT
 *     rate of the original line it corrects (issue #131);
 *   - caps the credited total at the original invoice gross (FR-020).
 */
export class CorrectiveInvoiceProvider implements CorrectiveInvoicePort {
  /**
   * `numbers` is an accessor for the same reason `emFactory` is: the generator
   * is a gated port, so resolving it is a question about `invoices`' effective
   * state whose answer changes while the process runs. A composition root that
   * resolved it while wiring this provider asked at boot, and an operator who
   * had switched `invoices` off took the backend down with it.
   */
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly numbers?: () => InvoiceNumberGenerator,
    private readonly audit?: InvoiceAuditRecorder,
    private readonly events?: InvoiceDomainEventEmitter,
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

    // A correction mirrors the VAT rate of the line it corrects, not the rate
    // in force on the correction date (product ruling 2026-08-16). The link is
    // `orderItemId`: issuance snapshots it on every product line of the
    // original, and a return case item names the same order item.
    const rateByOrderItem = new Map<string, number>();
    if (original) {
      const originalLines = await em.find(InvoiceLine, { invoiceId: original.id });
      for (const l of originalLines) {
        if (l.orderItemId) rateByOrderItem.set(l.orderItemId, Number(l.taxRate));
      }
    }
    // Resolve every line before the transaction opens, so a line that cannot
    // be mirrored refuses without having drawn a correction number.
    //
    // The credited amount is gross (a return credits what was paid, tax
    // included), so the net follows from the mirrored rate rather than the
    // other way round.
    let remaining = credited;
    const snapshots = input.lines.map((l, index) => {
      const rate = rateFor(original, rateByOrderItem, l.orderItemId);
      const gross = round2(Math.min(Math.max(l.amount, 0), remaining));
      remaining = round2(remaining - gross);
      const net = round2(gross / (1 + rate));
      const qty = l.quantity || 1;
      return {
        ordinal: index + 1,
        orderItemId: l.orderItemId,
        name: l.productName,
        quantity: qty,
        rate,
        net,
        gross,
        unitNetPrice: net / qty,
      };
    });

    // The document's own totals follow its lines: net + tax = the credited
    // gross, which stays the FR-020 cap.
    const taxTotal = round2(snapshots.reduce((sum, s) => sum + (s.gross - s.net), 0));
    const netTotal = round2(credited - taxTotal);

    const issuedAt = new Date();
    const invoice = await em.transactional(async (tx) => {
      // Draw from the correction counter only when there is an original invoice
      // (a real numbering series to continue). Corrections for never-invoiced
      // orders fall back to a unique UUID-stamped number.
      let number: string;
      if (this.numbers && salesChannelId && original) {
        number = await this.numbers().next(tx, 'correction', salesChannelId, issuedAt);
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
        netTotal: netTotal.toFixed(2),
        taxTotal: taxTotal.toFixed(2),
        total: credited.toFixed(2),
        paidTotal: '0',
        originalInvoiceId: original?.id ?? null,
        ...(original?.buyerSnapshot ? { buyerSnapshot: original.buyerSnapshot } : {}),
        ...(original?.sellerSnapshot ? { sellerSnapshot: original.sellerSnapshot } : {}),
        issuedBy: 'system',
        status: 'ready',
      });
      await tx.persistAndFlush(inv);

      // Snapshot the corrected lines (already capped at the credited remainder).
      for (const s of snapshots) {
        tx.create(InvoiceLine, {
          invoiceId: inv.id,
          ordinal: s.ordinal,
          name: s.name,
          unit: 'szt.',
          quantity: String(s.quantity),
          unitNetPrice: s.unitNetPrice.toFixed(4),
          taxRate: s.rate.toFixed(4),
          netValue: s.net.toFixed(2),
          grossValue: s.gross.toFixed(2),
          orderItemId: s.orderItemId,
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

    // Feature 059 — domain event for downstream consumers (e.g. KSeF submission).
    this.events?.emit('invoice.corrected.v1', {
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      invoiceId: invoice.id,
      originalInvoiceId: original?.id ?? null,
      orderId: input.orderId,
      salesChannelId,
    });

    return { invoiceId: invoice.id, number: invoice.number, status: invoice.status };
  }
}
