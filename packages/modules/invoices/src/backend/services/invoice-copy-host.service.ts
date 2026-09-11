import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  InvoiceBuyer,
  InvoiceCopyHostPort,
  InvoiceCopyRecord,
  InvoiceLine,
  OrderReadPort,
} from '@endora-commerce/contracts';
import { Invoice } from '../entities/invoice.entity.js';
import { InvoiceLine as InvoiceLineEntity } from '../entities/invoice-line.entity.js';

const EMPTY_BUYER: InvoiceBuyer = {
  name: '',
  taxId: '',
  addressLine1: '',
  addressLine2: '',
  postalCode: '',
  city: '',
  country: '',
};

export class InvoiceCopyHostService implements InvoiceCopyHostPort {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly orders: OrderReadPort,
  ) {}

  async getById(invoiceId: string): Promise<InvoiceCopyRecord | null> {
    const em = this.emFactory();
    const invoice = await em.findOne(Invoice, { id: invoiceId });
    if (!invoice) return null;
    const order = await this.orders.findById(invoice.orderId);
    const lineRows = await em.find(
      InvoiceLineEntity,
      { invoiceId },
      { orderBy: { ordinal: 'asc' } },
    );
    const lines: InvoiceLine[] = lineRows.map((line) => ({
      ordinal: line.ordinal,
      name: line.name,
      unit: line.unit,
      quantity: Number(line.quantity),
      unitNetPrice: Number(line.unitNetPrice),
      taxRate: Number(line.taxRate),
      netValue: Number(line.netValue),
      grossValue: Number(line.grossValue),
    }));
    return {
      invoiceId: invoice.id,
      organizationId: order?.organizationId ?? '',
      number: invoice.number,
      kind: invoice.kind,
      salesChannelId: invoice.salesChannelId ?? null,
      currency: invoice.currency,
      saleDate: invoice.saleDate ?? null,
      paymentDueDate: invoice.paymentDueDate ?? null,
      paymentMethod: invoice.paymentMethod ?? null,
      originalInvoiceId: invoice.originalInvoiceId ?? null,
      buyer: invoice.buyerSnapshot ?? EMPTY_BUYER,
      lines,
    };
  }
}
