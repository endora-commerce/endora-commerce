import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { randomUUID } from 'crypto';
import type { ExternalDocumentRef, InvoiceBuyer, SellerCompanyData } from '@endora-commerce/contracts';
import { TransitivelyScoped } from '@endora-commerce/platform/tenancy';

/**
 * Invoice — a document issued against an order (feature 047). Immutable once
 * `status = 'ready'`; content changes only via a `correction` invoice. The
 * legacy `total` column is retained as an alias of `grossTotal` for back-compat
 * with the original commerce-init schema.
 */
@TransitivelyScoped('Order', 'orderId')
@Entity({ tableName: 'invoices' })
export class Invoice {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'pdfAssetId'
    | 'status'
    | 'issuedAt'
    | 'saleDate'
    | 'paymentDueDate'
    | 'paymentMethod'
    | 'salesChannelId'
    | 'paidTotal'
    | 'originalInvoiceId'
    | 'correctionIdempotencyKey'
    | 'templateId'
    | 'sellerSnapshot'
    | 'buyerSnapshot'
    | 'ksefReferenceNumber'
    | 'ksefProcessedAt'
    | 'issuedBy'
    | 'origin'
    | 'organizationId'
    | 'externalDocumentRef'
    | 'orderId';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid', nullable: true })
  @Index()
  orderId?: string | null;

  @Property({ type: 'uuid', nullable: true })
  @Index()
  organizationId?: string | null;

  @Property({ type: 'string', length: 16 })
  @Index()
  origin: 'platform' | 'erp_import' = 'platform';

  @Property({ type: 'json', nullable: true })
  externalDocumentRef?: ExternalDocumentRef | null;

  @Property({ type: 'uuid', nullable: true })
  @Index()
  salesChannelId?: string | null;

  @Property({ type: 'string', length: 16 })
  @Index()
  kind!: 'proforma' | 'invoice' | 'correction' | 'wz';

  @Property({ type: 'string', length: 64 })
  @Unique()
  number!: string;

  @Property({ type: 'datetime' })
  issuedAt: Date = new Date();

  @Property({ type: 'date', nullable: true })
  saleDate?: string | null;

  @Property({ type: 'date', nullable: true })
  paymentDueDate?: string | null;

  @Property({ type: 'string', length: 64, nullable: true })
  paymentMethod?: string | null;

  @Property({ type: 'string', length: 3 })
  currency!: string;

  @Property({ type: 'decimal', precision: 14, scale: 2, nullable: true })
  netTotal?: string | null;

  @Property({ type: 'decimal', precision: 14, scale: 2, nullable: true })
  taxTotal?: string | null;

  @Property({ type: 'decimal', precision: 14, scale: 2 })
  total!: string;

  @Property({ type: 'decimal', precision: 14, scale: 2 })
  paidTotal: string = '0';

  @Property({ type: 'uuid', nullable: true })
  originalInvoiceId?: string | null;

  /**
   * The caller's key for a correction, unique among the rows that carry one
   * (D-91). A return settlement passes its return case id, so a retried
   * settlement is answered with the document the first attempt issued instead
   * of a second one. Null on every invoice issued without a key — every
   * `proforma`, every `invoice`, and every correction issued by hand.
   */
  @Property({ type: 'string', length: 64, nullable: true })
  correctionIdempotencyKey?: string | null;

  @Property({ type: 'uuid', nullable: true })
  templateId?: string | null;

  @Property({ type: 'json', nullable: true })
  sellerSnapshot?: SellerCompanyData | null;

  @Property({ type: 'json', nullable: true })
  buyerSnapshot?: InvoiceBuyer | null;

  @Property({ type: 'string', length: 128, nullable: true })
  ksefReferenceNumber?: string | null;

  @Property({ type: 'datetime', nullable: true })
  ksefProcessedAt?: Date | null;

  @Property({ type: 'string', length: 128, nullable: true })
  issuedBy?: string | null;

  @Property({ type: 'uuid', nullable: true })
  pdfAssetId?: string | null;

  @Property({ type: 'string', length: 16 })
  @Index()
  status: 'pending' | 'ready' | 'cancelled' = 'pending';

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
