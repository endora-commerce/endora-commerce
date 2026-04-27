import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

@Entity({ tableName: 'invoices' })
export class Invoice {
  [OptionalProps]?: 'id' | 'createdAt' | 'updatedAt' | 'pdfAssetId' | 'status' | 'issuedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  orderId!: string;

  @Property({ type: 'string', length: 16 })
  kind!: 'proforma' | 'invoice' | 'correction';

  @Property({ type: 'string', length: 64 })
  @Unique()
  number!: string;

  @Property({ type: 'datetime' })
  issuedAt: Date = new Date();

  @Property({ type: 'string', length: 3 })
  currency!: string;

  @Property({ type: 'decimal', precision: 14, scale: 2 })
  total!: string;

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
