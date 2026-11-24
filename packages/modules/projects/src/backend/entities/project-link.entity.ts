import { OptionalProps } from '@mikro-orm/core';
import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import type { ProjectRecordKind } from '@endora-commerce/contracts';
import { RuleScoped } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * An Order, a Quote Request or an Opportunity linked to a Project (research
 * R-10). The record is held by value; a record belongs to at most one Project.
 * `organizationId` is the record's Organization, read from its owner when the
 * link is made — one of the Project's, held there by a foreign key, so an
 * Organization a record is linked under cannot be removed from the Project.
 */
@RuleScoped()
@Entity({ tableName: 'project_links' })
export class ProjectLink {
  [OptionalProps]?: 'id' | 'linkedByAdminUserId' | 'linkedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  projectId!: string;

  @Property({ type: 'text' })
  recordKind!: ProjectRecordKind;

  @Property({ type: 'uuid' })
  recordId!: string;

  @Property({ type: 'uuid' })
  organizationId!: string;

  @Property({ type: 'uuid', nullable: true })
  linkedByAdminUserId?: string | null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  linkedAt: Date = new Date();
}
