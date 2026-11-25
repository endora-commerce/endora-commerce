import { OptionalProps } from '@mikro-orm/core';
import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import type { RecordReferenceType } from '@endora-commerce/contracts';
import { RuleScoped } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * A reference token found in a Project's description or in one of its
 * comments (research R-14), stored so "where is this record mentioned" is an
 * index read. The target is held by value and resolved through its owner.
 */
@RuleScoped()
@Entity({ tableName: 'project_references' })
export class ProjectReference {
  [OptionalProps]?: 'id' | 'sourceId';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  projectId!: string;

  @Property({ type: 'text' })
  sourceKind!: 'description' | 'comment';

  /** The comment's id; `null` for the description. */
  @Property({ type: 'uuid', nullable: true })
  sourceId?: string | null;

  @Property({ type: 'text' })
  targetType!: RecordReferenceType;

  @Property({ type: 'uuid' })
  targetId!: string;
}
