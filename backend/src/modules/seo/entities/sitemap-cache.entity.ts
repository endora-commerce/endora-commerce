import { Entity, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '../../../tenancy/org-scoped.decorator.js';

/**
 * Single-row sitemap cache (T235 / FR-102). The generator overwrites
 * `payload` on each regenerate; the public route streams it back. A
 * `staleAfterMs` configuration in the service triggers an inline
 * regeneration when the row is older than the threshold.
 */
@GlobalEntity()
@Entity({ tableName: 'sitemap_cache' })
export class SitemapCache {
  [OptionalProps]?: 'generatedAt' | 'urlCount' | 'byteSize';

  /** Stable singleton id — there is at most one sitemap per installation. */
  @PrimaryKey({ type: 'string', length: 32 })
  key: string = 'default';

  @Property({ type: 'text' })
  payload!: string;

  @Property({ type: 'integer' })
  urlCount: number = 0;

  @Property({ type: 'integer' })
  byteSize: number = 0;

  @Property({ type: 'datetime' })
  generatedAt: Date = new Date();
}
