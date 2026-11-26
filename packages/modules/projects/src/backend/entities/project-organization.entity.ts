import { Entity, PrimaryKey } from '@mikro-orm/decorators/legacy';
import { RuleScoped } from '@endora-commerce/platform/tenancy';

/**
 * An Organization a Project is for — the one foreign key out of the module
 * (`organizations`, `on delete restrict`). Read only through `ProjectAccess`.
 */
@RuleScoped()
@Entity({ tableName: 'project_organizations' })
export class ProjectOrganization {
  @PrimaryKey({ type: 'uuid' })
  projectId!: string;

  @PrimaryKey({ type: 'uuid' })
  organizationId!: string;
}
