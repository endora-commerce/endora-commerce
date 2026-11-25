import { OptionalProps } from '@mikro-orm/core';
import { Entity, Index, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';
import { RuleScoped } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * A file attached to a Task (research R-7): an asset of the asset library,
 * uploaded as private, attached once per Task. The asset reference registry
 * protects an attached asset from deletion.
 */
@RuleScoped()
@Entity({ tableName: 'task_attachments' })
@Unique({ properties: ['taskId', 'assetId'] })
export class TaskAttachment {
  [OptionalProps]?: 'id' | 'createdAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  taskId!: string;

  @Property({ type: 'uuid' })
  @Index()
  assetId!: string;

  @Property({ type: 'uuid' })
  addedByAdminUserId!: string;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();
}
