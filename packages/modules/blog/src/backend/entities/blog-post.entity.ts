import { Entity, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

export type BlogPostStatus = 'draft' | 'published' | 'archived';

/**
 * BlogPost — the editorial article. Same field shape as `cms_pages`
 * (feature 014) plus blog-specific lifecycle fields (`published_at`).
 * `name`, `meta_*` are jsonb maps (per language); `content` is the
 * Page Builder envelope per language (re-using feature 014's schema).
 *
 * The status state machine + slug-uniqueness + related-posts detach-on-
 * delete contracts live at the service layer (see
 * `services/blog-post-service.ts` once it lands in Phase 3).
 */
@GlobalEntity()
@Entity({ tableName: 'blog_posts' })
export class BlogPost {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'deletedAt'
    | 'active'
    | 'status'
    | 'publishedAt'
    | 'description'
    | 'version'
    | 'name'
    | 'content'
    | 'metaTitle'
    | 'metaDescription'
    | 'metaKeywords'
    | 'mainImageAssetId'
    | 'authorAdminUserId';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'json' })
  name: Record<string, string> = {};

  @Property({ type: 'string', length: 160 })
  slug!: string;

  @Property({ type: 'boolean' })
  active: boolean = true;

  @Property({ type: 'string', length: 16 })
  status: BlogPostStatus = 'draft';

  @Property({ type: 'datetime', fieldName: 'published_at', nullable: true })
  publishedAt?: Date | null;

  @Property({ type: 'text', nullable: true })
  description?: string | null;

  @Property({ type: 'json', fieldName: 'meta_title', nullable: true })
  metaTitle?: Record<string, string> | null;

  @Property({ type: 'json', fieldName: 'meta_description', nullable: true })
  metaDescription?: Record<string, string> | null;

  @Property({ type: 'json', fieldName: 'meta_keywords', nullable: true })
  metaKeywords?: Record<string, string> | null;

  @Property({ type: 'json' })
  content: Record<string, unknown> = {};

  /** Library asset shown on post cards (feature 163, data-model §1.2). */
  @Property({ type: 'uuid', fieldName: 'main_image_asset_id', nullable: true })
  mainImageAssetId?: string | null;

  /** Feature 171 (US7) — the administrator named as author; read through `adminUserReadPort`. */
  @Property({ type: 'uuid', fieldName: 'author_admin_user_id', nullable: true })
  authorAdminUserId?: string | null;

  @Property({ type: 'integer' })
  version: number = 1;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();

  @Property({ type: 'datetime', fieldName: 'deleted_at', nullable: true })
  deletedAt?: Date | null;
}
