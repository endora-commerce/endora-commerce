import { OptionalProps } from '@mikro-orm/core';
import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * A Project Template — a reusable structure of Stages, moves, Stage Tasks and
 * Roles (`specs/163-projects-and-tasks/data-model.md` §2.1). A Template is
 * **copied** into a Project, never referenced (research R-7): editing it later
 * changes no Project. It carries no Organization, Member, value or link.
 *
 * Platform-wide configuration.
 */
@GlobalEntity()
@Entity({ tableName: 'project_templates' })
export class ProjectTemplate {
  [OptionalProps]?: 'id' | 'description' | 'archivedAt' | 'createdByAdminUserId' | 'createdAt' | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'text' })
  name!: string;

  /** The default description a Project created from it starts with; reference tokens allowed. */
  @Property({ type: 'text' })
  description: string = '';

  @Property({ type: 'datetime', nullable: true })
  archivedAt?: Date | null;

  @Property({ type: 'uuid', nullable: true })
  createdByAdminUserId?: string | null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
