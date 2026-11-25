import { OptionalProps } from '@mikro-orm/core';
import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import { TransitivelyScoped } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * OrderItemGroup — a named, ordered group of an order's lines (feature 159,
 * `specs/159-quote-request-item-groups/data-model.md` §2.1).
 *
 * Written once, inside `OrderService.placeOrder`'s transaction — carried from
 * the quote the order was placed from, or laid out by the administrator who
 * created the order — and never changed (research R-18), hence no
 * `updatedAt`. Every stored group holds at least one line.
 *
 * Classified `@TransitivelyScoped('Order', 'orderId')` (research R-7): a group
 * has no tenant column and belongs to exactly one `@OrgScoped` order. The
 * classification attaches no query filter, so groups are only read by the id
 * of an order the caller has already been allowed to read.
 */
@TransitivelyScoped('Order', 'orderId')
@Entity({ tableName: 'order_item_groups' })
export class OrderItemGroup {
  [OptionalProps]?: 'id' | 'createdAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  orderId!: string;

  /** Trimmed, 1–120 characters. Operator content, never translated. */
  @Property({ type: 'string', length: 120 })
  name!: string;

  /** 0-based order among the order's groups. */
  @Property({ type: 'integer' })
  position!: number;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();
}
