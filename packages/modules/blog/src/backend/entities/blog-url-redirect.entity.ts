import { Entity, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * BlogUrlRedirect — a former URL key of a post or category in one language, answering
 * a permanent redirect to the entity's current URL there (feature 171, data-model
 * §1.2). It stores the entity, never a target key, so redirects never chain. Serving
 * it is `seo`'s decision, as for products (163 Q-C).
 */
@GlobalEntity()
@Entity({ tableName: 'blog_url_redirects' })
export class BlogUrlRedirect {
  [OptionalProps]?: 'id' | 'createdAt';

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
}
