import { OptionalProps } from '@mikro-orm/core';
import { Entity, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * A Project Role — *Sales Rep*, *Project Manager*, or one the operator added
 * (`specs/163-projects-and-tasks/data-model.md` §2.1). A label a Member holds
 * on a Project; it grants no permission (FR-009).
 *
 * Platform-wide configuration. The two seeded rows are `isSystem`: renamable
 * and archivable, never deletable. An archived Role stays on the Projects that
 * hold it and is no longer offered.
 */
@GlobalEntity()
@Entity({ tableName: 'project_roles' })
export class ProjectRole {
  [OptionalProps]?: 'id' | 'name' | 'isSystem' | 'archivedAt' | 'createdAt' | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  /** `sales_rep`, `project_manager`, or the slug of an operator's Role; immutable. */
  @Property({ type: 'text' })
  @Unique()
  code!: string;

  /** Names per admin language, e.g. `{ en: 'Sales Rep', pl: 'Handlowiec' }`, read with `pickLocalized`. */
  @Property({ type: 'json' })
  name: Record<string, string> = {};

  /** Fallback when the reader's language is missing from `name`. */
  @Property({ type: 'text' })
  defaultName!: string;

  @Property({ type: 'boolean' })
  isSystem: boolean = false;

  @Property({ type: 'datetime', nullable: true })
  archivedAt?: Date | null;

  @Property({ type: 'integer' })
  position!: number;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
