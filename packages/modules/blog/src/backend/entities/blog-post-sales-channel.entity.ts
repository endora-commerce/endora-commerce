import { Entity, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';

/**
 * BlogPostSalesChannel — composite-key M2M between blog_posts and
 * sales_channels. Same denormalised-slug-mirror pattern as
 * BlogCategorySalesChannel (R3): the `slug` column drives the partial
 * unique index `idx_blog_posts_slug_per_channel_uniq` and the service
 * layer keeps it in sync.
 */
@GlobalEntity()
@Entity({ tableName: 'blog_post_sales_channels' })
export class BlogPostSalesChannel {
  [OptionalProps]?: 'deletedAt';

  @PrimaryKey({ type: 'uuid', fieldName: 'blog_post_id' })
  blogPostId!: string;

  @PrimaryKey({ type: 'uuid', fieldName: 'sales_channel_id' })
  salesChannelId!: string;

  @Property({ type: 'string', length: 160 })
  slug!: string;

  @Property({ type: 'datetime', fieldName: 'deleted_at', nullable: true })
  deletedAt?: Date | null;
}
