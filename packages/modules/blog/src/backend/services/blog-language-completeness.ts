import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';

/**
 * Feature 171 (US3, FR-022 as amended, OR-7) — an entity exists on the storefront in
 * each language assigned to it, so in each it must be written:
 *
 * - a **name** in every assigned language;
 * - **content** (posts) in every assigned language — once the post has content in any
 *   language. A post with no content at all is the API-created shape that predates
 *   the editor; a post written in one language and assigned to another is the case
 *   this refuses: the second language would publish an empty page.
 *
 * Returns the missing fields as `<field>.<language>`, in the order the languages are
 * assigned.
 */
export function missingLanguageFields(input: {
  name: Record<string, string> | null | undefined;
  languages: readonly string[];
  content?: { languages?: Record<string, unknown> } | null | undefined;
}): string[] {
  const missing: string[] = [];
  const contentByLanguage = input.content?.languages ?? {};
  const hasAnyContent = Object.values(contentByLanguage).some(hasContent);
  for (const language of input.languages) {
    if (!input.name?.[language]?.trim()) missing.push(`name.${language}`);
    if (input.content !== undefined && hasAnyContent && !hasContent(contentByLanguage[language])) {
      missing.push(`content.${language}`);
    }
  }
  return missing;
}

function hasContent(tree: unknown): boolean {
  return typeof tree === 'object' && tree !== null && Object.keys(tree).length > 0;
}

function refuse(kind: 'post' | 'category', missing: string[]): never {
  throw new HttpError(
    422,
    ERROR_CODES.BLOG_LANGUAGE_INCOMPLETE,
    `The blog ${kind} is not written in every language assigned to it: ${missing.join(', ')}.`,
    missing.map((path) => ({ path, issue: 'missing in an assigned language' })),
  );
}

/** Refuse, inside the caller's transaction, a post not written in every assigned language. */
export async function assertPostLanguagesComplete(em: EntityManager, postId: string): Promise<void> {
  const rows = (await em.execute('select name, content from blog_posts where id = ?', [postId])) as Array<{
    name: Record<string, string> | null;
    content: { languages?: Record<string, unknown> } | null;
  }>;
  const languages = (await em.execute('select language from blog_post_languages where blog_post_id = ?', [
    postId,
  ])) as Array<{ language: string }>;
  const missing = missingLanguageFields({
    name: rows[0]?.name,
    languages: languages.map((l) => l.language).sort(),
    content: rows[0]?.content ?? null,
  });
  if (missing.length > 0) refuse('post', missing);
}

/** Refuse, inside the caller's transaction, a category without a name in every assigned language. */
export async function assertCategoryLanguagesComplete(em: EntityManager, categoryId: string): Promise<void> {
  const rows = (await em.execute('select name from blog_categories where id = ?', [categoryId])) as Array<{
    name: Record<string, string> | null;
  }>;
  const languages = (await em.execute('select language from blog_category_languages where blog_category_id = ?', [
    categoryId,
  ])) as Array<{ language: string }>;
  const missing = missingLanguageFields({ name: rows[0]?.name, languages: languages.map((l) => l.language).sort() });
  if (missing.length > 0) refuse('category', missing);
}
