import { OptionalProps } from '@mikro-orm/core';
import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import { RuleScoped } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * An administrator who is a Member of a Project, once per Project (research
 * R-4). The administrator is held by value; their Roles are
 * `ProjectMemberRole` rows. Read only through `ProjectAccess`.
 */
@RuleScoped()
@Entity({ tableName: 'project_members' })
export class ProjectMember {
  [OptionalProps]?: 'id' | 'addedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  projectId!: string;

  @Property({ type: 'uuid' })
  adminUserId!: string;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  addedAt: Date = new Date();
}
