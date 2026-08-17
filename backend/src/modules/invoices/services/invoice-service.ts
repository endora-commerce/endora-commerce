import { randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { HttpError } from '../../../http/error-envelope.js';
import {
  ERROR_CODES,
  type InvoiceDetail,
  type InvoiceKind,
  type OrderReadPort,
  type VatSummaryRow,
} from '@b2b/contracts';
import { Invoice } from '../entities/invoice.entity.js';
import { InvoiceLine } from '../entities/invoice-line.entity.js';
import { isOrgInScope } from '../../../tenancy/derived-scope.js';
import type { InvoiceNumberGenerator } from './invoice-number-generator.js';
import type { SellerSettingsResolver } from './seller-settings.js';
import { buildInvoiceLines, type RawOrderLine } from './invoice-line-builder.js';

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export interface IssueInvoiceOptions {
  saleDate?: string;
  paymentDueDate?: string;
  issuedBy?: string;
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
  ) {}

  /** Issue an invoice/proforma for an order. Idempotent per (order, kind). */
  async issue(
    orderId: string,
    kind: Exclude<InvoiceKind, 'correction'>,
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
    const raw: RawOrderLine[] = items.map((it) => {
      const netValue = Number(it.lineTotal);
      const qty = it.quantity;
      return {
        name: it.productSnapshot?.name ?? 'Pozycja',
        unit: it.packagingUnitSnapshot?.name ?? 'szt.',
        quantity: qty,
        unitNetPrice: Number(it.unitPrice),
        taxRate: Number(it.taxRate),
        netValue,
        orderItemId: it.id,
      };
    });

    // Itemize the order's non-product amounts so the invoice total reconciles
    // with the order total. The order model adds delivery + payment surcharge
    // and subtracts the discount on the gross without extra VAT, so each is a
    // 0%-VAT line (the discount is a negative line).
    const deliveryTotal = Number(order.deliveryTotal ?? 0);
    if (deliveryTotal > 0) {
      raw.push({ name: 'Dostawa', unit: 'usł.', quantity: 1, unitNetPrice: deliveryTotal, taxRate: 0, netValue: deliveryTotal });
    }
    const surcharge = Number(order.paymentMethodSnapshot?.additionalPrice ?? 0);
    if (surcharge > 0) {
      raw.push({
        name: 'Dopłata za metodę płatności',
        unit: 'usł.',
        quantity: 1,
        unitNetPrice: surcharge,
        taxRate: 0,
        netValue: surcharge,
      });
    }
    const discountTotal = Number(order.discountTotal ?? 0);
    if (discountTotal > 0) {
      raw.push({ name: 'Rabat', unit: 'usł.', quantity: 1, unitNetPrice: -discountTotal, taxRate: 0, netValue: -discountTotal });
    }
    const built = buildInvoiceLines(raw);

    const issuedAt = new Date();
    const paidTotal = order.paymentStatus === 'paid' ? built.grossTotal : 0;
    const buyer = {
      name: order.billingAddress.companyName ?? order.billingAddress.recipientName,
      taxId: order.billingAddress.taxId ?? '',
      addressLine1: order.billingAddress.street,
      addressLine2: '',
      postalCode: order.billingAddress.postalCode,
      city: order.billingAddress.city,
      country: order.billingAddress.country,
    };

    const invoice = await em.transactional(async (tx) => {
      const number = await this.numbers.next(tx, kind, order.salesChannelId, issuedAt);
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
        netTotal: built.netTotal.toFixed(2),
        taxTotal: built.taxTotal.toFixed(2),
        total: built.grossTotal.toFixed(2),
        paidTotal: paidTotal.toFixed(2),
        sellerSnapshot: seller,
        buyerSnapshot: buyer,
        issuedBy: opts.issuedBy ?? 'system',
        status: 'ready',
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
          unitNetPrice: l.unitNetPrice.toFixed(4),
          taxRate: l.taxRate.toFixed(4),
          netValue: l.netValue.toFixed(2),
          grossValue: l.grossValue.toFixed(2),
          orderItemId: l.orderItemId ?? null,
        });
      }
      await tx.flush();
      return inv;
    });

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
            grossTotal: built.grossTotal,
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

  /** Load an invoice as a render-ready detail (lines + derived VAT summary). */
  async buildDetail(invoiceId: string): Promise<InvoiceDetail> {
    const em = this.emFactory();
    const inv = await em.findOne(Invoice, { id: invoiceId });
    if (!inv) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Invoice not found.');
    const order = await this.orders.findById(inv.orderId);
    // Feature 050 — transitive scope: hide invoices whose order is out of scope.
    if (!order || !isOrgInScope(order.organizationId ?? '')) {
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

    const byRate = new Map<number, { net: number; gross: number }>();
    for (const l of lines) {
      const cur = byRate.get(l.taxRate) ?? { net: 0, gross: 0 };
      cur.net += l.netValue;
      cur.gross += l.grossValue;
      byRate.set(l.taxRate, cur);
    }
    const vatSummary: VatSummaryRow[] = [...byRate.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([taxRate, v]) => ({
        taxRate,
        netTotal: round2(v.net),
        vatAmount: round2(v.gross - v.net),
        grossTotal: round2(v.gross),
      }));

    const grossTotal = Number(inv.total);
    const paidTotal = Number(inv.paidTotal);
    return {
      id: inv.id,
      orderId: inv.orderId,
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
      netTotal: inv.netTotal != null ? Number(inv.netTotal) : round2(grossTotal - (inv.taxTotal != null ? Number(inv.taxTotal) : 0)),
      taxTotal: inv.taxTotal != null ? Number(inv.taxTotal) : 0,
      grossTotal,
      paidTotal,
      amountDue: round2(grossTotal - paidTotal),
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
