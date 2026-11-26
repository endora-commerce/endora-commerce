import { Entity, PrimaryKey } from '@mikro-orm/decorators/legacy';
import { RuleScoped } from '@endora-commerce/platform/tenancy';

/** A Project Role a Member holds on their Project — zero or more per Member (FR-008). */
@RuleScoped()
@Entity({ tableName: 'project_member_roles' })
export class ProjectMemberRole {
  @PrimaryKey({ type: 'uuid' })
  memberId!: string;

  @PrimaryKey({ type: 'uuid' })
  roleId!: string;
}
