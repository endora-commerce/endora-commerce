import { Entity, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';

/**
 * BlogPostTag — composite-key M2M between blog_posts and blog_tags,
 * ordered by `position` (drives the storefront chip strip order). Block-
 * on-delete is enforced at the service layer in BlogTagService.remove
 * (FR-018, R14).
 */
@GlobalEntity()
@Entity({ tableName: 'blog_post_tags' })
export class BlogPostTag {
  [OptionalProps]?: 'position';

  @PrimaryKey({ type: 'uuid', fieldName: 'blog_post_id' })
  blogPostId!: string;

  @PrimaryKey({ type: 'uuid', fieldName: 'blog_tag_id' })
  blogTagId!: string;

  @Property({ type: 'integer' })
  position: number = 0;
}
