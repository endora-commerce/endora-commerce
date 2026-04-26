import { Entity, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

/**
 * PriceList — a named, currency-scoped collection of pricing rules. A
 * single installation typically has one default list plus per-group and
 * per-organization specials.
 *
 * `priority` orders lists during resolution (higher = preferred), but the
 * resolver always returns the most favourable price across all matching
 * lists when the configured policy is the default (FR-050).
 */
@Entity({ tableName: 'price_lists' })
export class PriceList {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'isDefault'
    | 'priority';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 64 })
  @Unique()
  code!: string;

  @Property({ type: 'string', length: 160 })
  name!: string;

  @Property({ type: 'string', length: 3 })
  currency!: string;

  @Property({ type: 'boolean' })
  isDefault: boolean = false;

  @Property({ type: 'integer' })
  priority: number = 0;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
