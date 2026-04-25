import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

/**
 * CmsPage — editorial content authored by Admin Users (T234 / FR-100).
 *
 * `path` is a kebab-case URL fragment unique installation-wide
 * (e.g. `about-us`, `policies/privacy`). Title and body are multilingual
 * JSONB so a single page can ship copy in every supported language.
 */
@Entity({ tableName: 'cms_pages' })
export class CmsPage {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'status'
    | 'publishedAt'
    | 'archivedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 180 })
  @Unique()
  @Index()
  path!: string;

  @Property({ type: 'string', length: 16 })
  @Index()
  status: 'draft' | 'published' | 'archived' = 'draft';

  @Property({ type: 'json' })
  title!: Record<string, string>;

  @Property({ type: 'json' })
  body!: Record<string, string>;

  @Property({ type: 'datetime', nullable: true })
  publishedAt?: Date | null;

  @Property({ type: 'datetime', nullable: true })
  archivedAt?: Date | null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
