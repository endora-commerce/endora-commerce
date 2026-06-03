import { Entity, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

/**
 * OrderStatus — feature 038 (configurable lifecycle, US1).
 *
 * A named state in the admin-configurable order lifecycle. The set is seeded
 * with the 9 defaults (data-model.md §1) and editable at runtime. `code` is the
 * stable machine identifier referenced by `orders.status`; `name` holds the
 * localized labels. Exactly one row carries `isInitial = true` (`new`, which is
 * non-deletable); `isTerminal` rows have no outgoing transitions.
 */
@Entity({ tableName: 'order_statuses' })
export class OrderStatus {
  [OptionalProps]?:
    | 'id'
    | 'isInitial'
    | 'isTerminal'
    | 'isSystem'
    | 'weight'
    | 'color'
    | 'createdAt'
    | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 64 })
  @Unique()
  code!: string;

  /** Localized labels, e.g. { en: 'New', pl: 'Nowy' }. */
  @Property({ type: 'json' })
  name!: Record<string, string>;

  /** Language-independent fallback when the active language is missing from `name`. */
  @Property({ type: 'string', length: 120 })
  defaultName!: string;

  @Property({ type: 'boolean' })
  isInitial: boolean = false;

  @Property({ type: 'boolean' })
  isTerminal: boolean = false;

  /** System statuses (new, on_hold, cancelled, completed); `new` is non-deletable. */
  @Property({ type: 'boolean' })
  isSystem: boolean = false;

  @Property({ type: 'integer' })
  weight: number = 100;

  /** Badge colour as a `#rrggbb` hex value; neutral slate by default. */
  @Property({ type: 'string', length: 16 })
  color: string = '#64748b';

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
