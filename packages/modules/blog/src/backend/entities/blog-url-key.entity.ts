import { Entity, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * BlogUrlKey — a post's or category's URL key in one language (feature 171,
 * data-model §1.1). A language without one is served at the entity's base `slug`.
 * Maintained by `BlogUrlKeyService`, which enforces uniqueness per (channel, language).
 */
@GlobalEntity()
@Entity({ tableName: 'blog_url_keys' })
export class BlogUrlKey {
  [OptionalProps]?: 'id' | 'createdAt' | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 16, fieldName: 'entity_kind' })
  entityKind!: 'post' | 'category';

  @Property({ type: 'uuid', fieldName: 'entity_id' })
  entityId!: string;

  @Property({ type: 'string', length: 16, fieldName: 'language_code' })
  languageCode!: string;

  @Property({ type: 'string', length: 160 })
  key!: string;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
