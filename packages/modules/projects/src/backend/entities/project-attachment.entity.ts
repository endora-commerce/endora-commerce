import { OptionalProps } from '@mikro-orm/core';
import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import { RuleScoped } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * A media-library asset attached to a Project, once per Project. The asset is
 * held by value; the library refuses to delete it while it is attached.
 */
@RuleScoped()
@Entity({ tableName: 'project_attachments' })
export class ProjectAttachment {
  [OptionalProps]?: 'id' | 'addedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  projectId!: string;

  @Property({ type: 'uuid' })
  assetId!: string;

  @Property({ type: 'uuid' })
  addedByAdminUserId!: string;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  addedAt: Date = new Date();
}
