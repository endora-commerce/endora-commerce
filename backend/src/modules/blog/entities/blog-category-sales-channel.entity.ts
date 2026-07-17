import { Entity, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '../../../tenancy/org-scoped.decorator.js';

/**
 * BlogCategorySalesChannel — composite-key M2M between blog_categories and
 * sales_channels. The denormalised `slug` + `deleted_at` columns mirror the
 * parent `blog_categories` row so the partial unique index
 * `idx_blog_categories_slug_per_channel_uniq` can enforce per-(channel,
 * slug) uniqueness directly at the DB level (R3). The service layer keeps
 * the mirror in sync on every parent write.
 */
@GlobalEntity()
@Entity({ tableName: 'blog_category_sales_channels' })
export class BlogCategorySalesChannel {
  [OptionalProps]?: 'deletedAt';

  @PrimaryKey({ type: 'uuid', fieldName: 'blog_category_id' })
  blogCategoryId!: string;

  @PrimaryKey({ type: 'uuid', fieldName: 'sales_channel_id' })
  salesChannelId!: string;

  @Property({ type: 'string', length: 160 })
  slug!: string;

  @Property({ type: 'datetime', fieldName: 'deleted_at', nullable: true })
  deletedAt?: Date | null;
}
