import { Entity, PrimaryKey } from '@mikro-orm/decorators/legacy';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';

/** A Project Role a Template names — offered first when a Project is created from it. */
@GlobalEntity()
@Entity({ tableName: 'project_template_roles' })
export class ProjectTemplateRole {
  @PrimaryKey({ type: 'uuid' })
  templateId!: string;

  @PrimaryKey({ type: 'uuid' })
  roleId!: string;
}
