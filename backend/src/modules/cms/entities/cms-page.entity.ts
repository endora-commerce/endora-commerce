import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { GlobalEntity } from '../../../tenancy/org-scoped.decorator.js';
import { randomUUID } from 'crypto';

/**
 * CmsPage — feature 014 successor to the pre-014 cms_pages entity. Adds
 * Page Builder–driven content (per language), sales-channel + language
 * scope, slug-based routing (per channel), and a draft/published/archived
 * lifecycle inherited from the legacy module. The legacy `path`, `title`,
 * and `body` columns are retained for one release as legacy mirrors —
 * new code reads `slug`, `name`, and `content`.
 */
@GlobalEntity()
@Entity({ tableName: 'cms_pages' })
export class CmsPage {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'status'
    | 'publishedAt'
    | 'archivedAt'
    | 'name'
    | 'slug'
    | 'active'
    | 'description'
    | 'metaTitle'
    | 'metaDescription'
    | 'metaKeywords'
    | 'content'
    | 'languages'
    | 'version';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  /**
   * @deprecated Use `slug`. Retained for one release while pre-014 imports settle.
   */
  @Property({ type: 'string', length: 180 })
  @Unique()
  @Index()
  path!: string;

  @Property({ type: 'string', length: 16 })
  @Index()
  status: 'draft' | 'published' | 'archived' = 'draft';

  /** @deprecated Use `name` + `metaTitle`. Retained for one release. */
  @Property({ type: 'json' })
  title!: Record<string, string>;

  /** @deprecated Use `content`. Retained for one release for the asset-ref scan's legacy fallback. */
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

  // ── Feature 014 fields ──────────────────────────────────────────────

  @Property({ type: 'string', length: 200 })
  name: string = '';

  @Property({ type: 'string', length: 180 })
  @Index()
  slug: string = '';

  @Property({ type: 'boolean' })
  active: boolean = true;

  @Property({ type: 'text', nullable: true })
  description?: string | null;

  @Property({ type: 'json', nullable: true })
  metaTitle?: Record<string, string> | null;

  @Property({ type: 'json', nullable: true })
  metaDescription?: Record<string, string> | null;

  @Property({ type: 'json', nullable: true })
  metaKeywords?: Record<string, string> | null;

  /**
   * Page Builder content envelope: `{ schema_version, languages: { <lang>: <PuckTree> } }`.
   * Treated as opaque JSONB at this layer; the in-process content walkers
   * inspect specific shapes at the service layer.
   */
  @Property({ type: 'json' })
  content: Record<string, unknown> = { schema_version: 1, languages: {} };

  /** Array of BCP-47 language codes the page supports. */
  @Property({ type: 'json' })
  languages: string[] = [];

  @Property({ type: 'integer' })
  version: number = 1;
}
