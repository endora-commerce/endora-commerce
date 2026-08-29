import { Entity, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * BlogTag — horizontal label attached to Posts. `code` is globally unique
 * across the whole platform (R14) — no per-channel scope. Block-on-delete
 * contract is enforced at the service layer (see `BlogTagService.remove`).
 */
@GlobalEntity()
@Entity({ tableName: 'blog_tags' })
export class BlogTag {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'deletedAt'
    | 'description'
    | 'version'
    | 'name';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'json' })
  name: Record<string, string> = {};

  @Property({ type: 'json', nullable: true })
  description?: Record<string, string> | null;

  @Property({ type: 'string', length: 64 })
  code!: string;

  @Property({ type: 'integer' })
  version: number = 1;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();

  @Property({ type: 'datetime', fieldName: 'deleted_at', nullable: true })
  deletedAt?: Date | null;
}
