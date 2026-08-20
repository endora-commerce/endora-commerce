import type { DictionaryReferenceRegistryPort } from '@b2b/contracts';
import type { EntityManager } from '@mikro-orm/postgresql';

/**
 * Who in `blog` still points at a language (feature 077, D-87).
 *
 * Two descriptors, one per table: `languages` used to count both itself, and
 * `dictionaries`' orphan report joined both a second time. Both statements
 * named this module's tables in strings no import-level boundary check can
 * see.
 *
 * Contributed whatever this module's effective state, and blocking while it
 * is off: a switched-off blog still owns rows carrying the language code, so
 * deleting the language would leave them dangling the moment an operator
 * switches the blog back on. That is the registry's stated enumeration
 * policy, and the reason it is `honour` rather than `skip`.
 */
export function registerBlogLanguageReferences(
  registry: DictionaryReferenceRegistryPort,
  emFactory: () => EntityManager,
): void {
  registry.register({
    ownerModuleId: 'blog',
    consumer: 'blog',
    tableName: 'blog_post_languages',
    columnName: 'language',
    blocking: true,
    countReferences: async (code) => {
      const rows = (await emFactory().execute(
        `select count(*)::int as n from "blog_post_languages" where "language" = ?`,
        [code],
      )) as Array<{ n: number }>;
      return rows[0]?.n ?? 0;
    },
    usedCodes: async () =>
      (await emFactory().execute(
        `select "language" as code, count(*)::int as count
           from "blog_post_languages" where "language" is not null group by "language"`,
      )) as Array<{ code: string; count: number }>,
  });
  registry.register({
    ownerModuleId: 'blog',
    consumer: 'blog',
    tableName: 'blog_category_languages',
    columnName: 'language',
    blocking: true,
    countReferences: async (code) => {
      const rows = (await emFactory().execute(
        `select count(*)::int as n from "blog_category_languages" where "language" = ?`,
        [code],
      )) as Array<{ n: number }>;
      return rows[0]?.n ?? 0;
    },
    usedCodes: async () =>
      (await emFactory().execute(
        `select "language" as code, count(*)::int as count
           from "blog_category_languages" where "language" is not null group by "language"`,
      )) as Array<{ code: string; count: number }>,
  });
}
