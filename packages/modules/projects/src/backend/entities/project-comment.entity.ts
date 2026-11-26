import { OptionalProps } from '@mikro-orm/core';
import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import type { ProjectCommentKind } from '@endora-commerce/contracts';
import { RuleScoped } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * A note or a message on a Project (research R-13). A note is edited and
 * deleted by its author only; a message never changes (FR-025). The body is
 * plain text carrying reference tokens.
 */
@RuleScoped()
@Entity({ tableName: 'project_comments' })
export class ProjectComment {
  [OptionalProps]?: 'id' | 'editedAt' | 'deletedAt' | 'createdAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  projectId!: string;

  @Property({ type: 'text' })
  kind!: ProjectCommentKind;

  @Property({ type: 'text' })
  body!: string;

  @Property({ type: 'uuid' })
  authorAdminUserId!: string;

  @Property({ type: 'datetime', nullable: true })
  editedAt?: Date | null;

  /** Notes only. */
  @Property({ type: 'datetime', nullable: true })
  deletedAt?: Date | null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();
}
