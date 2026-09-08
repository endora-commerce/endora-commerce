import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { TransitivelyScoped } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';
import type {
  InvoiceLedgerDeliveryAttempt,
  InvoiceLedgerDeliveryKind,
  InvoiceLedgerDeliveryStatus,
  InvoiceLedgerKsefRouting,
  InvoiceLedgerNumberingMode,
} from '@endora-commerce/contracts';

/**
 * Durable ledger work item. UUID invoice_id only; no FK to invoices.
 * Frozen credential / environment / numbering / KSeF routing at enqueue.
 */
@TransitivelyScoped('Invoice', 'invoiceId')
@Entity({ tableName: 'invoice_ledger_deliveries' })
@Unique({ properties: ['adapterId', 'invoiceId'] })
@Unique({ properties: ['adapterId', 'idempotencyKey'] })
export class InvoiceLedgerDelivery {
  [OptionalProps]?:
    | 'id'
    | 'salesChannelId'
    | 'asyncTaskId'
    | 'remoteDocumentId'
    | 'attemptCount'
    | 'attempts'
    | 'lastError'
    | 'remotePaidAt'
    | 'ksefDelegated'
    | 'createdAt'
    | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'varchar', length: 64, fieldName: 'adapter_id' })
  adapterId!: string;

  @Property({ type: 'uuid', fieldName: 'invoice_id' })
  invoiceId!: string;

  @Property({ type: 'varchar', length: 16, fieldName: 'kind' })
  kind!: InvoiceLedgerDeliveryKind;

  @Property({ type: 'uuid', fieldName: 'sales_channel_id', nullable: true })
  salesChannelId?: string | null;

  @Property({ type: 'varchar', length: 128, fieldName: 'credential_code' })
  credentialCode!: string;

  @Property({ type: 'varchar', length: 16, fieldName: 'environment' })
  environment!: 'sandbox' | 'production';

  @Property({ type: 'varchar', length: 16, fieldName: 'numbering_mode' })
  numberingMode!: InvoiceLedgerNumberingMode;

  @Property({ type: 'varchar', length: 16, fieldName: 'ksef_routing' })
  ksefRouting!: InvoiceLedgerKsefRouting;

  @Property({ type: 'varchar', length: 24, fieldName: 'status' })
  @Index()
  status!: InvoiceLedgerDeliveryStatus;

  @Property({ type: 'varchar', length: 128, fieldName: 'async_task_id', nullable: true })
  asyncTaskId?: string | null;

  @Property({ type: 'varchar', length: 64, fieldName: 'remote_document_id', nullable: true })
  remoteDocumentId?: string | null;

  @Property({ type: 'varchar', length: 128, fieldName: 'idempotency_key' })
  idempotencyKey!: string;

  @Property({ type: 'integer', fieldName: 'attempt_count' })
  attemptCount: number = 0;

  @Property({ type: 'json', fieldName: 'attempts' })
  attempts: InvoiceLedgerDeliveryAttempt[] = [];

  @Property({ type: 'text', fieldName: 'last_error', nullable: true })
  lastError?: string | null;

  @Property({ type: 'timestamptz', fieldName: 'remote_paid_at', nullable: true })
  remotePaidAt?: Date | null;

  @Property({ type: 'boolean', fieldName: 'ksef_delegated' })
  ksefDelegated: boolean = false;

  @Property({ type: 'timestamptz', fieldName: 'created_at', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'timestamptz', fieldName: 'updated_at', onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
