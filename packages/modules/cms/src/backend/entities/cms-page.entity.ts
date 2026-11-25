import { OptionalProps } from '@mikro-orm/core';
import { Entity, Index, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';
import type { CmsPageTranslations } from '@endora-commerce/contracts';

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
    | 'version'
    | 'parentPageId'
    | 'breadcrumbsVisible'
    | 'breadcrumbsScheme'
    | 'shareImageAssetId'
    | 'parentPathInUrl'
    | 'breadcrumbsOverlay'
    | 'translations';

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
   * Page Builder content envelope: `{ languages: { <lang>: <PuckTree> } }`.
   * Treated as opaque JSONB at this layer; the in-process content walkers
   * inspect specific shapes at the service layer.
   */
  @Property({ type: 'json' })
  content: Record<string, unknown> = { languages: {} };

  /** Array of BCP-47 language codes the page supports. */
  @Property({ type: 'json' })
  languages: string[] = [];

  @Property({ type: 'integer' })
  version: number = 1;

  // ── Feature 163 fields (data-model §1.1) ────────────────────────────

  /**
   * The breadcrumb parent. It shapes the trail, and the URL only when
   * `parentPathInUrl` is set (R19D; FR-030 as amended).
   * The database clears it when the parent is deleted (`on delete set null`);
   * the `cms_page.update` Command refuses a self-parent, a cycle and a chain
   * deeper than eight.
   */
  @Property({ type: 'uuid', nullable: true })
  @Index({ name: 'cms_pages_parent_page_id_idx' })
  parentPageId?: string | null;

  @Property({ type: 'boolean' })
  breadcrumbsVisible: boolean = true;

  @Property({ type: 'text' })
  breadcrumbsScheme: 'light' | 'muted' | 'dark' = 'light';

  /** An `assets_library` asset id — not a foreign key; see the migration. */
  @Property({ type: 'uuid', nullable: true })
  shareImageAssetId?: string | null;

  // ── R19D (feature 163, data-model §1.1) ─────────────────────────────

  /**
   * Serve the page at its parent's public path plus its own slug. Off by
   * default, so a stored page keeps its flat address; the path is computed on
   * read (`cmsPagePublicPaths`), never stored.
   */
  @Property({ type: 'boolean' })
  parentPathInUrl: boolean = false;

  // ── R21H (feature 163, data-model §1.1) ─────────────────────────────

  /**
   * Draw the breadcrumb trail over the page's first section instead of in a
   * band above it. Off by default, so a stored page keeps its band.
   */
  @Property({ type: 'boolean' })
  breadcrumbsOverlay: boolean = false;

  // ── R24 (feature 163, issue #521) ───────────────────────────────────

  /**
   * The page's name, slug and description per language:
   * `{ <lang>: { name?, slug?, description? } }`. A language without an entry,
   * or a blank field, inherits the page's own `name`, `slug` and `description`
   * (`cmsLocalizedPage`). `{}` by default, so every stored page reads as before.
   */
  @Property({ type: 'json' })
  translations: CmsPageTranslations = {};
}
