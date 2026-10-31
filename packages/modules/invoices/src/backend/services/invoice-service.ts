import { randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { HttpError } from '@endora-commerce/platform/http';
import {
  ERROR_CODES,
  compareDecimals,
  lineAmountHalfUp,
  moneyDifference,
  roundHalfUp,
  supportedLanguageOf,
  type InvoiceDetail,
  type InvoiceKind,
  type OrderReadPort,
  type OrderReturnRefund,
  type SupportedLanguage,
} from '@endora-commerce/contracts';
import { Invoice } from '../entities/invoice.entity.js';
import { InvoiceLine } from '../entities/invoice-line.entity.js';
import { isOrgInScope } from '@endora-commerce/platform/tenancy';
import { rethrowIfModuleDisabled } from '@endora-commerce/platform/kernel';
import { refuseDuplicateInvoiceNumber } from './duplicate-number-refusal.js';
import type { InvoiceNumberGenerator } from './invoice-number-generator.js';
import type { SellerSettingsResolver } from './seller-settings.js';
import { buildInvoiceLines, readModelVatSummary, type RawOrderLine } from './invoice-line-builder.js';
import { invoicePaidPosition } from './invoice-paid.js';
import { invoicesProseTable, type InvoicesTranslate } from '../invoices-prose.js';
import { INVOICE_RENDER_LANGUAGE } from '../document/invoice-document-type.js';
import {
  shouldHoldForVendorNumber,
  type LedgerNumberingLookup,
} from './vendor-number-hold.js';

/** The greater of two decimals, as the first one's text when they are equal. */
function maxDecimal(a: string, b: string): string {
  return compareDecimals(a, b) >= 0 ? a : b;
}

export interface IssueInvoiceOptions {
  saleDate?: string;
  paymentDueDate?: string;
  issuedBy?: string;
}

/**
 * What was captured for an order and what was refunded from it, each summed
 * over the captured payment attempts as a two-place decimal — or `null` when no
 * attempt was captured, or the `payments` module is absent and nothing can say
 * (issue #417, review of PR #423).
 */
export interface CapturedPaymentsLookup {
  capturedFor(orderId: string): Promise<{ captured: string; refunded: string } | null>;
}

/**
 * What the order's settled return cases refunded — an empty list when the
 * `returns` module is absent and nothing can say (issue #428).
 */
export interface ReturnRefundsLookup {
  refundsFor(orderId: string): Promise<OrderReturnRefund[]>;
}

/** Minimal audit-log seam (FR-035). */
export interface InvoiceAuditRecorder {
  record(input: {
    actorAdminUserId?: string | null;
    action: string;
    objectType: string;
    objectId: string;
    stateAfter?: Record<string, unknown> | null;
  }): Promise<unknown>;
}

/**
 * Domain-event seam (feature 059, contracts/invoices-integration.md §1).
 * Emissions are inert without a subscriber — the KSeF module (or any other
 * consumer) subscribes; removing it changes nothing here.
 */
export interface InvoiceDomainEventEmitter {
  emit(eventName: string, payload: { eventId: string; occurredAt: string } & Record<string, unknown>): void;
}

/** The names of the lines an invoice itemises beside the products, in this module's bundle. */
const INVOICE_LINE_NAME_KEYS = [
  'lines.item',
  'lines.unit.piece',
  'lines.unit.service',
  'lines.delivery',
  'lines.paymentSurcharge',
  'lines.discount',
] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Core invoice issuance + read service (feature 047, US1). Issues invoices /
 * proformas (and is reused by the corrective-invoice provider for credit
 * notes). Numbers are drawn inside the issuing transaction; lines and the
 * seller/buyer snapshot are frozen at issuance. Immutable once `ready`.
 *
 * The order and its lines are read over {@link OrderReadPort} (feature 075,
 * Phase C). They were `em.findOne(Order, …)` and `em.find(OrderItem, …)` here,
 * which is a query against another module's tables that no gate can see:
 * deactivation drops no tables, so an invoice went on being drawn from an
 * `orders` an operator had switched off. Over the port the same read answers
 * 503 `MODULE_DISABLED`, which is the binding dependency this manifest already
 * declares — issuing a legal document about an order the platform will not read
 * is worse than refusing to issue one.
 */
export class InvoiceService {
  constructor(
    private readonly emFactory: () => EntityManager,
    /** `orders`' read model. Not optional: an invoice is about an order. */
    private readonly orders: OrderReadPort,
    private readonly numbers: InvoiceNumberGenerator,
    private readonly sellerSettings: SellerSettingsResolver,
    private readonly audit?: InvoiceAuditRecorder,
    private readonly events?: InvoiceDomainEventEmitter,
    private readonly emailOnReady?: (invoiceId: string) => Promise<void>,
    private readonly ledgerRouting?: LedgerNumberingLookup,
    private readonly capturedPayments?: CapturedPaymentsLookup,
    private readonly returnRefunds?: ReturnRefundsLookup,
    /**
     * The language the lines an invoice itemises beside the products are named
     * in, and this module's bundle to name them from (issue #95). The name is
     * stored with the line — an issued invoice does not change — so it is
     * written in the invoice's language, `INVOICE_RENDER_LANGUAGE` (owner answer
     * N5), at issue. Without a translator, English.
     */
    private readonly lineProse: {
      readonly translate?: InvoicesTranslate | undefined;
      readonly language?: SupportedLanguage;
    } = {},
  ) {}

  /** Issue an invoice/proforma for an order. Idempotent per (order, kind). */
  async issue(
    orderId: string,
    kind: Exclude<InvoiceKind, 'correction' | 'wz'>,
    opts: IssueInvoiceOptions = {},
  ): Promise<InvoiceDetail> {
    const em = this.emFactory();
    const order = await this.orders.findById(orderId);
    // Feature 050 — Invoice is transitively scoped through its Order's org.
    if (!order || !isOrgInScope(order.organizationId ?? '')) {
      throw new HttpError(404, ERROR_CODES.ORDER_NOT_FOUND, 'Order not found.');
    }

    const existing = await em.findOne(Invoice, { orderId, kind });
    if (existing) {
      throw new HttpError(409, ERROR_CODES.VERSION_CONFLICT, `An ${kind} already exists for this order.`);
    }

    const seller = await this.sellerSettings.resolve(order.salesChannelId);
    const items = await this.orders.listItems(orderId);
    // A line's net is its unit price times its quantity, exactly (issue #417).
    // It is **not** the order line's `lineTotal`: placement stores that gross
    // (`unitPrice × quantity × (1 + taxRate)`), and reading it as the net taxed
    // every VAT-payer line twice — the invoice's net was the order's gross.
    const names = await invoicesProseTable(
      this.lineProse.translate,
      INVOICE_LINE_NAME_KEYS,
      this.lineProse.language ?? supportedLanguageOf(INVOICE_RENDER_LANGUAGE),
    );
    const raw: RawOrderLine[] = items.map((it) => ({
      name: it.productSnapshot?.name ?? names['lines.item'],
      unit: it.packagingUnitSnapshot?.name ?? names['lines.unit.piece'],
      quantity: it.quantity,
      unitNetPrice: it.unitPrice,
      taxRate: it.taxRate,
      netValue: lineAmountHalfUp(it.unitPrice, it.quantity),
      orderItemId: it.id,
    }));

    // Itemize the order's non-product amounts so the invoice total reconciles
    // with the order total. The order model adds delivery + payment surcharge
    // and subtracts the discount on the gross without extra VAT, so each is a
    // 0%-VAT line (the discount is a negative line).
    // The amounts are read as the decimals they are stored as (issue #417).
    const deliveryTotal = roundHalfUp(order.deliveryTotal ?? 0);
    if (Number(deliveryTotal) > 0) {
      raw.push({
        name: names['lines.delivery'],
        unit: names['lines.unit.service'],
        quantity: 1,
        unitNetPrice: deliveryTotal,
        taxRate: 0,
        netValue: deliveryTotal,
      });
    }
    const surcharge = roundHalfUp(order.paymentMethodSnapshot?.additionalPrice ?? 0);
    if (Number(surcharge) > 0) {
      raw.push({
        name: names['lines.paymentSurcharge'],
        unit: names['lines.unit.service'],
        quantity: 1,
        unitNetPrice: surcharge,
        taxRate: 0,
        netValue: surcharge,
      });
    }
    const discountTotal = roundHalfUp(order.discountTotal ?? 0);
    if (Number(discountTotal) > 0) {
      const negative = `-${discountTotal}`;
      raw.push({
        name: names['lines.discount'],
        unit: names['lines.unit.service'],
        quantity: 1,
        unitNetPrice: negative,
        taxRate: 0,
        netValue: negative,
      });
    }
    const built = buildInvoiceLines(raw);

    const issuedAt = new Date();
    // What was actually paid for the order — never the invoice gross (issue
    // #417, review of PR #423). An order placed before 0.108.0 charged its own
    // total (40.80), and its invoice, issued now under the per-rate method, may
    // be a cent more (40.81): the cent is shown as still due, not invented as
    // paid. What was received — captured by `payments`, or the stored total of
    // an order recorded as paid with nothing captured — less everything refunded,
    // each refund once: what `payments` recorded and, since issue #428, what a
    // settled return refunded outside it (a manual transfer, a credit-limit
    // top-up). `invoicePaidPosition` states the rule.
    const position = invoicePaidPosition({
      orderTotal: order.total,
      paymentStatus: order.paymentStatus,
      paymentKind: order.paymentMethodSnapshot?.kind ?? null,
      payments: (await this.capturedPayments?.capturedFor(orderId)) ?? null,
      returnRefunds: (await this.returnRefunds?.refundsFor(orderId)) ?? [],
    });
    // An order whose payments were refunded in full before it was invoiced —
    // nothing kept, and the refunds cover the whole order — has no sale left to
    // document, so it is not invoiced (owner ruling of 2026-10-24). One refunded
    // in part is invoiced, with what was kept as paid.
    if (kind === 'invoice' && position.refundedInFull) {
      throw new HttpError(
        422,
        ERROR_CODES.INVOICE_ORDER_REFUNDED,
        'The order was refunded in full before it was invoiced, so there is no sale left to invoice.',
      );
    }
    const paidTotal = position.paid;
    const buyer = {
      name: order.billingAddress.companyName ?? order.billingAddress.recipientName,
      taxId: order.billingAddress.taxId ?? '',
      addressLine1: order.billingAddress.street,
      addressLine2: '',
      postalCode: order.billingAddress.postalCode,
      city: order.billingAddress.city,
      country: order.billingAddress.country,
    };

    // Captured out of the transaction on purpose: the callback's result is lost
    // when the transaction aborts, and the duplicate-number refusal exists to
    // name the number that was drawn.
    const holdForVendor = await shouldHoldForVendorNumber(
      this.ledgerRouting,
      order.salesChannelId,
    );
    let drawnNumber: string | null = null;
    const invoice = await this.issueInTransaction(em, async (tx) => {
      const number = await this.numbers.next(tx, kind, order.salesChannelId, issuedAt);
      drawnNumber = number;
      const inv = tx.create(Invoice, {
        orderId,
        salesChannelId: order.salesChannelId,
        kind,
        number,
        issuedAt,
        saleDate: opts.saleDate ?? issuedAt.toISOString().slice(0, 10),
        paymentDueDate: opts.paymentDueDate ?? null,
        paymentMethod: order.paymentMethodSnapshot?.name ?? null,
        currency: order.currency,
        netTotal: built.netTotal,
        taxTotal: built.taxTotal,
        total: built.grossTotal,
        paidTotal,
        sellerSnapshot: seller,
        buyerSnapshot: buyer,
        vatSummary: built.storedVatSummary,
        issuedBy: opts.issuedBy ?? 'system',
        status: holdForVendor ? 'pending' : 'ready',
      });
      await tx.persistAndFlush(inv);
      let ordinal = 0;
      for (const l of built.lines) {
        ordinal += 1;
        tx.create(InvoiceLine, {
          invoiceId: inv.id,
          ordinal,
          name: l.name,
          unit: l.unit,
          quantity: String(l.quantity),
          unitNetPrice: l.stored.unitNetPrice,
          taxRate: l.stored.taxRate,
          netValue: l.stored.netValue,
          grossValue: l.stored.grossValue,
          orderItemId: l.orderItemId ?? null,
        });
      }
      await tx.flush();
      return inv;
    }, () => drawnNumber, order.salesChannelId);

    // Audit (FR-035) — best-effort; never fails issuance.
    if (this.audit) {
      await this.audit
        .record({
          actorAdminUserId: opts.issuedBy && UUID_RE.test(opts.issuedBy) ? opts.issuedBy : null,
          action: 'invoice.issued',
          objectType: 'invoice',
          objectId: invoice.id,
          stateAfter: {
            number: invoice.number,
            kind: invoice.kind,
            orderId,
            salesChannelId: order.salesChannelId,
            grossTotal: Number(built.grossTotal),
          },
        })
        .catch(() => undefined);
    }

    // Feature 059 — domain event for downstream consumers (e.g. KSeF submission).
    this.events?.emit('invoice.issued.v1', {
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      invoiceId: invoice.id,
      orderId,
      kind,
      salesChannelId: order.salesChannelId ?? null,
    });

    return this.buildDetail(invoice.id);
  }

  /**
   * Run the issuing transaction, translating a duplicated invoice number into
   * `409 INVOICE_NUMBER_ALREADY_ISSUED` (feature 078, D-95.2).
   *
   * `rethrowIfModuleDisabled` is the **first** line of the catch, before any
   * other test. `ModuleDisabledError` is an `HttpError`, so a status-code or
   * class test would let it through by accident rather than by decision, and
   * everything inside the callback can reach a port.
   */
  private async issueInTransaction(
    em: EntityManager,
    work: (tx: EntityManager) => Promise<Invoice>,
    drawnNumber: () => string | null,
    salesChannelId: string | null,
  ): Promise<Invoice> {
    try {
      return await em.transactional(work);
    } catch (err) {
      rethrowIfModuleDisabled(err);
      await refuseDuplicateInvoiceNumber({
        error: err,
        drawnNumber: drawnNumber(),
        salesChannelId,
        emFactory: this.emFactory,
      });
      throw err;
    }
  }

  /**
   * Record the KSeF identity assigned to an invoice (feature 059,
   * contracts/invoices-integration.md §2). The invoices module is the SOLE
   * writer of these columns. Idempotent for the same number; a different
   * non-null number is refused — an accepted KSeF number is immutable.
   */
  async recordKsefAssignment(
    invoiceId: string,
    assignment: { ksefReferenceNumber: string; ksefProcessedAt: Date },
  ): Promise<void> {
    const em = this.emFactory().fork();
    const inv = await em.findOne(Invoice, { id: invoiceId });
    if (!inv) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Invoice not found.');
    if (inv.ksefReferenceNumber) {
      if (inv.ksefReferenceNumber === assignment.ksefReferenceNumber) return;
      throw new HttpError(
        409,
        ERROR_CODES.VERSION_CONFLICT,
        'The invoice already carries a different KSeF number — KSeF identity is immutable.',
      );
    }
    // command-coverage-ignore: idempotent stamp of the already-audited KSeF
    // identity onto the invoice — the outcome is audited by the KSeF submission
    // flow (`ksef.submission.accepted`); this is the sole-writer projection of it.
    inv.ksefReferenceNumber = assignment.ksefReferenceNumber;
    inv.ksefProcessedAt = assignment.ksefProcessedAt;
    await em.persistAndFlush(inv);
  }

  /**
   * Mode B: overwrite the Endora-drawn number with the vendor's, then ready.
   * No-op when the invoice already carries that number and is ready.
   */
  async applyVendorAssignedNumber(invoiceId: string, number: string): Promise<void> {
    const em = this.emFactory().fork();
    const inv = await em.findOne(Invoice, { id: invoiceId });
    if (!inv) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Invoice not found.');
    if (inv.status === 'cancelled') {
      throw new HttpError(409, ERROR_CODES.VERSION_CONFLICT, 'The invoice is cancelled.');
    }
    if (inv.number === number && inv.status === 'ready') return;
    if (inv.status !== 'pending' && inv.number !== number) {
      throw new HttpError(
        409,
        ERROR_CODES.VERSION_CONFLICT,
        'The invoice is not waiting for a vendor number.',
      );
    }
    const holder = await em.findOne(Invoice, { number });
    if (holder && holder.id !== inv.id) {
      throw new HttpError(
        409,
        ERROR_CODES.INVOICE_NUMBER_ALREADY_ISSUED,
        `Invoice number ${number} is already issued.`,
      );
    }
    // command-coverage-ignore: idempotent stamp of the vendor-assigned number
    // the ledger webhook already claimed — same shape as `recordKsefAssignment`.
    inv.number = number;
    inv.status = 'ready';
    await em.persistAndFlush(inv);
    await this.emailOnReady?.(invoiceId);
  }

  /**
   * Infakt `invoice_paid` → stamp paidTotal to the invoice gross. Never Payments.
   */
  async recordPaidFromLedger(invoiceId: string): Promise<void> {
    const em = this.emFactory().fork();
    const inv = await em.findOne(Invoice, { id: invoiceId });
    if (!inv) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Invoice not found.');
    if (compareDecimals(inv.paidTotal, inv.total) >= 0) return;
    // command-coverage-ignore: idempotent paidTotal projection of Infakt
    // `invoice_paid` — the webhook receipt is the claim; this is the sole-writer stamp.
    inv.paidTotal = inv.total;
    await em.persistAndFlush(inv);
  }

  /** Load an invoice as a render-ready detail (lines + derived VAT summary). */
  async buildDetail(invoiceId: string): Promise<InvoiceDetail> {
    const em = this.emFactory();
    const inv = await em.findOne(Invoice, { id: invoiceId });
    if (!inv) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Invoice not found.');
    const order = inv.orderId ? await this.orders.findById(inv.orderId) : null;
    if (inv.origin === 'erp_import') {
      if (!isOrgInScope(inv.organizationId ?? '')) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Invoice not found.');
      }
    } else if (!order || !isOrgInScope(order.organizationId ?? '')) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Invoice not found.');
    }
    const lineRows = await em.find(InvoiceLine, { invoiceId }, { orderBy: { ordinal: 'asc' } });

    const lines = lineRows.map((l) => ({
      ordinal: l.ordinal,
      name: l.name,
      unit: l.unit,
      quantity: Number(l.quantity),
      unitNetPrice: Number(l.unitNetPrice),
      taxRate: Number(l.taxRate),
      netValue: Number(l.netValue),
      grossValue: Number(l.grossValue),
    }));

    // The summary the document was issued with, or — issued before 0.108.0 —
    // the one derived from its stored lines as it was then (review of PR #423).
    const vatSummary = readModelVatSummary(lineRows, inv.vatSummary);

    const grossTotal = Number(inv.total);
    const paidTotal = Number(inv.paidTotal);
    return {
      id: inv.id,
      orderId: inv.orderId ?? null,
      orderBusinessId: order?.businessId ?? null,
      salesChannelId: inv.salesChannelId ?? null,
      kind: inv.kind,
      number: inv.number,
      status: inv.status,
      currency: inv.currency,
      issuedAt: inv.issuedAt.toISOString(),
      saleDate: inv.saleDate ?? null,
      paymentDueDate: inv.paymentDueDate ?? null,
      paymentMethod: inv.paymentMethod ?? null,
      netTotal: Number(inv.netTotal ?? moneyDifference(inv.total, inv.taxTotal ?? '0')),
      taxTotal: inv.taxTotal != null ? Number(inv.taxTotal) : 0,
      grossTotal,
      paidTotal,
      // Never negative (issue #428): what was paid above the gross is the
      // overpayment, stated on its own, and nothing is then due.
      amountDue: Number(maxDecimal(moneyDifference(inv.total, inv.paidTotal), '0.00')),
      overpayment: Number(maxDecimal(moneyDifference(inv.paidTotal, inv.total), '0.00')),
      total: grossTotal,
      originalInvoiceId: inv.originalInvoiceId ?? null,
      templateId: inv.templateId ?? null,
      pdfAssetId: inv.pdfAssetId ?? null,
      ksefReferenceNumber: inv.ksefReferenceNumber ?? null,
      ksefProcessedAt: inv.ksefProcessedAt ? inv.ksefProcessedAt.toISOString() : null,
      lines,
      vatSummary,
      seller: inv.sellerSnapshot ?? {
        legalName: '',
        addressLine1: '',
        addressLine2: '',
        postalCode: '',
        city: '',
        country: '',
        taxId: '',
        bankName: '',
        bankAccount: '',
        swift: '',
        email: '',
        phone: '',
      },
      buyer: inv.buyerSnapshot ?? {
        name: '',
        taxId: '',
        addressLine1: '',
        addressLine2: '',
        postalCode: '',
        city: '',
        country: '',
      },
    };
  }
}
