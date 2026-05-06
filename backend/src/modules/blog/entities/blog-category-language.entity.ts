import { Entity, PrimaryKey } from '@mikro-orm/core';

/**
 * BlogCategoryLanguage — composite-key M2M between blog_categories and
 * BCP-47 language codes. The set is constrained to languages that live in
 * one of the assigned channels' configured language sets (validated at the
 * service layer per feature 005).
 */
@Entity({ tableName: 'blog_category_languages' })
export class BlogCategoryLanguage {
  @PrimaryKey({ type: 'uuid', fieldName: 'blog_category_id' })
  blogCategoryId!: string;

  @PrimaryKey({ type: 'string', length: 8 })
  language!: string;
}
