import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * BlogCategory — adjacency-list tree node. The `name`, `description`,
 * `meta_*` columns are jsonb maps (per language); per-language enforcement
 * happens at the Zod boundary (`packages/contracts/src/blog.ts`).
 *
 * `parent_id` is a self-FK with ON DELETE NO ACTION because feature spec
 * FR-007 refuses deletion of a Category with children. `position` is the
 * 0..N-1 sort key per `(parent_id)`. `is_system = true` flags the seeded
 * `Default` Category (FR-005, R11) — protected from deletion at the
 * service layer.
 */
@GlobalEntity()
@Entity({ tableName: 'blog_categories' })
@Index({ name: 'idx_blog_categories_parent_position', properties: ['parentId', 'position'] })
export class BlogCategory {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'deletedAt'
    | 'parentId'
    | 'position'
    | 'enabled'
    | 'isSystem'
    | 'version'
    | 'name'
    | 'description'
    | 'mainImageAssetId'
    | 'metaTitle'
    | 'metaDescription'
    | 'metaKeywords';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid', fieldName: 'parent_id', nullable: true })
  parentId?: string | null;

  @Property({ type: 'integer' })
  position: number = 0;

  @Property({ type: 'json' })
  name: Record<string, string> = {};

  @Property({ type: 'string', length: 160 })
  slug!: string;

  @Property({ type: 'boolean' })
  enabled: boolean = true;

  @Property({ type: 'json', nullable: true })
  description?: Record<string, unknown> | null;

  @Property({ type: 'uuid', fieldName: 'main_image_asset_id', nullable: true })
  mainImageAssetId?: string | null;

  @Property({ type: 'json', fieldName: 'meta_title', nullable: true })
  metaTitle?: Record<string, string> | null;

  @Property({ type: 'json', fieldName: 'meta_description', nullable: true })
  metaDescription?: Record<string, string> | null;

  @Property({ type: 'json', fieldName: 'meta_keywords', nullable: true })
  metaKeywords?: Record<string, string> | null;

  @Property({ type: 'boolean', fieldName: 'is_system' })
  isSystem: boolean = false;

  @Property({ type: 'integer' })
  version: number = 1;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();

  @Property({ type: 'datetime', fieldName: 'deleted_at', nullable: true })
  deletedAt?: Date | null;
}
