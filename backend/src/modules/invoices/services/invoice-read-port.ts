import type { EntityManager } from '@mikro-orm/postgresql';
import type { InvoicePdfPort, InvoiceReadPort, InvoiceRecord } from '@b2b/contracts';
import { Invoice } from '../entities/invoice.entity.js';
import { buildBulkInvoicesPdf, buildMinimalInvoicePdf } from './invoice-pdf.js';

/**
 * The row-level read model and the PDF surface `invoices` publishes
 * (feature 075, Phase P).
 *
 * Four inbound sites read the `Invoice` entity: `orders` listing an order's
 * invoices on the order screen and again at cancellation, and `ksef` resolving
 * the invoice behind a submission — one of those two from inside its entity
 * file, where the reference is a `@TransitivelyScoped` tenancy classification
 * rather than a query, and needs its own remedy (R-05) that no port can give.
 *
 * The seller and buyer snapshots do not survive the mapping. They are the
 * document's frozen copy of two other modules' rows; no cross-module caller
 * reads them, and publishing them would invite one to.
 */
export class InvoiceReadService implements InvoiceReadPort {
  constructor(private readonly emFactory: () => EntityManager) {}

  async findById(id: string): Promise<InvoiceRecord | null> {
    const invoice = await this.emFactory().findOne(Invoice, { id });
    return invoice ? toInvoiceRecord(invoice) : null;
  }

  async findByIds(ids: readonly string[]): Promise<InvoiceRecord[]> {
    if (ids.length === 0) return [];
    const invoices = await this.emFactory().find(Invoice, { id: { $in: [...ids] } });
    return invoices.map(toInvoiceRecord);
  }

  async findByNumber(number: string): Promise<InvoiceRecord | null> {
    const invoice = await this.emFactory().findOne(Invoice, { number });
    return invoice ? toInvoiceRecord(invoice) : null;
  }

  async listForOrder(orderId: string): Promise<InvoiceRecord[]> {
    const invoices = await this.emFactory().find(
      Invoice,
      { orderId },
      { orderBy: { issuedAt: 'desc', id: 'desc' } },
    );
    return invoices.map(toInvoiceRecord);
  }

  async listForOrders(orderIds: readonly string[]): Promise<InvoiceRecord[]> {
    if (orderIds.length === 0) return [];
    const invoices = await this.emFactory().find(
      Invoice,
      { orderId: { $in: [...orderIds] } },
      { orderBy: { issuedAt: 'desc', id: 'desc' } },
    );
    return invoices.map(toInvoiceRecord);
  }
}

/**
 * The PDF surface, as a **port** even though both builders behind it are pure.
 *
 * FR-013's test — "does switching the owner off change the answer?" — asks
 * whether the bytes would differ, and they would not. The question that
 * settles this one is Constitution XVII's: should the platform produce an
 * invoice document for a business that has switched invoicing off? An order
 * screen offering an invoice PDF is a surface this module owns, and a surface
 * a switched-off module owns must disappear.
 *
 * `hashPassword` is the contrast that makes the line a line: it is
 * platform-generic, reachable from five modules and the dev seed, and nobody
 * would call hashing "an `auth` surface". A VAT document is an `invoices`
 * surface.
 */
export function createInvoicePdfPort(): InvoicePdfPort {
  return {
    renderMinimal: (params) => buildMinimalInvoicePdf(params),
    renderBulk: (invoices) => buildBulkInvoicesPdf([...invoices]),
  };
}

export function toInvoiceRecord(invoice: Invoice): InvoiceRecord {
  return {
    id: invoice.id,
    orderId: invoice.orderId,
    salesChannelId: invoice.salesChannelId ?? null,
    kind: invoice.kind,
    number: invoice.number,
    issuedAt: invoice.issuedAt,
    saleDate: invoice.saleDate ?? null,
    paymentDueDate: invoice.paymentDueDate ?? null,
    paymentMethod: invoice.paymentMethod ?? null,
    currency: invoice.currency,
    netTotal: invoice.netTotal ?? null,
    taxTotal: invoice.taxTotal ?? null,
    total: invoice.total,
    paidTotal: invoice.paidTotal,
    originalInvoiceId: invoice.originalInvoiceId ?? null,
    templateId: invoice.templateId ?? null,
    ksefReferenceNumber: invoice.ksefReferenceNumber ?? null,
    ksefProcessedAt: invoice.ksefProcessedAt ?? null,
    issuedBy: invoice.issuedBy ?? null,
    pdfAssetId: invoice.pdfAssetId ?? null,
    status: invoice.status,
    createdAt: invoice.createdAt,
    updatedAt: invoice.updatedAt,
  };
}
