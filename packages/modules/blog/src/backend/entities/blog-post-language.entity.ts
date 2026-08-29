import { Entity, PrimaryKey } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';

/**
 * BlogPostLanguage — per-Post language scope. Mirrors the shape of
 * `blog_category_languages`.
 */
@GlobalEntity()
@Entity({ tableName: 'blog_post_languages' })
export class BlogPostLanguage {
  @PrimaryKey({ type: 'uuid', fieldName: 'blog_post_id' })
  blogPostId!: string;

  @PrimaryKey({ type: 'string', length: 8 })
  language!: string;
}
