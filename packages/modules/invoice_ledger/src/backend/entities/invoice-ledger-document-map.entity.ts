import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { OrgScoped } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * Endora invoice → remote VAT/correction. UUID columns only; no FK to invoices.
 * Unique `(adapter_id, invoice_id)`. Partial unique on remote id is migration-only.
 *
 * `@OrgScoped()` rather than a chain hop through `Invoice`, for the reason
 * `invoice-ledger-delivery.entity.ts` gives at length: `invoice_ledger` is
 * `nonDeactivatable` and cannot declare `invoices` in `dependencies`, so an
 * instance may load this class with no `Invoice` registered at all. The
 * organization is copied from the delivery row this map projects, which froze
 * it at enqueue.
 */
@OrgScoped()
@Entity({ tableName: 'invoice_ledger_document_maps' })
@Unique({ properties: ['adapterId', 'invoiceId'] })
export class InvoiceLedgerDocumentMap {
  [OptionalProps]?: 'id' | 'originalInvoiceId' | 'createdAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'varchar', length: 64, fieldName: 'adapter_id' })
  adapterId!: string;

  @Property({ type: 'uuid', fieldName: 'invoice_id' })
  invoiceId!: string;

  @Property({ type: 'uuid', fieldName: 'organization_id' })
  @Index()
  organizationId!: string;

  @Property({ type: 'uuid', fieldName: 'original_invoice_id', nullable: true })
  @Index()
  originalInvoiceId?: string | null;

  @Property({ type: 'varchar', length: 64, fieldName: 'remote_document_id', nullable: true })
  remoteDocumentId?: string | null;

  @Property({ type: 'varchar', length: 16, fieldName: 'environment' })
  environment!: 'sandbox' | 'production';

  @Property({ type: 'varchar', length: 128, fieldName: 'credential_code' })
  credentialCode!: string;

  @Property({ type: 'timestamptz', fieldName: 'created_at', onCreate: () => new Date() })
  createdAt: Date = new Date();
}
