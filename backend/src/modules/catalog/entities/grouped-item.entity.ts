import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

/**
 * GroupedItem — child entry of a parent product whose `type='grouped'`
 * (feature 002 US5, data-model.md §2.8).
 *
 * DB-level guarantees (migration 023):
 *   - UNIQUE (parent, child) — same child can't be listed twice
 *   - CHECK quantity > 0
 *   - CHECK parent <> child  (no self-grouping; deeper nesting is blocked
 *     at the service layer — the child's `type` must be in {simple,
 *     configurable, virtual}).
 */
@Entity({ tableName: 'grouped_items' })
export class GroupedItem {
  [OptionalProps]?: 'id' | 'position' | 'createdAt' | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  parentProductId!: string;

  @Property({ type: 'uuid' })
  childProductId!: string;

  @Property({ type: 'integer' })
  quantity!: number;

  @Property({ type: 'integer' })
  position: number = 0;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
