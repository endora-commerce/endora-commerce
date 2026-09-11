import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

export type InvoiceLedgerWebhookReceiptState = 'received' | 'processed' | 'ignored' | 'failed';

/**
 * Vendor event-id claim. Persist `received` before invoices-port side effects.
 */
@GlobalEntity()
@Entity({ tableName: 'invoice_ledger_webhook_receipts' })
@Unique({ properties: ['adapterId', 'eventId'] })
export class InvoiceLedgerWebhookReceipt {
  [OptionalProps]?: 'id' | 'attempts' | 'appliedAt' | 'error' | 'receivedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'varchar', length: 64, fieldName: 'adapter_id' })
  adapterId!: string;

  @Property({ type: 'varchar', length: 128, fieldName: 'event_id' })
  eventId!: string;

  @Property({ type: 'varchar', length: 64, fieldName: 'event_type' })
  eventType!: string;

  @Property({ type: 'varchar', length: 24, fieldName: 'state' })
  @Index()
  state: InvoiceLedgerWebhookReceiptState = 'received';

  @Property({ type: 'integer', fieldName: 'attempts' })
  attempts: number = 0;

  @Property({ type: 'timestamptz', fieldName: 'received_at' })
  receivedAt: Date = new Date();

  @Property({ type: 'timestamptz', fieldName: 'applied_at', nullable: true })
  appliedAt?: Date | null;

  @Property({ type: 'text', fieldName: 'error', nullable: true })
  error?: string | null;
}
