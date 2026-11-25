import { OptionalProps } from '@mikro-orm/core';
import { Entity, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * A loss reason — why a Project was lost: *Price*, *Chose a competitor*, …, or
 * one the operator added (`specs/163-projects-and-tasks/data-model.md` §2.1).
 * Closing a Project as lost requires one that is not archived (FR-005).
 *
 * Platform-wide configuration. The five seeded rows are `isSystem`: renamable
 * and archivable, never deletable. An archived reason stays on the Projects
 * lost for it and is no longer offered.
 */
@GlobalEntity()
@Entity({ tableName: 'project_loss_reasons' })
export class ProjectLossReason {
  [OptionalProps]?: 'id' | 'name' | 'isSystem' | 'archivedAt' | 'createdAt' | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  /** `price`, `competitor`, `cancelled_by_client`, `no_decision`, `other`, or the slug of an operator's reason; immutable. */
  @Property({ type: 'text' })
  @Unique()
  code!: string;

  /** Names per admin language, e.g. `{ en: 'Price', pl: 'Cena' }`, read with `pickLocalized`. */
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
