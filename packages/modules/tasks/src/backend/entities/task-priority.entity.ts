import { OptionalProps } from '@mikro-orm/core';
import { Entity, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * A priority a Task may carry (research R-9) — held by code on the Task, never
 * by foreign key. A lower weight is more urgent. Platform-wide configuration.
 */
@GlobalEntity()
@Entity({ tableName: 'task_priorities' })
export class TaskPriority {
  [OptionalProps]?: 'id' | 'name' | 'weight' | 'color' | 'createdAt' | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 64 })
  @Unique()
  code!: string;

  @Property({ type: 'json' })
  name: Record<string, string> = {};

  @Property({ type: 'string', length: 120 })
  defaultName!: string;

  @Property({ type: 'string', length: 16 })
  color: string = '#64748b';

  @Property({ type: 'integer' })
  weight: number = 100;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
