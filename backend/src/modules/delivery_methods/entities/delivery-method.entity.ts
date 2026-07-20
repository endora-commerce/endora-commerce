import { Entity, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { GlobalEntity } from '../../../tenancy/org-scoped.decorator.js';
import { randomUUID } from 'crypto';

/**
 * DeliveryMethod — a configurable shipping option (courier, pickup, pallet).
 * Referenced by Order at creation time; the cost is captured as a snapshot
 * on the Order so later changes to this row do not rewrite history.
 */
@GlobalEntity()
@Entity({ tableName: 'delivery_methods' })
export class DeliveryMethod {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'status'
    | 'cost'
    | 'adapter'
    | 'statusOnSuccess'
    | 'statusOnFailure';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 64 })
  @Unique()
  code!: string;

  @Property({ type: 'json' })
  name!: Record<string, string>;

  /** Flat surcharge for choosing this method — the spec's `price` (feature 035). */
  @Property({ type: 'decimal', precision: 12, scale: 2 })
  cost: string = '0';

  @Property({ type: 'string', length: 3 })
  currency!: string;

  @Property({ type: 'string', length: 16 })
  status: 'active' | 'inactive' = 'active';

  /**
   * Registry key of the ShippingAdapter realising the logic (feature 035).
   * Backfilled from `code` for rows predating the adapter framework. Defaults
   * to '' so generic insert paths still work; an empty adapter never resolves
   * to a registered adapter, so the row is simply not offered (FR-003).
   */
  @Property({ type: 'string', length: 64 })
  adapter: string = '';

  /** Order-status reference applied when shipment generation succeeds. */
  @Property({ type: 'string', length: 64 })
  statusOnSuccess: string = 'shipment_sent';

  /** Order-status reference applied when shipment generation fails. */
  @Property({ type: 'string', length: 64 })
  statusOnFailure: string = 'processing';

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
