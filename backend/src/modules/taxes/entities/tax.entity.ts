import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

/**
 * Tax — a single rule. Resolution narrows by `country`, `productType`, and
 * `appliesToVatStatuses` (T128 / FR-051). At most one row may carry
 * `isDefault=true`; that row wins when no narrower rule matches.
 */
@Entity({ tableName: 'taxes' })
export class Tax {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'country'
    | 'productType'
    | 'appliesToVatStatuses'
    | 'isDefault'
    | 'priority';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 64 })
  @Unique()
  code!: string;

  @Property({ type: 'string', length: 160 })
  name!: string;

  @Property({ type: 'decimal', precision: 6, scale: 4 })
  rate!: string;

  @Property({ type: 'string', length: 2, nullable: true })
  @Index()
  country?: string | null;

  @Property({ type: 'string', length: 16, nullable: true })
  productType?: 'simple' | 'configurable' | 'grouped' | 'bundle' | 'virtual' | null;

  @Property({ type: 'json' })
  appliesToVatStatuses: Array<'vat_payer' | 'vat_exempt' | 'reverse_charge'> = [];

  @Property({ type: 'boolean' })
  isDefault: boolean = false;

  @Property({ type: 'integer' })
  priority: number = 0;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
