import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

/**
 * Category — hierarchical node in the catalog tree.
 * `parentCategoryId` is null for roots. `slug` is kebab-case; uniqueness is
 * enforced per-parent at the migration level.
 */
@Entity({ tableName: 'categories' })
export class Category {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'parentCategoryId'
    | 'sortOrder'
    | 'metaTitleOverride'
    | 'metaDescriptionOverride'
    | 'deletedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid', nullable: true })
  @Index()
  parentCategoryId?: string | null;

  @Property({ type: 'json' })
  name!: Record<string, string>;

  @Property({ type: 'string', length: 160 })
  @Index()
  slug!: string;

  @Property({ type: 'integer' })
  sortOrder: number = 0;

  @Property({ type: 'json', nullable: true })
  metaTitleOverride?: Record<string, string> | null;

  @Property({ type: 'json', nullable: true })
  metaDescriptionOverride?: Record<string, string> | null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();

  @Property({ type: 'datetime', nullable: true })
  deletedAt?: Date | null;
}
