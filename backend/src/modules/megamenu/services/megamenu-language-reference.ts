import type { DictionaryReferenceRegistryPort } from '@b2b/contracts';
import type { EntityManager } from '@mikro-orm/postgresql';

/**
 * Who in `megamenu` still points at a language (feature 077, D-87).
 *
 * `languages` used to count `megamenu_bindings` itself, naming this module's
 * table in a string no import-level boundary check can see. A binding is
 * per-channel and per-language, so a language the platform has dropped
 * leaves the binding unreachable rather than merely untranslated.
 */
export function registerMegamenuLanguageReferences(
  registry: DictionaryReferenceRegistryPort,
  emFactory: () => EntityManager,
): void {
  registry.register({
    ownerModuleId: 'megamenu',
    consumer: 'megamenu',
    tableName: 'megamenu_bindings',
    columnName: 'language',
    blocking: true,
    countReferences: async (code) => {
      const rows = (await emFactory().execute(
        `select count(*)::int as n from "megamenu_bindings" where "language" = ?`,
        [code],
      )) as Array<{ n: number }>;
      return rows[0]?.n ?? 0;
    },
    usedCodes: async () =>
      (await emFactory().execute(
        `select "language" as code, count(*)::int as count
           from "megamenu_bindings" where "language" is not null group by "language"`,
      )) as Array<{ code: string; count: number }>,
  });
}
