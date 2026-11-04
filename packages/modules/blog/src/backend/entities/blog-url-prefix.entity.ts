import { Entity, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * BlogUrlPrefix — a blog URL prefix a sales channel serves (`current`) or has served
 * (`former`), per language; `languageCode` null is the channel default
 * (feature 171, `specs/171-blog-i18n-authors/` data-model §1.3). A former prefix
 * redirects to the current one. Maintained by `BlogUrlPrefixService`; the settings
 * module stays the authority on what the prefix *is*.
 */
@GlobalEntity()
@Entity({ tableName: 'blog_url_prefixes' })
export class BlogUrlPrefix {
  [OptionalProps]?: 'id' | 'createdAt' | 'updatedAt' | 'languageCode';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid', fieldName: 'sales_channel_id' })
  salesChannelId!: string;

  @Property({ type: 'string', length: 16, fieldName: 'language_code', nullable: true })
  languageCode: string | null = null;

  @Property({ type: 'string', length: 64 })
  prefix!: string;

  @Property({ type: 'string', length: 8 })
  state!: 'current' | 'former';

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
