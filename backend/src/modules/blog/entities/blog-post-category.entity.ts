import { Entity, PrimaryKey } from '@mikro-orm/core';
import { GlobalEntity } from '../../../tenancy/org-scoped.decorator.js';

/**
 * BlogPostCategory — composite-key M2M between blog_posts and
 * blog_categories. The Category's FK uses ON DELETE NO ACTION (FR-006
 * refuses Category delete while Posts reference it).
 */
@GlobalEntity()
@Entity({ tableName: 'blog_post_categories' })
export class BlogPostCategory {
  @PrimaryKey({ type: 'uuid', fieldName: 'blog_post_id' })
  blogPostId!: string;

  @PrimaryKey({ type: 'uuid', fieldName: 'blog_category_id' })
  blogCategoryId!: string;
}
