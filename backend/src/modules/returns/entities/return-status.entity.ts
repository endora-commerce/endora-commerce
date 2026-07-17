import { Entity, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { GlobalEntity } from '../../../tenancy/org-scoped.decorator.js';
import { randomUUID } from 'crypto';

/**
 * ReturnStatus — feature 046 (configurable RMA lifecycle, US3).
 *
 * A named state in the admin-configurable return/complaint lifecycle. The set is
 * seeded with the defaults (data-model.md) and editable at runtime. `code` is the
 * stable machine identifier referenced by `return_cases.status_code`. Exactly one
 * row carries `isInitial = true` (`new`); `isTerminal` rows have no outgoing
 * transitions.
 */
@GlobalEntity()
@Entity({ tableName: 'return_statuses' })
export class ReturnStatus {
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

  /** Localized labels, e.g. { en: 'New', pl: 'Nowe' }. */
  @Property({ type: 'json' })
  name!: Record<string, string>;

  /** Language-independent fallback when the active language is missing from `name`. */
  @Property({ type: 'string', length: 120 })
  defaultName!: string;

  @Property({ type: 'boolean' })
  isInitial: boolean = false;

  @Property({ type: 'boolean' })
  isTerminal: boolean = false;

  /** System statuses are protected from deletion. */
  @Property({ type: 'boolean' })
  isSystem: boolean = false;

  @Property({ type: 'integer' })
  weight: number = 100;

  /** Badge colour as a `#rrggbb` hex value. */
  @Property({ type: 'string', length: 16 })
  color: string = '#64748b';

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
