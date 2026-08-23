import { Entity, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';

/**
 * BlogPostRelatedPost — self-join on blog_posts (parent_post_id →
 * related_post_id), ordered by `position`. The detach-on-delete contract
 * (R5 / FR-028) is enforced at the service layer in
 * BlogPostService.softDelete: the soft-delete transaction atomically
 * removes every join row where `related_post_id = id`.
 */
@GlobalEntity()
@Entity({ tableName: 'blog_post_related_posts' })
export class BlogPostRelatedPost {
  [OptionalProps]?: 'position';

  @PrimaryKey({ type: 'uuid', fieldName: 'parent_post_id' })
  parentPostId!: string;

  @PrimaryKey({ type: 'uuid', fieldName: 'related_post_id' })
  relatedPostId!: string;

  @Property({ type: 'integer' })
  position: number = 0;
}
