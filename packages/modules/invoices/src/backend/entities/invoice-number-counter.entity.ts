import { Entity, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * Per-scope invoice number counter (feature 047, research R3). One row per
 * (salesChannelId, kind, periodYear); a new row at the first issuance of a year
 * IS the yearly reset. Drawn under a pessimistic row lock so concurrent
 * issuance in the same scope never duplicates a number.
 */
@GlobalEntity()
@Entity({ tableName: 'invoice_number_counters' })
@Unique({ properties: ['salesChannelId', 'kind', 'periodYear'] })
export class InvoiceNumberCounter {
  [OptionalProps]?: 'id' | 'currentValue' | 'createdAt' | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  salesChannelId!: string;

  @Property({ type: 'string', length: 16 })
  kind!: 'proforma' | 'invoice' | 'correction';

  @Property({ type: 'integer' })
  periodYear!: number;

  @Property({ type: 'integer' })
  currentValue: number = 0;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
