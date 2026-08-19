import type { DictionaryReferenceRegistryPort } from '@b2b/contracts';
import type { EntityManager } from '@mikro-orm/postgresql';

/**
 * Who in `cms` still points at a language (feature 077, D-87).
 *
 * `cms_pages.languages` is a JSON array of codes, which is why `languages`
 * used to reach for `@> ?::jsonb` against this module's table directly. The
 * containment test lives here now, next to the column it is about.
 */
export function registerCmsLanguageReferences(
  registry: DictionaryReferenceRegistryPort,
  emFactory: () => EntityManager,
): void {
  registry.register({
    ownerModuleId: 'cms',
    consumer: 'cms',
    tableName: 'cms_pages',
    columnName: 'languages[]',
    blocking: true,
    countReferences: async (code) => {
      const rows = (await emFactory().execute(
        `select count(*)::int as n from "cms_pages" where "languages" @> ?::jsonb`,
        [JSON.stringify([code])],
      )) as Array<{ n: number }>;
      return rows[0]?.n ?? 0;
    },
    usedCodes: async () =>
      (await emFactory().execute(
        `select value.code as code, count(*)::int as count
           from "cms_pages" t
           cross join lateral jsonb_array_elements_text(
             coalesce(t."languages", '[]'::jsonb)) as value(code)
          group by value.code`,
      )) as Array<{ code: string; count: number }>,
  });
}
