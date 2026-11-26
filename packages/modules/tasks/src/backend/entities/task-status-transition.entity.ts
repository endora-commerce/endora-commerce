import { OptionalProps } from '@mikro-orm/core';
import { Entity, Index, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * A permitted move `fromCode → toCode` of the Task workflow (research R-1). Both
 * ends are status codes held by value and validated by the graph. A closed
 * status may have outgoing moves: reopening is a move like any other.
 */
@GlobalEntity()
@Entity({ tableName: 'task_status_transitions' })
@Unique({ properties: ['fromCode', 'toCode'] })
export class TaskStatusTransition {
  [OptionalProps]?: 'id' | 'createdAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 64 })
  @Index()
  fromCode!: string;

  @Property({ type: 'string', length: 64 })
  toCode!: string;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();
}
