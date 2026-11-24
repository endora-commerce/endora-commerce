import { Entity, PrimaryKey } from '@mikro-orm/decorators/legacy';
import { RuleScoped } from '@endora-commerce/platform/tenancy';

/**
 * A person listed on a Project — who sees it under `members_and_listed`
 * without being a Member (research R-3). Read only through `ProjectAccess`.
 */
@RuleScoped()
@Entity({ tableName: 'project_viewers' })
export class ProjectViewer {
  @PrimaryKey({ type: 'uuid' })
  projectId!: string;

  @PrimaryKey({ type: 'uuid' })
  adminUserId!: string;
}
