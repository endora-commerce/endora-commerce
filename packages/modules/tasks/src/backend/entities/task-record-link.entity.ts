import { OptionalProps } from '@mikro-orm/core';
import { Entity, Index, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';
import type { TaskLinkKind } from '@endora-commerce/contracts';
import { RuleScoped } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * A link from a Task to an Opportunity, an Order or a Quote Request (research
 * R-16). The record is held by value and resolved per reader; a link narrows
 * nobody's visibility of the Task (Q2 = A).
 */
@RuleScoped()
@Entity({ tableName: 'task_record_links' })
@Unique({ properties: ['taskId', 'recordKind', 'recordId'] })
@Index({ properties: ['recordKind', 'recordId'] })
export class TaskRecordLink {
  [OptionalProps]?: 'id' | 'createdAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  taskId!: string;

  @Property({ type: 'string', length: 32 })
  recordKind!: TaskLinkKind;

  @Property({ type: 'uuid' })
  recordId!: string;

  @Property({ type: 'uuid' })
  linkedByAdminUserId!: string;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();
}
