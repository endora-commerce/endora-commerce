import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * An SEO override of one entity (T235 / FR-101) at one scope. When present, the
 * resolver returns this row's fields verbatim and falls back for any nullable
 * column that's left empty.
 *
 * Feature 163 (`specs/163-product-data-scopes/data-model.md` §6, research R13) —
 * a row sits at a language (`locale` only), a sales channel (`salesChannelId`
 * only) or a channel × language (both); every row written before is a language
 * row. One row per address: three partial unique indexes in the migration
 * (`meta_override_channel_scope`), which no decorator expresses, and a check
 * that at least one half is set. Only products take a channel.
 *
 * Feature 174 (`specs/174-product-editor-scope-switcher/data-model.md` §8) — a **product** row
 * sits at Global (neither half), Channel (`salesChannelId` only) or Channel × language (both);
 * there is no Language-only product row any more (FR-010), and the scope check of
 * `product_meta_three_levels` refuses one. Category and CMS-page rows keep their language rows.
 * On a product row a column holding `null` inherits (at Global: no value) and `''` is a
 * deliberately empty override, for which the storefront uses the derived value. One Global row
 * per product is a partial unique index of that migration.
 */
@GlobalEntity()
@Entity({ tableName: 'seo_meta_overrides' })
export class SeoMetaOverride {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'salesChannelId'
    | 'locale'
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

  /** `null` = the channel row (all of the channel's languages), or a product's Global row. */
  @Property({ type: 'string', length: 10, nullable: true })
  locale: string | null = null;

  /** `null` = a category / CMS-page language row, or a product's Global row. */
  @Property({ type: 'uuid', fieldName: 'sales_channel_id', nullable: true })
  salesChannelId: string | null = null;

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
