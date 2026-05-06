import { Entity, PrimaryKey } from '@mikro-orm/core';

/**
 * BlogPostLanguage — per-Post language scope. Mirrors the shape of
 * `blog_category_languages`.
 */
@Entity({ tableName: 'blog_post_languages' })
export class BlogPostLanguage {
  @PrimaryKey({ type: 'uuid', fieldName: 'blog_post_id' })
  blogPostId!: string;

  @PrimaryKey({ type: 'string', length: 8 })
  language!: string;
}
