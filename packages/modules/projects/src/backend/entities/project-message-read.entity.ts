import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import { RuleScoped } from '@endora-commerce/platform/tenancy';

/** How far one administrator has read one Project's messages — one row per pair. */
@RuleScoped()
@Entity({ tableName: 'project_message_reads' })
export class ProjectMessageRead {
  @PrimaryKey({ type: 'uuid' })
  projectId!: string;

  @PrimaryKey({ type: 'uuid' })
  adminUserId!: string;

  @Property({ type: 'datetime' })
  lastReadAt!: Date;
}
