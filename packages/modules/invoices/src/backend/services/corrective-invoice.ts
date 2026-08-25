import { randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { Invoice } from '../entities/invoice.entity.js';
import { InvoiceLine } from '../entities/invoice-line.entity.js';
import type { InvoiceNumberGenerator } from './invoice-number-generator.js';
import type { InvoiceAuditRecorder, InvoiceDomainEventEmitter } from './invoice-service.js';
import { rethrowIfModuleDisabled } from '@endora-commerce/platform/kernel';
import { refuseDuplicateInvoiceNumber } from './duplicate-number-refusal.js';
// Feature 075, Phase C — `returns` states this shape and `invoices` satisfies
// it. Naming it from `@endora-commerce/contracts` keeps that direction while removing the
// import: the implementor no longer depends on the declarer's directory.
import type {
  CorrectiveInvoiceInput,
  CorrectiveInvoicePort,
  CorrectiveInvoiceResult,
} from '@endora-commerce/contracts';

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** What a corrected line inherits from the original line it credits. */
interface MirroredLine {
  /** The original line's VAT rate, as a fraction (0.23 for 23%). */
  rate: number;
  /** The original line's unit of measure, verbatim. */
  unit: string;
}

/**
 * What a corrective line inherits from the line it corrects (product ruling
 * 2026-08-16, issue #131 and #136.1): the VAT rate and the unit of measure,
 * never the rate in force on the correction date and never a constant.
 *
 * A line naming an order item the original never invoiced is refused —
 * inventing a rate for an added position is worse than refusing it.
 */
function mirrorFor(
  original: Invoice,
  byOrderItem: ReadonlyMap<string, MirroredLine>,
  orderItemId: string,
): MirroredLine {
  const mirrored = byOrderItem.get(orderItemId);
  if (!mirrored) {
    throw new HttpError(
      422,
      ERROR_CODES.VALIDATION_FAILED,
      'The corrected line has no counterpart on the original invoice, so its VAT rate is unknown.',
      { code: 'no_corrected_line', orderItemId, originalInvoiceId: original.id },
    );
  }
  return mirrored;
}

/**
 * Invoices-side implementation of the returns module's `CorrectiveInvoicePort`
 * (feature 046 / 047 US3). Creates an `invoices` row of kind `correction`:
 *   - number drawn from the correction counter (per channel/year) when a
 *     number generator is wired (falls back to a UUID-stamped number otherwise);
 *   - references the order's original VAT invoice;
 *   - snapshots the corrected lines into `invoice_lines`, each carrying the VAT
 *     rate and the unit of the original line it corrects (issues #131, #136.1);
 *   - caps the credited total at the original invoice gross (FR-020).
 *
 * **An order that was never invoiced gets no document** (product ruling
 * 2026-08-17, issue #135): there is nothing to correct, so the port answers
 * `{ issued: false, reason: 'order_not_invoiced' }` and the settlement records
 * the refund without a VAT-shaped document standing in for one that never
 * existed.
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

    // The same correction, asked for twice (D-91). A settlement attempts every
    // external effect before it writes any state, so a refusal from a later
    // step leaves a retryable case and the retry arrives here with the key of
    // the correction this call already issued. Answering with that document is
    // what keeps one return case to one credit note; the partial unique index
    // on the column is what keeps two concurrent retries to one as well.
    if (input.idempotencyKey) {
      const already = await em.findOne(Invoice, {
        correctionIdempotencyKey: input.idempotencyKey,
        kind: 'correction',
      });
      if (already) {
        return {
          issued: true,
          invoiceId: already.id,
          number: already.number,
          status: already.status,
        };
      }
    }

    const original = await em.findOne(Invoice, { orderId: input.orderId, kind: 'invoice' });
    // No original, no correction (#135). The caller records the refund on the
    // return case and the payment; only the VAT document is skipped, and the
    // reason is stated so the caller reports it rather than reporting nothing.
    if (!original) return { issued: false, reason: 'order_not_invoiced' };

    // A correction is denominated in the corrected document's currency: the cap
    // below compares the credited amount with the original gross, and two
    // amounts in different currencies do not compare (#136.2). Nothing produces
    // a cross-currency credit today — the return case inherits the order's
    // currency — so refusing costs nothing and closes the seam. Conversion is
    // deliberately not attempted here.
    if (input.currency !== original.currency) {
      throw new HttpError(
        422,
        ERROR_CODES.VALIDATION_FAILED,
        `A correction must be issued in the corrected invoice's currency (${original.currency}), not ${input.currency}.`,
        {
          code: 'correction_currency_mismatch',
          requestedCurrency: input.currency,
          originalCurrency: original.currency,
          originalInvoiceId: original.id,
        },
      );
    }

    // The correction belongs to the corrected document's channel — that is the
    // numbering series it continues.
    const salesChannelId = original.salesChannelId ?? null;

    // Cap the credited total at the original invoice gross (never credit more
    // than was invoiced).
    const originalGross = Number(original.total);
    const requested = round2(input.total);
    const credited = Math.min(requested, originalGross);

    // A correction mirrors the line it corrects. The link is `orderItemId`:
    // issuance snapshots it on every product line of the original, and a return
    // case item names the same order item.
    const mirrorByOrderItem = new Map<string, MirroredLine>();
    const originalLines = await em.find(InvoiceLine, { invoiceId: original.id });
    for (const l of originalLines) {
      if (l.orderItemId) mirrorByOrderItem.set(l.orderItemId, { rate: Number(l.taxRate), unit: l.unit });
    }
    // Resolve every line before the transaction opens, so a line that cannot
    // be mirrored refuses without having drawn a correction number.
    //
    // The credited amount is gross (a return credits what was paid, tax
    // included), so the net follows from the mirrored rate rather than the
    // other way round.
    let remaining = credited;
    const snapshots = input.lines.map((l, index) => {
      const mirrored = mirrorFor(original, mirrorByOrderItem, l.orderItemId);
      const gross = round2(Math.min(Math.max(l.amount, 0), remaining));
      remaining = round2(remaining - gross);
      const net = round2(gross / (1 + mirrored.rate));
      const qty = l.quantity || 1;
      return {
        ordinal: index + 1,
        orderItemId: l.orderItemId,
        name: l.productName,
        quantity: qty,
        rate: mirrored.rate,
        unit: mirrored.unit,
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
    // Captured out of the transaction: see the same note in `InvoiceService`.
    let drawnNumber: string | null = null;
    const runCorrection = async (tx: EntityManager): Promise<Invoice> => {
      // Draw from the correction counter (a real numbering series to continue)
      // whenever a generator and a channel are known.
      let number: string;
      if (this.numbers && salesChannelId) {
        number = await this.numbers().next(tx, 'correction', salesChannelId, issuedAt);
      } else {
        number = `KOR-${randomUUID().slice(0, 8).toUpperCase()}`;
      }
      drawnNumber = number;
      const inv = tx.create(Invoice, {
        orderId: input.orderId,
        salesChannelId,
        kind: 'correction',
        number,
        issuedAt,
        // The sale date is a fact about the sale, not about the correction
        // (product ruling 2026-08-17, #136.4): a credit note reports the date
        // the goods were delivered or the service performed, which is the
        // original's sale date. `issuedAt` above is the correction's own issue
        // date and keeps its meaning — do not collapse the two back together.
        saleDate: original.saleDate ?? issuedAt.toISOString().slice(0, 10),
        currency: input.currency,
        netTotal: netTotal.toFixed(2),
        taxTotal: taxTotal.toFixed(2),
        total: credited.toFixed(2),
        paidTotal: '0',
        originalInvoiceId: original.id,
        ...(input.idempotencyKey ? { correctionIdempotencyKey: input.idempotencyKey } : {}),
        ...(original.buyerSnapshot ? { buyerSnapshot: original.buyerSnapshot } : {}),
        ...(original.sellerSnapshot ? { sellerSnapshot: original.sellerSnapshot } : {}),
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
          // The unit comes from the original line, so a position invoiced in
          // `opak.` is credited in `opak.` and not in `szt.` (#136.1).
          unit: s.unit,
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
    };

    // Feature 078, D-95.2 — a correction draws from the same platform-wide
    // number space, so it is refused the same way. `rethrowIfModuleDisabled` is
    // the **first** line: `ModuleDisabledError` is an `HttpError`, so any other
    // test lets it through by accident rather than by decision, and the
    // callback reaches this module's own gated number generator.
    let invoice: Invoice;
    try {
      invoice = await em.transactional(runCorrection);
    } catch (err) {
      rethrowIfModuleDisabled(err);
      await refuseDuplicateInvoiceNumber({
        error: err,
        drawnNumber,
        salesChannelId,
        emFactory: this.emFactory,
      });
      throw err;
    }

    if (this.audit) {
      await this.audit
        .record({
          action: 'invoice.corrected',
          objectType: 'invoice',
          objectId: invoice.id,
          stateAfter: {
            number: invoice.number,
            orderId: input.orderId,
            originalInvoiceId: original.id,
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
      originalInvoiceId: original.id,
      orderId: input.orderId,
      salesChannelId,
    });

    return { issued: true, invoiceId: invoice.id, number: invoice.number, status: invoice.status };
  }
}
