import { Entity, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';

/**
 * BlogPostRelatedProduct — composite-key M2M between blog_posts and
 * catalog products, ordered by `position`. The product FK uses ON DELETE
 * NO ACTION; soft-deleted products are filtered out of the storefront
 * resolver per R6 (no generic ProductReferenceRegistry exists yet at v1).
 */
@Entity({ tableName: 'blog_post_related_products' })
export class BlogPostRelatedProduct {
  [OptionalProps]?: 'position';

  @PrimaryKey({ type: 'uuid', fieldName: 'blog_post_id' })
  blogPostId!: string;

  @PrimaryKey({ type: 'uuid', fieldName: 'product_id' })
  productId!: string;

  @Property({ type: 'integer' })
  position: number = 0;
}
