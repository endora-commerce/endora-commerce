import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * Per-(entity, locale) SEO override (T235 / FR-101). When present, the
 * resolver returns this row's fields verbatim and falls back to the rule
 * for any nullable column that's left empty.
 */
@GlobalEntity()
@Entity({ tableName: 'seo_meta_overrides' })
@Unique({ name: 'uniq_seo_meta_overrides_entity_locale', properties: ['entityType', 'entityId', 'locale'] })
export class SeoMetaOverride {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'title'
    | 'description'
    | 'ogTitle'
    | 'ogDescription'
    | 'ogImageUrl';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 32 })
  @Index()
  entityType!: 'product' | 'category' | 'cms_page';

  @Property({ type: 'uuid' })
  @Index()
  entityId!: string;

  @Property({ type: 'string', length: 10 })
  locale!: string;

  @Property({ type: 'string', length: 160, nullable: true })
  title?: string | null;

  @Property({ type: 'string', length: 400, nullable: true })
  description?: string | null;

  @Property({ type: 'string', length: 160, nullable: true })
  ogTitle?: string | null;

  @Property({ type: 'string', length: 400, nullable: true })
  ogDescription?: string | null;

  @Property({ type: 'string', length: 2048, nullable: true })
  ogImageUrl?: string | null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
