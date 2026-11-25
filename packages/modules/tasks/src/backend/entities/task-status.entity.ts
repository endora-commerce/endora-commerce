import { OptionalProps } from '@mikro-orm/core';
import { Entity, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';
import type { TaskStatusCategory } from '@endora-commerce/contracts';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * A status of the configurable Task workflow (research R-1), modelled on CRM's.
 * `code` is what `tasks.status` holds by value, and is immutable after create.
 * `category` says what the status means for the Task — still worked, finished
 * or abandoned; *closed* is `done` or `cancelled`. At most one row is initial
 * (a partial unique index); the graph requires exactly one, and that it is open.
 *
 * Platform-wide configuration.
 */
@GlobalEntity()
@Entity({ tableName: 'task_statuses' })
export class TaskStatus {
  [OptionalProps]?: 'id' | 'name' | 'isInitial' | 'weight' | 'color' | 'createdAt' | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 64 })
  @Unique()
  code!: string;

  /** Localized labels, e.g. `{ en: 'To do', pl: 'Do zrobienia' }`. */
  @Property({ type: 'json' })
  name: Record<string, string> = {};

  /** Fallback when the viewer's language is missing from `name`. */
  @Property({ type: 'string', length: 120 })
  defaultName!: string;

  @Property({ type: 'string', length: 16 })
  category!: TaskStatusCategory;

  @Property({ type: 'boolean' })
  isInitial: boolean = false;

  /** Display order, and the board's column order. */
  @Property({ type: 'integer' })
  weight: number = 100;

  /** `#rrggbb`. */
  @Property({ type: 'string', length: 16 })
  color: string = '#64748b';

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
