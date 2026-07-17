import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '../../../tenancy/org-scoped.decorator.js';
import { randomUUID } from 'crypto';

/**
 * Immutable snapshot of one invoice line at issuance (feature 047). Independent
 * of later order edits. For corrections, holds the corrected delta lines.
 */
@GlobalEntity()
@Entity({ tableName: 'invoice_lines' })
@Index({ properties: ['invoiceId', 'ordinal'] })
export class InvoiceLine {
  [OptionalProps]?: 'id' | 'orderItemId';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  invoiceId!: string;

  @Property({ type: 'integer' })
  ordinal!: number;

  @Property({ type: 'string', length: 512 })
  name!: string;

  @Property({ type: 'string', length: 32 })
  unit!: string;

  @Property({ type: 'decimal', precision: 12, scale: 3 })
  quantity!: string;

  @Property({ type: 'decimal', precision: 14, scale: 4 })
  unitNetPrice!: string;

  @Property({ type: 'decimal', precision: 5, scale: 4 })
  taxRate!: string;

  @Property({ type: 'decimal', precision: 14, scale: 2 })
  netValue!: string;

  @Property({ type: 'decimal', precision: 14, scale: 2 })
  grossValue!: string;

  @Property({ type: 'uuid', nullable: true })
  orderItemId?: string | null;
}
