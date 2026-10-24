import { randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  compareDecimals,
  allocateHalfUp,
  decimalDifference,
  decimalProduct,
  moneyDifference,
  moneySum,
  netForGrossAtRate,
  netFromGrossHalfUp,
  quotientHalfUp,
  roundHalfUp,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { Invoice } from '../entities/invoice.entity.js';
import { InvoiceLine } from '../entities/invoice-line.entity.js';
import type { InvoiceNumberGenerator } from './invoice-number-generator.js';
import type { InvoiceAuditRecorder, InvoiceDomainEventEmitter } from './invoice-service.js';
import {
  shouldHoldForVendorNumber,
  type LedgerNumberingLookup,
} from './vendor-number-hold.js';
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

/** The smaller of two decimals. */
function minDecimal(a: string, b: string): string {
  return compareDecimals(a, b) <= 0 ? a : b;
}

/** One corrected line's amounts, as the `invoice_lines` columns store them. */
export interface CorrectionLineAmounts {
  gross: string;
  net: string;
  unitNetPrice: string;
}

/** A correction asked to credit more than its lines add up to (review of PR #423). */
export class CorrectionTotalExceedsLinesError extends Error {
  constructor(
    readonly total: string,
    readonly linesTotal: string,
  ) {
    super(`The correction total ${total} exceeds the sum of its lines, ${linesTotal}.`);
    this.name = 'CorrectionTotalExceedsLinesError';
  }
}

/** A line already credited by an earlier correction of the same invoice, or a line of that invoice. */
export interface CreditedLine {
  orderItemId: string;
  rate: string;
  net: string;
  gross: string;
}

export interface CorrectionInput {
  /** The gross the correction credits. Refused when above the sum of `lines`. */
  total: string | number;
  /** The corrected invoice's gross. */
  originalGross: string;
  /** What earlier corrections of the same invoice already credited, gross. */
  creditedBefore?: string;
  /**
   * Whether the corrected invoice was issued under the per-rate VAT method
   * (it stored its summary); otherwise it was issued before 0.108.0 and is
   * credited line by line, in proportion to what each line was invoiced.
   */
  perRate: boolean;
  /** The corrected invoice's lines — read for an invoice issued before the per-rate method. */
  originalLines: readonly CreditedLine[];
  /** The lines of earlier corrections of the same invoice. */
  earlierLines: readonly CreditedLine[];
  lines: ReadonlyArray<{ amount: string | number; quantity: number; rate: string | number; orderItemId: string }>;
}

/**
 * A correction's amounts, in exact decimal arithmetic, under the invoice's VAT
 * method and **cumulatively** over the corrections of one invoice (issue #417,
 * owner ruling of 2026-10-24, review of PR #423).
 *
 * The credited amount is gross (a return credits what was paid, tax included),
 * capped at what remains of the invoice after earlier corrections (FR-020),
 * and shared out over the lines in order; a total above the lines' sum is
 * refused ({@link CorrectionTotalExceedsLinesError}) rather than booked as a
 * net with no VAT and no line.
 *
 * What the invoice charged is split into groups: a VAT rate of an invoice
 * issued per rate, a line of one issued before 0.108.0. For each group, the
 * correction credits the net of everything credited so far, this correction
 * included, minus the nets earlier corrections already credited — per rate the
 * net `netForGrossAtRate` gives the cumulative gross (`N` with
 * `N + round(N × rate) = gross`), per line the invoiced line net in proportion
 * to the cumulative gross. The differences telescope: all corrections together
 * credit exactly the invoiced net and VAT. A group's net is shared over the
 * correction's lines in it in proportion to their gross (`allocateHalfUp`).
 */
export function correctionAmounts(input: CorrectionInput): {
  credited: string;
  netTotal: string;
  taxTotal: string;
  lines: CorrectionLineAmounts[];
  /** The correction's per-rate summary, as `invoices.vat_summary` stores it. */
  vatSummary: Array<{ taxRate: string; netTotal: string; vatAmount: string; grossTotal: string }>;
} {
  const asked = input.lines.map((l) => (compareDecimals(l.amount, 0) < 0 ? '0.00' : roundHalfUp(l.amount)));
  const linesTotal = moneySum(asked);
  const total = roundHalfUp(input.total);
  if (compareDecimals(total, linesTotal) > 0) throw new CorrectionTotalExceedsLinesError(total, linesTotal);
  const remainingOfInvoice = moneyDifference(input.originalGross, input.creditedBefore ?? '0');
  const credited = compareDecimals(remainingOfInvoice, 0) <= 0 ? '0.00' : minDecimal(total, remainingOfInvoice);
  let remaining = credited;
  const grosses = asked.map((a) => {
    const gross = minDecimal(a, remaining);
    remaining = roundHalfUp(decimalDifference(remaining, gross));
    return gross;
  });

  const groupOf = (l: { orderItemId: string; rate: string | number }) =>
    input.perRate ? roundHalfUp(l.rate, 4) : l.orderItemId;
  const byGroup = new Map<string, number[]>();
  input.lines.forEach((l, i) => {
    const group = groupOf(l);
    const indexes = byGroup.get(group);
    if (indexes) indexes.push(i);
    else byGroup.set(group, [i]);
  });
  const earlier = new Map<string, { net: string[]; gross: string[] }>();
  for (const e of input.earlierLines) {
    const group = groupOf(e);
    const sums = earlier.get(group) ?? { net: [], gross: [] };
    sums.net.push(e.net);
    sums.gross.push(e.gross);
    earlier.set(group, sums);
  }

  const nets: string[] = input.lines.map(() => '0.00');
  for (const [group, indexes] of byGroup) {
    const gross = moneySum(indexes.map((i) => grosses[i]!));
    const before = earlier.get(group) ?? { net: [], gross: [] };
    const cumulativeGross = moneySum([...before.gross, gross]);
    let cumulativeNet: string;
    if (input.perRate) {
      cumulativeNet = netForGrossAtRate(cumulativeGross, group, 'fraction').net;
    } else {
      const original = input.originalLines.find((o) => o.orderItemId === group);
      cumulativeNet =
        original && compareDecimals(original.gross, 0) > 0
          ? quotientHalfUp(decimalProduct(original.net, cumulativeGross), original.gross)
          : netFromGrossHalfUp(cumulativeGross, input.lines[indexes[0]!]!.rate, 'fraction');
    }
    let net = moneyDifference(cumulativeNet, moneySum(before.net));
    if (compareDecimals(net, 0) < 0) net = '0.00';
    if (compareDecimals(net, gross) > 0) net = gross;
    const shares =
      compareDecimals(gross, 0) === 0
        ? indexes.map(() => '0.00')
        : allocateHalfUp(
            net,
            indexes.map((i) => quotientHalfUp(decimalProduct(net, grosses[i]!), gross, 6)),
          );
    indexes.forEach((lineIndex, k) => {
      nets[lineIndex] = shares[k]!;
    });
  }

  const taxTotal = moneySum(grosses.map((g, i) => moneyDifference(g, nets[i]!)));
  const rates = new Map<string, { net: string[]; gross: string[] }>();
  input.lines.forEach((l, i) => {
    const key = roundHalfUp(l.rate, 4);
    const sums = rates.get(key) ?? { net: [], gross: [] };
    sums.net.push(nets[i]!);
    sums.gross.push(grosses[i]!);
    rates.set(key, sums);
  });
  return {
    credited,
    netTotal: roundHalfUp(decimalDifference(credited, taxTotal)),
    taxTotal,
    lines: input.lines.map((l, i) => ({
      gross: grosses[i]!,
      net: nets[i]!,
      unitNetPrice: quotientHalfUp(nets[i]!, l.quantity || 1, 4),
    })),
    vatSummary: [...rates.entries()]
      .sort((a, b) => compareDecimals(a[0], b[0]))
      .map(([taxRate, sums]) => {
        const netTotal = moneySum(sums.net);
        const grossTotal = moneySum(sums.gross);
        return { taxRate, netTotal, vatAmount: moneyDifference(grossTotal, netTotal), grossTotal };
      }),
  };
}

/** What a corrected line inherits from the original line it credits. */
interface MirroredLine {
  /** The original line's VAT rate, as a fraction (`0.2300` for 23%), as stored. */
  rate: string;
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
    private readonly ledgerRouting?: LedgerNumberingLookup,
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

    // A correction mirrors the line it corrects. The link is `orderItemId`:
    // issuance snapshots it on every product line of the original, and a return
    // case item names the same order item.
    const mirrorByOrderItem = new Map<string, MirroredLine>();
    const originalLines = await em.find(InvoiceLine, { invoiceId: original.id });
    for (const l of originalLines) {
      if (l.orderItemId) mirrorByOrderItem.set(l.orderItemId, { rate: l.taxRate, unit: l.unit });
    }
    // Resolve every line before the transaction opens, so a line that cannot
    // be mirrored refuses without having drawn a correction number.
    const mirrored = input.lines.map((l) => mirrorFor(original, mirrorByOrderItem, l.orderItemId));
    // What earlier corrections of this invoice already credited: the cap and
    // the cumulative rule both read it (review of PR #423).
    const earlierCorrections = await em.find(Invoice, { originalInvoiceId: original.id, kind: 'correction' });
    const earlierLines =
      earlierCorrections.length > 0
        ? await em.find(InvoiceLine, { invoiceId: { $in: earlierCorrections.map((c) => c.id) } })
        : [];
    const asCredited = (l: InvoiceLine) => ({
      orderItemId: l.orderItemId ?? '',
      rate: l.taxRate,
      net: l.netValue,
      gross: l.grossValue,
    });
    let amounts: ReturnType<typeof correctionAmounts>;
    try {
      amounts = correctionAmounts({
        total: input.total,
        originalGross: original.total,
        creditedBefore: moneySum(earlierCorrections.map((c) => c.total)),
        // Issued under the per-rate method exactly when it stored its summary.
        perRate: original.vatSummary != null,
        originalLines: originalLines.map(asCredited),
        earlierLines: earlierLines.map(asCredited),
        lines: input.lines.map((l, index) => ({
          amount: l.amount,
          quantity: l.quantity,
          rate: mirrored[index]!.rate,
          orderItemId: l.orderItemId,
        })),
      });
    } catch (err) {
      if (!(err instanceof CorrectionTotalExceedsLinesError)) throw err;
      throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, err.message, {
        code: 'correction_total_exceeds_lines',
        total: err.total,
        linesTotal: err.linesTotal,
      });
    }
    const { credited: creditedTotal, netTotal, taxTotal } = amounts;
    const snapshots = input.lines.map((l, index) => ({
      ordinal: index + 1,
      orderItemId: l.orderItemId,
      name: l.productName,
      quantity: l.quantity || 1,
      rate: roundHalfUp(mirrored[index]!.rate, 4),
      unit: mirrored[index]!.unit,
      ...amounts.lines[index]!,
    }));

    const issuedAt = new Date();
    const holdForVendor = await shouldHoldForVendorNumber(this.ledgerRouting, salesChannelId);
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
        netTotal,
        taxTotal,
        total: creditedTotal,
        vatSummary: amounts.vatSummary,
        paidTotal: '0',
        originalInvoiceId: original.id,
        ...(input.idempotencyKey ? { correctionIdempotencyKey: input.idempotencyKey } : {}),
        ...(original.buyerSnapshot ? { buyerSnapshot: original.buyerSnapshot } : {}),
        ...(original.sellerSnapshot ? { sellerSnapshot: original.sellerSnapshot } : {}),
        issuedBy: 'system',
        status: holdForVendor ? 'pending' : 'ready',
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
          unitNetPrice: s.unitNetPrice,
          taxRate: s.rate,
          netValue: s.net,
          grossValue: s.gross,
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
            credited: Number(creditedTotal),
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
